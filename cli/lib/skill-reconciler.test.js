import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { applySkillReconciliation, defaultLocalRoots, hashSkillTree, planSkillReconciliation, readReconcileState, runSkillReconciliation, scanPersonalSkills, validateReconcileConfig, validateSkillEval } from './skill-reconciler.js';
import { evaluationBindingHash, evaluationResultsHash, metrics } from '../../scripts/skill-eval/lib.js';
import { promotionFixture } from '../../scripts/skill-eval/fixtures/promotion-fixture.js';

const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const subsetDigest = (records) => digest([...records].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0).map((file) => `${file.path}\0${file.hash}\n`).join(''));
function guidanceMetadata(baselineFiles, candidateFiles) {
  const records = (files) => files.map(({ path, hash }) => ({ path, hash }));
  const baseline = records(baselineFiles); const candidate = records(candidateFiles);
  const manifest = { version: 1, baselineFiles: baseline.map((file) => file.path), candidateFiles: candidate.map((file) => file.path) };
  return { version: 1, verified: true, mode: 'implicit-all-safe', manifest, manifestHash: digest(JSON.stringify(manifest)), manifestSourceHash: null, manifestPath: null, baseline: { hash: subsetDigest(baseline), files: baseline }, candidate: { hash: subsetDigest(candidate), files: candidate } };
}
function refreshGuidanceHashes(guidance) {
  guidance.manifestHash = digest(JSON.stringify(guidance.manifest));
  for (const arm of ['baseline', 'candidate']) guidance[arm].hash = subsetDigest(guidance[arm].files);
}
async function skill(target, content = '# Example\n', marker = 'SKILL.md') {
  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(path.join(target, marker), content);
}
async function fixture(t, classification = 'private') {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-reconcile-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const canonicalRoot = path.join(directory, 'canonical');
  const publicMirrorRoot = path.join(directory, 'public');
  const localRoot = path.join(directory, 'local');
  for (const root of [canonicalRoot, publicMirrorRoot]) await fs.mkdir(path.join(root, 'packages'), { recursive: true });
  await fs.mkdir(localRoot);
  const config = { version: 1, canonicalRoot, publicMirrorRoot, localRoots: { codex: localRoot }, forbiddenPublicPatterns: ['private\\.example', 'confidential fixture'], privatePathPrefixes: ['packages/private-workflows/'], mappings: [{ id: 'example', localRoot: 'codex', localName: 'example', canonical: 'packages/general/skills/example', classification }] };
  const local = path.join(localRoot, 'example');
  const canonical = path.join(canonicalRoot, config.mappings[0].canonical);
  const mirror = path.join(publicMirrorRoot, config.mappings[0].canonical);
  const statePath = path.join(directory, 'state.json');
  await skill(local); await skill(canonical);
  const evalBaselinePath = path.join(directory, 'existing-review-baseline');
  await skill(evalBaselinePath);
  config.mappings[0].evalBaselinePath = evalBaselinePath;
  config.mappings[0].evalBaselineHash = (await hashSkillTree(evalBaselinePath)).hash;
  if (classification === 'shared') await skill(mirror);
  async function plan() { return planSkillReconciliation(config, await readReconcileState(statePath)); }
  async function apply() { return applySkillReconciliation(config, await plan(), { statePath }); }
  async function gate(candidate = local, overrides = {}) {
    const candidateHash = (await hashSkillTree(candidate)).hash;
    const action = (await plan()).actions[0];
    const baselineHash = action.baselineHash || config.mappings[0].evalBaselineHash;
    const baselineTree = await hashSkillTree(action.baselineSource || evalBaselinePath);
    const candidateTree = await hashSkillTree(candidate);
    const guidance = guidanceMetadata(baselineTree.files, candidateTree.files);
    // Deliberately fabricated reports test gate mechanics only; no real model was run.
    const golden = await promotionFixture();
    const artifact = { ...golden, testFixtureOnly: true, candidateHash, baselineHash, guidance };
    artifact.bindingHash = evaluationBindingHash(artifact);
    Object.assign(artifact, overrides);
    const artifactPath = path.join(directory, 'eval.json');
    await fs.writeFile(artifactPath, JSON.stringify(artifact));
    config.mappings[0].evalArtifact = artifactPath;
    return artifactPath;
  }
  return { directory, config, localRoot, local, canonical, mirror, statePath, evalBaselinePath, plan, apply, gate };
}

