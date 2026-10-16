import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, symlink, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSkill, sha256, validateSuite, matchFindings, metrics, runEvaluation, executeAdapter, validateGuidanceManifest, guidanceSubsetHash, isSafeGuidancePath, isProhibitedGuidancePath } from './lib.js';
import { main } from './index.js';

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const loadSuite = async () => JSON.parse(await readFile(path.join(fixture, 'smoke-cases.json'), 'utf8'));
const options = { casesPath: path.join(fixture, 'smoke-cases.json'), baselineSkill: path.join(fixture, 'baseline'), candidateSkill: path.join(fixture, 'candidate'), adapterPath: path.join(fixture, 'smoke-adapter.json') };
async function temporary(t) { const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'skill-eval-test-'))); t.after(() => rm(directory, { recursive: true, force: true })); return directory; }

test('content tree hash includes every auxiliary file and ignores mtime', async (t) => {
  const directory = await temporary(t); await mkdir(path.join(directory, 'rules'));
  await writeFile(path.join(directory, 'SKILL.md'), 'skill'); await writeFile(path.join(directory, 'rules', 'rule.md'), 'rule');
  const expected = sha256(`SKILL.md\0${sha256('skill')}\nrules/rule.md\0${sha256('rule')}\n`);
  assert.equal((await readSkill(directory)).hash, expected);
  await writeFile(path.join(directory, 'SKILL.md'), 'skill'); assert.equal((await readSkill(directory)).hash, expected);
  await writeFile(path.join(directory, 'rules', 'rule.md'), 'edited'); assert.notEqual((await readSkill(directory)).hash, expected);
  await symlink(path.join(directory, 'SKILL.md'), path.join(directory, 'link.md')); await assert.rejects(readSkill(directory), /symlink/);
});

test('case validator rejects MR leakage, temporal overlap and missing pair/control coverage', async () => {
  const suite = await loadSuite(); assert.equal(validateSuite(suite).chronologicallyDisjoint, true);
  const leakage = structuredClone(suite); leakage.cases.find((item) => item.split === 'heldout').source.mrId = suite.cases[0].source.mrId;
  assert.throws(() => validateSuite(leakage), /MR split leakage/);
  const temporal = structuredClone(suite); temporal.cases.filter((item) => item.split === 'heldout').forEach((item) => { item.source.createdAt = '2025-01-01T00:00:00Z'; });
  assert.throws(() => validateSuite(temporal), /strictly newer/);
  const pair = structuredClone(suite); pair.cases = pair.cases.filter((item) => item.id !== 'development-corrected'); assert.throws(() => validateSuite(pair), /Incomplete/);
  const boundary = structuredClone(suite); boundary.cases = boundary.cases.filter((item) => item.id !== 'heldout-boundary'); assert.throws(() => validateSuite(boundary), /boundary coverage/);
  const dishonest = structuredClone(suite); dishonest.cases[0].source.disposition = 'pushed_back'; assert.throws(() => validateSuite(dishonest), /accepted_and_fixed/);
});

test('real cases cannot omit acceptance, fix and source evidence', async () => {
  const suite = await loadSuite(); suite.evidenceKind = 'real'; suite.rules[0].evidenceFindingIds = ['source-finding'];
  assert.throws(() => validateSuite(suite), /lacks urls/);
  suite.cases.forEach((item) => { item.source.urls = ['https://example.invalid/mr']; });
  assert.throws(() => validateSuite(suite), /lacks acceptanceEvidence/);
});