test('hashes all auxiliary contents independent of mtime and honors uppercase marker', async (t) => {
  const f = await fixture(t);
  await fs.rm(f.local, { recursive: true });
  await skill(f.local, 'bytes', 'SKILL.MD');
  await fs.mkdir(path.join(f.local, 'fixtures'));
  await fs.writeFile(path.join(f.local, 'fixtures/a.json'), '{}');
  const first = await hashSkillTree(f.local);
  const records = ['SKILL.MD\0' + digest('bytes') + '\n', 'fixtures/a.json\0' + digest('{}') + '\n'];
  assert.equal(first.hash, digest(records.join('')));
  await fs.utimes(path.join(f.local, 'SKILL.MD'), new Date(0), new Date(0));
  assert.equal((await hashSkillTree(f.local)).hash, first.hash);
  await fs.writeFile(path.join(f.local, 'fixtures/a.json'), '{"changed":true}');
  assert.notEqual((await hashSkillTree(f.local)).hash, first.hash);
});

test('explicit apply checkpoints equal contents and reruns are idempotent', async (t) => {
  const f = await fixture(t);
  const before = await fs.stat(path.join(f.local, 'SKILL.md'));
  assert.equal((await f.plan()).actions[0].operation, 'current');
  assert.equal((await f.apply()).summary.checkpointed, 1);
  assert.equal((await f.plan()).inventoryChanges.length, 0);
  assert.equal((await f.apply()).summary.applied, 0);
  assert.equal((await fs.stat(path.join(f.local, 'SKILL.md'))).mtimeMs, before.mtimeMs);
});

test('local-to-canonical edit needs candidate-bound real behavioral evaluation', async (t) => {
  const f = await fixture(t); await f.apply();
  await skill(f.local, '# Valid changed case\n');
  assert.equal((await f.plan()).actions[0].operation, 'export-edit');
  assert.equal((await f.apply()).summary.blocked, 1);
  assert.equal(await fs.readFile(path.join(f.canonical, 'SKILL.md'), 'utf8'), '# Example\n');
  await f.gate();
  const report = await f.apply();
  assert.equal(report.summary.applied, 1);
  assert.equal((await hashSkillTree(f.canonical)).hash, (await hashSkillTree(f.local)).hash);
  assert.equal(await fs.readFile(path.join(report.outcomes[0].backups[0], 'SKILL.md'), 'utf8'), '# Example\n');
  assert.equal((await f.plan()).actions[0].operation, 'current');
});

test('canonical edits import and shared edits mirror evaluated contents', async (t) => {
  const f = await fixture(t, 'shared'); await f.apply();
  await skill(f.canonical, '# Canonical revision\n');
  await f.gate(f.canonical);
  assert.equal((await f.plan()).actions[0].operation, 'import-edit');
  assert.equal((await f.apply()).summary.applied, 1);
  const hashes = await Promise.all([f.local, f.canonical, f.mirror].map(async (target) => (await hashSkillTree(target)).hash));
  assert.equal(new Set(hashes).size, 1);
  assert.equal((await f.plan()).inventoryChanges.length, 0);
});

test('both-sided edits conflict and preserve both versions without checkpointing', async (t) => {
  const f = await fixture(t); await f.apply();
  const previous = (await readReconcileState(f.statePath)).entries.example;
  await skill(f.local, '# Local revision'); await skill(f.canonical, '# Canonical revision');
  assert.equal((await f.plan()).actions[0].operation, 'conflict');
  const report = await f.apply();
  assert.equal(report.outcomes[0].status, 'conflict-preserved');
  assert.equal(report.outcomes[0].backups.length, 2);
  assert.equal(await fs.readFile(path.join(report.outcomes[0].backups[0], 'SKILL.md'), 'utf8'), '# Local revision');
  assert.deepEqual((await readReconcileState(f.statePath)).entries.example, previous);
  const rerun = await f.apply();
  assert.deepEqual(rerun.outcomes[0].backups, report.outcomes[0].backups);
});

test('first observation divergence is conflict instead of newest-mtime overwrite', async (t) => {
  const f = await fixture(t); await skill(f.local, '# Existing local edits');
  assert.equal((await f.plan()).actions[0].operation, 'conflict');
});

test('failed and missing root scans preserve successful baseline and never imply removals', async (t) => {
  const f = await fixture(t); await f.apply();
  await fs.rename(f.localRoot, `${f.localRoot}-offline`);
  const plan = await f.plan();
  assert.equal(plan.inventory.roots[0].status, 'failed');
  assert.equal(plan.actions[0].operation, 'blocked');
  assert.deepEqual(plan.inventoryChanges.map((item) => item.kind), ['scan-failed']);
  await f.apply();
  assert.ok((await readReconcileState(f.statePath)).observations.codex.skills.example.hash);
  assert.equal(await fs.readFile(path.join(f.canonical, 'SKILL.md'), 'utf8'), '# Example\n');
});

test('one-sided and both-sided removals are proposals preserving reconciliation baseline', async (t) => {
  const f = await fixture(t); await f.apply();
  const previous = (await readReconcileState(f.statePath)).entries.example;
  await fs.rm(f.local, { recursive: true });
  assert.equal((await f.plan()).actions[0].operation, 'removal-proposal');
  assert.equal((await f.apply()).summary.blocked, 1);
  assert.deepEqual((await readReconcileState(f.statePath)).entries.example, previous);
  await fs.rm(f.canonical, { recursive: true });
  assert.equal((await f.plan()).actions[0].operation, 'removal-proposal');
  await f.apply();
  assert.deepEqual((await readReconcileState(f.statePath)).entries.example, previous);
});

test('unmapped additions, edits and removals are inventoried but never reconciled', async (t) => {
  const f = await fixture(t);
  const unknown = path.join(f.localRoot, 'unknown');
  await skill(unknown, '# Personal\n'); await f.apply();
  await skill(unknown, '# Edited personal\n');
  assert.equal((await f.plan()).inventoryChanges.find((item) => item.name === 'unknown').kind, 'edited');
  await f.apply();
  assert.equal(await fs.readFile(path.join(unknown, 'SKILL.md'), 'utf8'), '# Edited personal\n');
  await fs.rm(unknown, { recursive: true });
  assert.equal((await f.plan()).inventoryChanges.find((item) => item.name === 'unknown').kind, 'removal-proposal');
  assert.equal((await f.plan()).actions.length, 1);
  await f.apply();
  assert.equal((await f.plan()).inventoryChanges.find((item) => item.name === 'unknown').kind, 'removal-proposal');
});

test('symlinks, missing markers, system and bundled directories are not deletion evidence', async (t) => {
  const f = await fixture(t); await f.apply();
  await fs.rm(f.local, { recursive: true });
  await fs.symlink(f.canonical, f.local);
  for (const name of ['.system', 'plugins', 'bundled']) await skill(path.join(f.localRoot, name));
  const plan = await f.plan();
  assert.equal(plan.actions[0].operation, 'blocked');
  assert.ok(!plan.inventoryChanges.some((item) => item.kind === 'removal-proposal'));
  assert.equal(plan.inventory.roots[0].excluded.length, 4);
  await fs.rm(f.local); await fs.mkdir(f.local);
  assert.equal((await f.plan()).actions[0].operation, 'blocked');
});

test('new mapped skill addition is evaluated, safely creates missing package parents and becomes current', async (t) => {
  const f = await fixture(t);
  await fs.rm(path.join(f.config.canonicalRoot, 'packages/general'), { recursive: true });
  assert.equal((await f.plan()).actions[0].operation, 'export-add');
  assert.equal((await f.apply()).summary.blocked, 1);
  await f.gate();
  assert.equal((await f.apply()).summary.applied, 1);
  assert.equal((await f.plan()).actions[0].operation, 'current');
});

test('stale content, checkpoint, and eval hash refuse modification', async (t) => {
  const f = await fixture(t); await f.apply(); await skill(f.local, '# Candidate A'); await f.gate();
  const plan = await f.plan(); await skill(f.local, '# Candidate B');
  await assert.rejects(() => applySkillReconciliation(f.config, plan, { statePath: f.statePath }), /Stale plan/);
  assert.equal((await f.apply()).summary.blocked, 1);
  const fresh = await f.plan();
  const state = await readReconcileState(f.statePath); state.externalUpdate = true;
  await fs.writeFile(f.statePath, JSON.stringify(state));
  await assert.rejects(() => applySkillReconciliation(f.config, fresh, { statePath: f.statePath }), /Stale plan/);
});

test('same-version simultaneous external edits still require eval before advancing baseline', async (t) => {
  const f = await fixture(t); await f.apply();
  await skill(f.local, '# Both changed'); await skill(f.canonical, '# Both changed');
  assert.equal((await f.plan()).actions[0].operation, 'verify-edit');
  assert.equal((await f.apply()).summary.blocked, 1);
  await f.gate(); assert.equal((await f.apply()).summary.applied, 1);
});

test('shared content leakage and mirror conflicts are fail-closed', async (t) => {
  const f = await fixture(t, 'shared'); await f.apply();
  await skill(f.local, '# confidential fixture'); await f.gate();
  const blocked = await f.apply();
  assert.match(blocked.outcomes[0].reason, /Public boundary/);
  assert.equal(await fs.readFile(path.join(f.canonical, 'SKILL.md'), 'utf8'), '# Example\n');
  await skill(f.local, '# Public candidate'); await skill(f.mirror, '# Independent public edit');
  assert.equal((await f.plan()).actions[0].operation, 'conflict');
  assert.equal((await f.apply()).outcomes[0].backups.length, 3);
});