test('one-to-one maximum matching scores overlapping ranges and penalizes duplicates', () => {
  const expected = [{ ruleId: 'r', file: 'a', lineStart: 1, lineEnd: 4 }, { ruleId: 'r', file: 'a', lineStart: 1, lineEnd: 1 }];
  const actual = [{ ruleId: 'r', file: 'a', line: 1 }, { ruleId: 'r', file: 'a', line: 4 }, { ruleId: 'r', file: 'a', line: 4 }, { ruleId: 'r', file: 'wrong', line: 1 }];
  const matching = matchFindings(expected, actual, actual.map((_, actualIndex) => ({ actualIndex, expectedIndex: actualIndex === 0 ? 1 : 0, defect: true, scope: true, remedy: true, reason: 'Verified mechanism, scope and remedy.' })));
  assert.equal(matching.truePositives, 2); assert.equal(matching.falsePositives, 2); assert.equal(matching.falseNegatives, 0);
  const negative = { expectedFindings: [], candidate: { findings: [actual[0]], matching: matchFindings([], [actual[0]]) } };
  const summary = metrics([{ expectedFindings: expected, candidate: { findings: actual, matching } }, negative], 'candidate');
  assert.equal(summary.recall, 1); assert.equal(summary.precision, 2 / 5); assert.equal(summary.negativeCaseFalsePositiveRate, 1);
});

test('actual subprocess smoke run separates heldout results and cannot promote', async () => {
  const report = await runEvaluation({ ...options, judgeAdapterPath: path.join(fixture, 'smoke-adapter.json') });
  assert.equal(report.status, 'complete'); assert.equal(report.behavioralExecuted, true);
  assert.equal(report.metrics.development.baseline.recall, 0); assert.equal(report.metrics.heldout.candidate.recall, 1);
  assert.equal(report.metrics.heldout.candidate.falsePositives, 0); assert.equal(report.cases.length, 10);
  assert.equal(report.candidateHash, (await readSkill(options.candidateSkill)).hash);
  assert.equal(report.promotion.eligible, false); assert.match(report.promotion.reasons.join(' '), /model adapter|Synthetic/);
  assert.ok(report.runtime.adapterFiles.some((file) => file.path.endsWith('smoke-adapter.js')));
  assert.ok(report.cases.every((item) => item.baseline.execution.succeeded && item.candidate.execution.succeeded));
});

test('removed check loses positive coverage and is explicitly blocked', async () => {
  const report = await runEvaluation({ ...options, baselineSkill: options.candidateSkill, candidateSkill: options.baselineSkill, judgeAdapterPath: path.join(fixture, 'smoke-adapter.json') });
  assert.equal(report.metrics.heldout.baseline.recall, 1); assert.equal(report.metrics.heldout.candidate.recall, 0);
  assert.equal(report.promotion.eligible, false); assert.equal(report.metrics.development.candidate.recall, 0);
});

test('missing/failed/invalid model execution fails closed, without pretending empty findings', async (t) => {
  const directory = await temporary(t); const adapterPath = path.join(directory, 'adapter.json');
  await writeFile(adapterPath, JSON.stringify({ mode: 'model', model: 'configured-default', command: '/missing/model-runtime' }));
  let report = await runEvaluation({ ...options, adapterPath });
  assert.equal(report.status, 'execution_failed'); assert.equal(report.behavioralExecuted, false); assert.equal(report.promotion.eligible, false); assert.match(report.promotion.reasons[0], /spawn failed/);
  assert.equal(report.cases[0].baseline.findings, undefined);
  await writeFile(path.join(directory, 'invalid.cjs'), 'process.stdout.write(JSON.stringify({findings:[]}));');
  await writeFile(adapterPath, JSON.stringify({ mode: 'model', model: 'configured-default', command: process.execPath, args: ['invalid.cjs'] }));
  report = await runEvaluation({ ...options, adapterPath }); assert.equal(report.behavioralExecuted, false); assert.match(report.promotion.reasons[0], /observed model/);
  await writeFile(path.join(directory, 'invalid.cjs'), 'process.stdout.write("not JSON");');
  report = await runEvaluation({ ...options, adapterPath }); assert.match(report.promotion.reasons[0], /exactly one JSON/);
});

test('adapter subprocess arguments are literal, prompt withholds eval labels', async (t) => {
  const directory = await temporary(t); const script = path.join(directory, 'args.cjs');
  await writeFile(script, 'let input=""; process.stdin.on("data",c=>input+=c); process.stdin.on("end",()=>{const r=JSON.parse(input); if(r.expectedFindings||r.split||r.kind) process.exit(2); if(process.argv[2]!=="literal; $(false)") process.exit(3); process.stdout.write(JSON.stringify({findings:[]}));});');
  const result = await executeAdapter({ mode: 'smoke', command: process.execPath, args: [script, 'literal; $(false)'], timeoutMs: 10000 }, { allowedRules: [], skill: {}, code: {}, context: '' }, directory);
  assert.equal(result.execution.succeeded, true);
  const adapterPath = path.join(directory, 'adapter.json');
  await writeFile(adapterPath, JSON.stringify({ mode: 'smoke', command: process.execPath, args: [script, 'literal; $(false)'] }));
  const report = await runEvaluation({ ...options, adapterPath });
  assert.equal(report.status, 'complete'); assert.equal(report.behavioralExecuted, true);
});

test('timeouts and output limit cannot produce a successful run', async (t) => {
  const directory = await temporary(t); const script = path.join(directory, 'bad.cjs'); const request = { allowedRules: [] };
  await writeFile(script, 'setTimeout(()=>{},10000);');
  await assert.rejects(executeAdapter({ mode: 'smoke', command: process.execPath, args: [script], timeoutMs: 50 }, request, directory), /timed out/);
  await writeFile(script, 'process.stdout.write("a".repeat(10000));');
  await assert.rejects(executeAdapter({ mode: 'smoke', command: process.execPath, args: [script], maxOutputBytes: 20 }, request, directory), /output limit/);
});

async function packagedFixture(t) {
  const directory = await temporary(t);
  const baselineSkill = path.join(directory, 'baseline'), candidateSkill = path.join(directory, 'candidate');
  for (const [arm, target] of [['baseline', baselineSkill], ['candidate', candidateSkill]]) {
    await mkdir(path.join(target, 'evals'), { recursive: true }); await mkdir(path.join(target, 'references'));
    await writeFile(path.join(target, 'SKILL.md'), await readFile(path.join(fixture, arm, 'SKILL.md')));
    await writeFile(path.join(target, 'references', 'rules.md'), 'Runtime rule guidance only.');
    await writeFile(path.join(target, 'evals', 'cases.json'), JSON.stringify({ expectedFindings: ['ORACLE_SECRET_CASES'] }));
    await writeFile(path.join(target, 'evals', 'results.json'), JSON.stringify({ evaluator: 'test-only', findings: ['ORACLE_SECRET_RESULTS'] }));
    await writeFile(path.join(target, 'references', 'evaluation.md'), 'ORACLE_SECRET_SCORE');
  }
  const guidanceManifestPath = path.join(directory, 'guidance-manifest.json');
  const manifest = { version: 1, baselineFiles: ['references/rules.md', 'SKILL.md'], candidateFiles: ['SKILL.md', 'references/rules.md'] };
  await writeFile(guidanceManifestPath, JSON.stringify(manifest, null, 2));
  const inspectScript = path.join(directory, 'inspect.cjs');
  // Every real request must omit all three packaged artifacts and still bind the entire tree.
  await writeFile(inspectScript, `let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{const r=JSON.parse(input);const names=r.skill.files.map(f=>f.path);if(JSON.stringify(r).includes('ORACLE_SECRET')||JSON.stringify(names)!==JSON.stringify(['SKILL.md','references/rules.md'])||!r.skill.hash||!r.skill.guidanceHash||r.skill.hash===r.skill.guidanceHash)process.exit(9);process.stdout.write(JSON.stringify({findings:[]}));});`);
  const adapterPath = path.join(directory, 'adapter.json');
  await writeFile(adapterPath, JSON.stringify({ mode: 'smoke', command: process.execPath, args: [inspectScript] }));
  return { directory, baselineSkill, candidateSkill, guidanceManifestPath, adapterPath, manifest };
}