test('unsafe paths and private/shared classification are rejected', async (t) => {
  const f = await fixture(t);
  for (const canonical of ['../escape', 'packages/general/skills/..', 'packages/general/skills/../../outside', '/absolute']) assert.throws(() => validateReconcileConfig({ ...f.config, mappings: [{ ...f.config.mappings[0], canonical }] }), /Unsafe canonical/);
  assert.throws(() => validateReconcileConfig({ ...f.config, mappings: [{ ...f.config.mappings[0], classification: null }] }), /classification/);
  assert.throws(() => validateReconcileConfig({ ...f.config, mappings: [{ ...f.config.mappings[0], canonical: 'packages/private-workflows/skills/example', classification: 'shared' }] }), /Private path/);
  assert.throws(() => validateReconcileConfig({ ...f.config, publicMirrorRoot: f.config.canonicalRoot }), /separate/);
});

test('a shared mirror write failure rolls back canonical update and preserves installed candidate backup', async (t) => {
  const f = await fixture(t, 'shared'); await f.apply();
  const beforeState = (await readReconcileState(f.statePath)).entries.example;
  await skill(f.local, '# Public candidate'); await f.gate();
  const originalCopy = fs.cp;
  fs.cp = async (source, destination, ...rest) => {
    if (destination.startsWith(f.config.publicMirrorRoot) && path.basename(destination).startsWith('.skill-reconcile-')) throw new Error('Simulated mirror disk failure');
    return originalCopy(source, destination, ...rest);
  };
  let report;
  try { report = await f.apply(); } finally { fs.cp = originalCopy; }
  assert.equal(report.summary.blocked, 1);
  assert.match(report.outcomes[0].reason, /Simulated mirror/);
  assert.equal(await fs.readFile(path.join(f.canonical, 'SKILL.md'), 'utf8'), '# Example\n');
  assert.equal(await fs.readFile(path.join(f.mirror, 'SKILL.md'), 'utf8'), '# Example\n');
  assert.equal(await fs.readFile(path.join(f.local, 'SKILL.md'), 'utf8'), '# Public candidate');
  assert.deepEqual((await readReconcileState(f.statePath)).entries.example, beforeState);
  const rolledBack = report.outcomes[0].backups.find((name) => name.endsWith('rolled-back'));
  assert.equal(await fs.readFile(path.join(rolledBack, 'SKILL.md'), 'utf8'), '# Public candidate');
});

test('structural-only, synthetic, incomplete and absent evals do not satisfy behavioral gate', async (t) => {
  const f = await fixture(t);
  for (const overrides of [{ behavioralExecuted: false }, { evidenceKind: 'synthetic' }, { runtime: { adapterMode: 'smoke' } }, { promotion: { eligible: false } }, { cases: [] }, { status: 'execution_failed' }]) {
    const artifact = await f.gate(f.local, overrides);
    assert.equal((await validateSkillEval(artifact, (await hashSkillTree(f.local)).hash, f.config.mappings[0].evalBaselineHash)).eligible, false);
  }
  const artifactPath = await f.gate();
  const artifact = JSON.parse(await fs.readFile(artifactPath, 'utf8'));
  artifact.cases[0].candidate.execution.succeeded = false;
  await fs.writeFile(artifactPath, JSON.stringify(artifact));
  assert.equal((await validateSkillEval(artifactPath, artifact.candidateHash, artifact.baselineHash)).eligible, false);
});

test('a claimed eligible report cannot bypass semantic grading or predeclared policy', async (t) => {
  const f = await fixture(t);
  for (const field of ['grading', 'policy', 'bindingHash']) {
    const artifactPath = await f.gate();
    const artifact = JSON.parse(await fs.readFile(artifactPath, 'utf8'));
    delete artifact[field];
    artifact.promotion.eligible = true;
    await fs.writeFile(artifactPath, JSON.stringify(artifact));
    const rejected = await validateSkillEval(artifactPath, artifact.candidateHash, artifact.baselineHash);
    assert.equal(rejected.eligible, false, field);
    assert.match(rejected.reason, /Behavioral evidence gate failed/, field);
  }
});