test('explicit guidance manifest excludes packaged oracle/results/evaluation while binding the full trees', async (t) => {
  const packaged = await packagedFixture(t);
  const report = await runEvaluation({ ...options, ...packaged });
  assert.equal(report.status, 'complete'); assert.equal(report.behavioralExecuted, true);
  assert.equal(report.candidateHash, (await readSkill(packaged.candidateSkill)).hash);
  assert.equal(report.baselineHash, (await readSkill(packaged.baselineSkill)).hash);
  assert.equal(report.guidance.verified, true); assert.equal(report.guidance.mode, 'explicit');
  assert.equal(report.guidance.manifestSourceHash, sha256(await readFile(packaged.guidanceManifestPath)));
  assert.deepEqual(report.guidance.manifest, { version: 1, baselineFiles: ['SKILL.md', 'references/rules.md'], candidateFiles: ['SKILL.md', 'references/rules.md'] });
  assert.equal(report.guidance.manifestHash, sha256(JSON.stringify(report.guidance.manifest)));
  for (const arm of ['baseline', 'candidate']) {
    assert.equal(report.guidance[arm].hash, guidanceSubsetHash(report.guidance[arm].files));
    assert.notEqual(report.guidance[arm].hash, report[`${arm}Hash`]);
  }
  const oldHash = report.candidateHash;
  await writeFile(path.join(packaged.candidateSkill, 'evals', 'results.json'), 'ORACLE_SECRET_EDITED_RESULTS');
  const changed = await runEvaluation({ ...options, ...packaged });
  assert.equal(changed.status, 'complete'); assert.notEqual(changed.candidateHash, oldHash);
  assert.equal(changed.guidance.candidate.hash, report.guidance.candidate.hash);
  assert.equal(changed.guidance.manifestHash, report.guidance.manifestHash);
});

test('packaged artifacts cannot enter requests without an explicit manifest, clean smoke remains compatible', async (t) => {
  const packaged = await packagedFixture(t);
  const report = await runEvaluation({ ...options, ...packaged, guidanceManifestPath: undefined });
  assert.equal(report.status, 'invalid_input'); assert.equal(report.behavioralExecuted, false); assert.equal(report.cases.length, 0);
  assert.match(report.promotion.reasons[0], /Explicit guidance manifest required/);
  const clean = await runEvaluation(options);
  assert.equal(clean.status, 'complete'); assert.equal(clean.guidance.mode, 'implicit-all-safe'); assert.equal(clean.guidance.manifestSourceHash, null);
  assert.equal(clean.guidance.baseline.hash, clean.baselineHash); assert.equal(clean.guidance.candidate.hash, clean.candidateHash);
});

test('manifest validation rejects missing, duplicate, unsafe and selected evaluation/oracle files', async (t) => {
  const packaged = await packagedFixture(t);
  for (const names of [[], ['references/rules.md'], ['SKILL.md', 'SKILL.md'], ['SKILL.md', '../outside.md'], ['SKILL.md', '/absolute.md'], ['SKILL.md', './references/rules.md'], ['SKILL.md', 'references//rules.md'], ['SKILL.md', 'references\\rules.md'], ['SKILL.md', 'C:/rules.md'], ['SKILL.md', 'a\0b'], ['SKILL.md', 'missing.md'], ['SKILL.md', 'evals/cases.json'], ['SKILL.md', 'evals/results.json'], ['SKILL.md', 'references/evaluation.md']]) {
    await writeFile(packaged.guidanceManifestPath, JSON.stringify({ version: 1, baselineFiles: ['SKILL.md'], candidateFiles: names }));
    const report = await runEvaluation({ ...options, ...packaged });
    assert.equal(report.status, 'invalid_input', JSON.stringify(names)); assert.equal(report.behavioralExecuted, false); assert.equal(report.cases.length, 0);
  }
  for (const manifest of [{ version: 1, candidateFiles: ['SKILL.md'] }, { ...packaged.manifest, version: 2 }, { ...packaged.manifest, extra: [] }]) assert.throws(() => validateGuidanceManifest(manifest), /requires only/);
  assert.throws(() => validateGuidanceManifest(packaged.manifest, { requireSorted: true }), /must be sorted/);
  for (const file of ['eval-ground-truth.json', 'references/outcomes.md', 'benchmark/oracle.json', 'review-results.json']) assert.equal(isProhibitedGuidancePath(file), true);
  assert.equal(isSafeGuidancePath('references/rules.md'), true); assert.equal(isSafeGuidancePath('../rules.md'), false);
});