test('a complete rebound tie cannot count as measured improvement', async (t) => {
  const f = await fixture(t);
  const artifactPath = await f.gate();
  const artifact = JSON.parse(await fs.readFile(artifactPath, 'utf8'));
  for (const item of artifact.cases) item.baseline = structuredClone(item.candidate);
  artifact.metrics = Object.fromEntries(['development', 'heldout'].map((split) => [split,
    Object.fromEntries(['baseline', 'candidate'].map((variant) => [variant,
      metrics(artifact.cases.filter((item) => item.split === split), variant)]))]));
  artifact.resultsHash = evaluationResultsHash(artifact);
  artifact.bindingHash = evaluationBindingHash(artifact);
  artifact.promotion.eligible = true;
  await fs.writeFile(artifactPath, JSON.stringify(artifact));
  const rejected = await validateSkillEval(artifactPath, artifact.candidateHash, artifact.baselineHash);
  assert.equal(rejected.eligible, false);
  assert.match(rejected.reason, /gain|improv|new true/i);
});

test('runtime and guidance changes invalidate an otherwise eligible behavioral report', async (t) => {
  const f = await fixture(t);
  for (const mutate of [
    (report) => { report.cases[0].candidate.execution.observedModel.name = 'different-model'; },
    (report) => { report.runtime.args = [...(report.runtime.args ?? []), '--changed-setting']; },
    (report) => { report.guidance.manifestSourceHash = digest('different manifest bytes'); report.guidance.mode = 'explicit'; report.guidance.manifestPath = '/absolute/manifest.json'; }
  ]) {
    const artifactPath = await f.gate();
    const artifact = JSON.parse(await fs.readFile(artifactPath, 'utf8'));
    mutate(artifact);
    artifact.promotion.eligible = true;
    await fs.writeFile(artifactPath, JSON.stringify(artifact));
    const rejected = await validateSkillEval(artifactPath, artifact.candidateHash, artifact.baselineHash);
    assert.equal(rejected.eligible, false);
    assert.match(rejected.reason, /Behavioral evidence gate failed/);
  }
});

test('outcomes cannot drop controls or rewrite the frozen oracle while retaining eligibility', async (t) => {
  const f = await fixture(t);
  for (const mutate of [
    (report) => { report.cases = report.cases.filter((item) => item.kind !== 'rejected'); },
    (report) => { report.cases.find((item) => item.expectedFindings.length).expectedFindings[0].defect = 'An unrelated invented defect'; },
    (report) => { report.coverage.heldout.boundary = 999; }
  ]) {
    const artifactPath = await f.gate();
    const artifact = JSON.parse(await fs.readFile(artifactPath, 'utf8'));
    mutate(artifact);
    // Rehashing edited outcomes must not allow them to drift from the input suite.
    artifact.resultsHash = evaluationResultsHash(artifact);
    artifact.bindingHash = evaluationBindingHash(artifact);
    artifact.promotion.eligible = true;
    await fs.writeFile(artifactPath, JSON.stringify(artifact));
    const rejected = await validateSkillEval(artifactPath, artifact.candidateHash, artifact.baselineHash);
    assert.equal(rejected.eligible, false);
  }
});

test('candidate evaluated against a weaker baseline is rejected before any overwrite', async (t) => {
  const f = await fixture(t); await f.apply();
  const previous = (await readReconcileState(f.statePath)).entries.example;
  await skill(f.local, '# Candidate change');
  await f.gate(f.local, { baselineHash: digest('different weaker baseline') });
  const blocked = await f.apply();
  assert.equal(blocked.summary.blocked, 1);
  assert.equal(await fs.readFile(path.join(f.canonical, 'SKILL.md'), 'utf8'), '# Example\n');
  assert.deepEqual((await readReconcileState(f.statePath)).entries.example, previous);
  await f.gate();
  const accepted = await f.apply();
  assert.equal(accepted.summary.applied, 1);
  assert.equal(accepted.outcomes[0].evalBaselineHash, previous.localHash);
  assert.equal((await hashSkillTree(accepted.outcomes[0].evalBaselinePath)).hash, previous.localHash);
});

test('older or unverified behavioral reports need regenerated guidance metadata', async (t) => {
  const f = await fixture(t); await f.apply(); await skill(f.local, '# Candidate');
  for (const guidance of [undefined, { version: 1, verified: false }]) {
    const artifactPath = await f.gate(f.local, { guidance });
    const rejected = await validateSkillEval(artifactPath, (await hashSkillTree(f.local)).hash, (await f.plan()).actions[0].baselineHash);
    assert.equal(rejected.eligible, false);
    assert.match(rejected.reason, /Verified guidance metadata required/);
    assert.equal((await f.apply()).summary.blocked, 1);
  }
  assert.equal(await fs.readFile(path.join(f.canonical, 'SKILL.md'), 'utf8'), '# Example\n');
});