test('missing/symlink manifests and selected symlinks or renamed serialized oracle content fail closed', async (t) => {
  const packaged = await packagedFixture(t);
  let report = await runEvaluation({ ...options, ...packaged, guidanceManifestPath: path.join(packaged.directory, 'missing.json') });
  assert.equal(report.status, 'invalid_input'); assert.equal(report.behavioralExecuted, false);
  const symlinkManifest = path.join(packaged.directory, 'link.json'); await symlink(packaged.guidanceManifestPath, symlinkManifest);
  report = await runEvaluation({ ...options, ...packaged, guidanceManifestPath: symlinkManifest }); assert.match(report.promotion.reasons[0], /Symlink path component/);
  const linkedParent = path.join(packaged.directory, 'linked-parent'); await symlink(packaged.directory, linkedParent);
  report = await runEvaluation({ ...options, ...packaged, guidanceManifestPath: path.join(linkedParent, 'guidance-manifest.json') }); assert.match(report.promotion.reasons[0], /Symlink path component/);
  report = await runEvaluation({ ...options, ...packaged, candidateSkill: path.join(linkedParent, 'candidate') }); assert.match(report.promotion.reasons[0], /Symlink path component/);
  const renamed = path.join(packaged.candidateSkill, 'references', 'checks.md');
  await writeFile(renamed, '{"expected_targets":["ORACLE_SECRET_RENAMED"]}');
  await writeFile(packaged.guidanceManifestPath, JSON.stringify({ version: 1, baselineFiles: ['SKILL.md'], candidateFiles: ['SKILL.md', 'references/checks.md'] }));
  report = await runEvaluation({ ...options, ...packaged }); assert.match(report.promotion.reasons[0], /Serialized oracle\/outcome/); assert.equal(report.cases.length, 0);
  await rm(renamed); await symlink(path.join(packaged.candidateSkill, 'SKILL.md'), renamed);
  report = await runEvaluation({ ...options, ...packaged }); assert.match(report.promotion.reasons[0], /symlink/); assert.equal(report.behavioralExecuted, false);
});

test('CLI accepts the optional manifest and persists the same selected guidance audit', async (t) => {
  const packaged = await packagedFixture(t); const output = path.join(packaged.directory, 'report.json');
  const code = await main(['--cases', options.casesPath, '--baseline-skill', packaged.baselineSkill, '--candidate-skill', packaged.candidateSkill, '--adapter', packaged.adapterPath, '--output', output, '--guidance-manifest', packaged.guidanceManifestPath]);
  assert.equal(code, 0); const report = JSON.parse(await readFile(output)); assert.equal(report.guidance.mode, 'explicit'); assert.equal(report.guidance.verified, true);
  await assert.rejects(main(['--guidance-manifest', packaged.guidanceManifestPath]), /All five options/);
});

test('adapter cancellation reaps descendants that ignore termination', async (t) => {
  const directory = await temporary(t), pidFile = path.join(directory, 'child.pid');
  const script = path.join(directory, 'parent.cjs');
  await writeFile(script, `const {spawn}=require('node:child_process');const fs=require('node:fs');const child=spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(pidFile)},String(child.pid));process.stdin.resume();setInterval(()=>{},1000);`);
  await assert.rejects(executeAdapter({ mode: 'smoke', command: process.execPath, args: [script], timeoutMs: 300 }, { allowedRules: [] }, directory), /timed out/);
  const pid=Number(await readFile(pidFile,'utf8'));
  t.after(()=>{try{process.kill(pid,'SIGKILL');}catch{}});
  await new Promise(resolve=>setTimeout(resolve,1200));
  assert.throws(()=>process.kill(pid,0),/ESRCH/);
});