test('guidance manifests reject unsafe and oracle paths even with consistent hashes', async (t) => {
  const f = await fixture(t); await f.apply(); await skill(f.local, '# Candidate');
  const unsafeNames = ['../rules.md', '/absolute.md', 'references\\rules.md', 'references//rules.md', 'references/./rules.md', 'references/rules:payload.md', 'references/zero\0byte.md', 'evals/cases.json', 'references/oracle.json', 'result.json', 'references/ground-truth.md', 'expected_findings.json'];
  for (const name of unsafeNames) {
    const artifactPath = await f.gate();
    const artifact = JSON.parse(await fs.readFile(artifactPath, 'utf8'));
    artifact.guidance.manifest.candidateFiles = ['SKILL.md', name].sort();
    artifact.guidance.candidate.files = artifact.guidance.manifest.candidateFiles.map((path) => ({ path, hash: digest('fixture') }));
    refreshGuidanceHashes(artifact.guidance);
    await fs.writeFile(artifactPath, JSON.stringify(artifact));
    const rejected = await validateSkillEval(artifactPath, artifact.candidateHash, artifact.baselineHash);
    assert.equal(rejected.eligible, false, name);
    assert.match(rejected.reason, /guidance|manifest/i, name);
  }
});

test('guidance gate rejects missing marker, duplicate paths, invalid file hash and tampered digests', async (t) => {
  const f = await fixture(t); await f.apply(); await skill(f.local, '# Candidate');
  const mutations = [
    (g) => { g.manifestHash = digest('tampered'); },
    (g) => { g.baseline.hash = digest('tampered'); },
    (g) => { g.candidate.files[0].hash = 'not-a-hash'; refreshGuidanceHashes(g); },
    (g) => { g.manifest.candidateFiles = ['references/rules.md']; g.candidate.files = [{ path: 'references/rules.md', hash: digest('fixture') }]; refreshGuidanceHashes(g); },
    (g) => { g.manifest.baselineFiles.push('SKILL.md'); g.baseline.files.push({ ...g.baseline.files[0] }); refreshGuidanceHashes(g); },
    (g) => { g.manifest.unexpected = true; refreshGuidanceHashes(g); },
    (g) => { g.candidate.files[0].content = '{"expectedFindings":[]}'; },
    (g) => { g.mode = 'explicit'; g.manifestSourceHash = null; g.manifestPath = '/absolute/manifest.json'; }
  ];
  for (const mutate of mutations) {
    const artifactPath = await f.gate();
    const artifact = JSON.parse(await fs.readFile(artifactPath, 'utf8'));
    mutate(artifact.guidance);
    await fs.writeFile(artifactPath, JSON.stringify(artifact));
    assert.equal((await validateSkillEval(artifactPath, artifact.candidateHash, artifact.baselineHash)).eligible, false);
  }
});

test('apply rejects internally consistent guidance hashes that disagree with bound file contents', async (t) => {
  const f = await fixture(t); await f.apply(); await skill(f.local, '# Candidate');
  const previous = (await readReconcileState(f.statePath)).entries.example;
  const artifactPath = await f.gate();
  const artifact = JSON.parse(await fs.readFile(artifactPath, 'utf8'));
  artifact.guidance.candidate.files[0].hash = digest('different prompt contents');
  refreshGuidanceHashes(artifact.guidance);
  await fs.writeFile(artifactPath, JSON.stringify(artifact));
  const direct = await validateSkillEval(artifactPath, artifact.candidateHash, artifact.baselineHash);
  assert.equal(direct.eligible, false);
  assert.match(direct.reason, /Implicit guidance hashes must match/);
  const rejected = await f.apply();
  assert.equal(rejected.summary.blocked, 1);
  assert.match(rejected.outcomes[0].reason, /does not match bound skill contents/);
  assert.equal(await fs.readFile(path.join(f.canonical, 'SKILL.md'), 'utf8'), '# Example\n');
  assert.deepEqual((await readReconcileState(f.statePath)).entries.example, previous);
});

test('implicit guidance cannot omit an auxiliary file while claiming the full tree was safe', async (t) => {
  const f = await fixture(t); await f.apply(); await skill(f.local, '# Candidate');
  await fs.mkdir(path.join(f.local, 'references'));
  await fs.writeFile(path.join(f.local, 'references/rules.md'), '# Additional review guidance');
  const artifactPath = await f.gate();
  const artifact = JSON.parse(await fs.readFile(artifactPath, 'utf8'));
  artifact.guidance.manifest.candidateFiles = ['SKILL.md'];
  artifact.guidance.candidate.files = artifact.guidance.candidate.files.filter((file) => file.path === 'SKILL.md');
  refreshGuidanceHashes(artifact.guidance);
  await fs.writeFile(artifactPath, JSON.stringify(artifact));
  const rejected = await f.apply();
  assert.equal(rejected.summary.blocked, 1);
  assert.match(rejected.outcomes[0].reason, /implicit guidance omitted/);
});

test('apply rejects oracle JSON renamed as safe-looking selected guidance despite consistent metadata', async (t) => {
  const f = await fixture(t); await f.apply(); await skill(f.local, '# Candidate');
  const previous = (await readReconcileState(f.statePath)).entries.example;
  await fs.mkdir(path.join(f.local, 'references'));
  await fs.writeFile(path.join(f.local, 'references/review-guidance.md'), '{"expectedFindings":[{"ruleId":"fixture-oracle"}]}');
  await f.gate();
  const rejected = await f.apply();
  assert.equal(rejected.summary.blocked, 1);
  assert.match(rejected.outcomes[0].reason, /serialized oracle\/outcome content prohibited in candidate\/references\/review-guidance.md/);
  assert.equal(await fs.readFile(path.join(f.canonical, 'SKILL.md'), 'utf8'), '# Example\n');
  assert.deepEqual((await readReconcileState(f.statePath)).entries.example, previous);
});

test('apply also rejects renamed oracle content in the selected explicit baseline', async (t) => {
  const f = await fixture(t);
  await fs.rm(f.canonical, { recursive: true });
  await fs.mkdir(path.join(f.evalBaselinePath, 'references'));
  await fs.writeFile(path.join(f.evalBaselinePath, 'references/review-guidance.md'), '{"strict_classification":"oracle"}');
  f.config.mappings[0].evalBaselineHash = (await hashSkillTree(f.evalBaselinePath)).hash;
  await f.gate();
  const rejected = await f.apply();
  assert.equal(rejected.summary.blocked, 1);
  assert.match(rejected.outcomes[0].reason, /serialized oracle\/outcome content prohibited in baseline/);
  await assert.rejects(() => fs.stat(f.canonical), { code: 'ENOENT' });
});

test('valid explicit behavioral guidance can omit eval artifacts while keeping full tree bindings', async (t) => {
  const f = await fixture(t); await f.apply(); await skill(f.local, '# Candidate');
  await fs.mkdir(path.join(f.local, 'evals'));
  await fs.writeFile(path.join(f.local, 'evals/oracle.json'), '{"expectedFindings":[]}');
  const artifactPath = await f.gate();
  const artifact = JSON.parse(await fs.readFile(artifactPath, 'utf8'));
  const guidance = artifact.guidance;
  guidance.mode = 'explicit';
  guidance.manifest.candidateFiles = ['SKILL.md'];
  guidance.candidate.files = guidance.candidate.files.filter((file) => file.path === 'SKILL.md');
  refreshGuidanceHashes(guidance);
  guidance.manifestSourceHash = digest(JSON.stringify(guidance.manifest, null, 2));
  guidance.manifestPath = path.join(f.directory, 'prompt-files.json');
  artifact.bindingHash = evaluationBindingHash(artifact);
  await fs.writeFile(guidance.manifestPath, JSON.stringify(guidance.manifest, null, 2));
  await fs.writeFile(artifactPath, JSON.stringify(artifact));
  assert.notEqual(guidance.candidate.hash, artifact.candidateHash);
  const accepted = await f.apply();
  assert.equal(accepted.summary.applied, 1);
  assert.equal((await hashSkillTree(f.canonical)).hash, artifact.candidateHash);
  assert.equal(await fs.readFile(path.join(f.canonical, 'evals/oracle.json'), 'utf8'), '{"expectedFindings":[]}');
});

test('first addition requires a verified immutable existing review workflow baseline', async (t) => {
  const f = await fixture(t);
  await fs.rm(f.canonical, { recursive: true });
  const mapping = f.config.mappings[0];
  const referenceHash = mapping.evalBaselineHash;
  delete mapping.evalBaselineHash; delete mapping.evalBaselinePath;
  await f.gate(f.local, { baselineHash: referenceHash });
  const missing = await f.apply();
  assert.equal(missing.summary.blocked, 1);
  assert.match(missing.outcomes[0].reason, /baseline hash required/);
  mapping.evalBaselineHash = referenceHash; mapping.evalBaselinePath = f.evalBaselinePath;
  await f.gate();
  await skill(f.evalBaselinePath, '# Mutated baseline reference');
  const mutated = await f.apply();
  assert.equal(mutated.summary.blocked, 1);
  assert.match(mutated.outcomes[0].reason, /Baseline contents unavailable or changed/);
  await skill(f.evalBaselinePath);
  const accepted = await f.apply();
  assert.equal(accepted.summary.applied, 1);
  assert.equal((await hashSkillTree(accepted.outcomes[0].evalBaselinePath)).hash, referenceHash);
});

test('converged edits must use retained previous contents rather than the changed candidate as baseline', async (t) => {
  const f = await fixture(t); await f.apply();
  const previous = (await readReconcileState(f.statePath)).entries.example;
  await skill(f.local, '# Converged'); await skill(f.canonical, '# Converged');
  const plan = await f.plan();
  assert.equal(plan.actions[0].baselineHash, previous.localHash);
  assert.equal(plan.actions[0].baselineSource, previous.baselinePath);
  assert.equal((await hashSkillTree(previous.baselinePath)).hash, previous.localHash);
  await f.gate(f.local, { baselineHash: (await hashSkillTree(f.local)).hash });
  assert.equal((await f.apply()).summary.blocked, 1);
});

test('a destination edit immediately before backup rename is restored and candidate is blocked', async (t) => {
  const f = await fixture(t); await f.apply();
  const beforeState = (await readReconcileState(f.statePath)).entries.example;
  await skill(f.local, '# Proposed change'); await f.gate();
  const originalRename = fs.rename;
  let injected = false;
  fs.rename = async (source, destination) => {
    if (!injected && source === f.canonical) { injected = true; await skill(f.canonical, '# Concurrent newer edit'); }
    return originalRename(source, destination);
  };
  let report;
  try { report = await f.apply(); } finally { fs.rename = originalRename; }
  assert.equal(injected, true);
  assert.equal(report.summary.blocked, 1);
  assert.match(report.outcomes[0].reason, /Destination changed during backup move/);
  assert.equal(await fs.readFile(path.join(f.canonical, 'SKILL.md'), 'utf8'), '# Concurrent newer edit');
  assert.equal(await fs.readFile(path.join(f.local, 'SKILL.md'), 'utf8'), '# Proposed change');
  assert.deepEqual((await readReconcileState(f.statePath)).entries.example, beforeState);
});

test('changed personal root path never carries old-root removal tombstones into new observations', async (t) => {
  const f = await fixture(t);
  await skill(path.join(f.localRoot, 'old-root-only')); await f.apply();
  const newRoot = path.join(f.directory, 'replacement-personal');
  await fs.mkdir(newRoot);
  f.config.localRoots.codex = newRoot;
  f.config.mappings = [];
  const report = await f.apply();
  assert.ok(!report.inventoryChanges.some((item) => item.kind === 'removal-proposal'));
  const observation = (await readReconcileState(f.statePath)).observations.codex;
  assert.equal(observation.path, newRoot);
  assert.deepEqual(observation.skills, {});
});

test('malformed state is never reset and locks preserve concurrent work', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(f.statePath, '{broken');
  await assert.rejects(() => readReconcileState(f.statePath), /refusing reset/);
  await fs.rm(f.statePath);
  const plan = await f.plan();
  await fs.writeFile(`${f.statePath}.lock`, 'another run');
  await assert.rejects(() => applySkillReconciliation(f.config, plan, { statePath: f.statePath }), /lock unavailable/);
  assert.equal(await fs.readFile(`${f.statePath}.lock`, 'utf8'), 'another run');
});

test('converted command wrappers are source-marker proposals and preview has no skill/checkpoint writes', async (t) => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.config.canonicalRoot, 'packages/general/commands'), { recursive: true });
  await fs.writeFile(path.join(f.config.canonicalRoot, 'packages/general/commands/run.md'), '# Run');
  await skill(path.join(f.localRoot, 'source-command-run'), '<!-- Converted from /home/example/.codex/commands/run.md. Keep source. -->\n# Run');
  const configPath = path.join(f.directory, 'config.json');
  const reportPath = path.join(f.directory, 'report.json');
  await fs.writeFile(configPath, JSON.stringify(f.config));
  const report = await runSkillReconciliation({ configPath, statePath: f.statePath, reportPath });
  assert.equal(report.proposals[0].kind, 'converted-command-candidate');
  await assert.rejects(() => fs.stat(f.statePath), { code: 'ENOENT' });
  assert.equal(JSON.parse(await fs.readFile(reportPath)).mode, 'preview');
});

test('effective CODEX_HOME defaults are honored without mutating environment', () => {
  assert.deepEqual(defaultLocalRoots({ CODEX_HOME: '/personal/custom' }, '/home/person'), { codex: '/personal/custom/skills', agents: '/home/person/.agents/skills' });
});
