import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseAdapterOptions, reviewWithCodex } from './codex-adapter.js';

const pins = { model: 'test-model', reasoningEffort: 'medium' };
const review = { allowedRules: [{ id: 'test' }], code: { file: 'test.js', content: 'return value;' }, context: '', skill: {} };
async function fakeCodex(t, { result = { findings: [] }, observedModel = 'test-model', effort = 'medium', version = '0.test', retainsSkills = false, invalidPrompt = false, aliasedSkills = false, wait = false } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'codex-adapter-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const command = path.join(directory, 'codex'); const record = path.join(directory, 'record.json');
  const skillCatalog = aliasedSkills ? '### Skill roots\n- `r0` = `/global/skills`\n### Available skills\n- sample (file: r0/sample/SKILL.md)' : '### Available skills\n- sample (file: /global/skills/sample/SKILL.md)';
  const source = `#!${process.execPath}
const fs=require('node:fs');const path=require('node:path');const args=process.argv.slice(2);
if(args[0]==='debug'){
  const configured=args.some(arg=>arg.startsWith('skills.config='));
  process.stdout.write(${JSON.stringify(invalidPrompt ? 'not-json' : null)}??JSON.stringify([{content:[{text:!configured||${retainsSkills}?${JSON.stringify(skillCatalog)}:'Isolated prompt.'}]}]));process.exit(0);
}
let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{
  fs.writeFileSync(${JSON.stringify(record)},JSON.stringify({args,input,keys:Object.keys(process.env),cwd:process.cwd(),taskHome:process.env.CODEX_HOME,pid:process.pid}));
  fs.writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify(${JSON.stringify(result)}));
  process.stderr.write(${JSON.stringify(`OpenAI Codex v${version}\nmodel: ${observedModel}\nreasoning effort: ${effort}\nprovider: openai\n`)});
  if(${wait})setInterval(()=>{},1000);
});`;
  await writeFile(command, source, { mode: 0o700 });
  return { command, authHome: directory, record };
}

test('explicit model and effort are required and parsed literally', async () => {
  assert.deepEqual(parseAdapterOptions(['--model', 'gpt-5.4', '--reasoning-effort', 'medium']), { model: 'gpt-5.4', reasoningEffort: 'medium' });
  assert.deepEqual(parseAdapterOptions(['--reasoning-effort', 'xhigh', '--model', 'gpt-5.4']), { model: 'gpt-5.4', reasoningEffort: 'xhigh' });
  for (const args of [[], ['--model', 'x'], ['--reasoning-effort', 'medium'], ['--model', 'x', '--reasoning-effort', 'ultra'], ['--model', 'x;touch /tmp/no', '--reasoning-effort', 'medium'], ['--model', 'x', '--reasoning-effort', 'medium', '--model', 'y'], ['--unknown', 'x']]) assert.throws(() => parseAdapterOptions(args), /Usage/);
  await assert.rejects(reviewWithCodex(review, { model: 'x', reasoningEffort: 'ultra' }), /Unsupported explicit/);
  await assert.rejects(reviewWithCodex(review, { reasoningEffort: 'medium' }), /model pin/);
});

test('isolated runtime records pins and confirmed identity and removes its auth workspace', async (t) => {
  const fake = await fakeCodex(t); const initialListeners = process.listenerCount('SIGTERM'); const response = await reviewWithCodex({ ...review, task: 'review_code' }, { ...fake, ...pins });
  const record = JSON.parse(await readFile(fake.record, 'utf8'));
  assert.equal(record.args[record.args.indexOf('--model') + 1], pins.model);
  for (const flag of ['--ephemeral', '--ignore-user-config', '--ignore-rules', '--skip-git-repo-check']) assert.ok(record.args.includes(flag));
  assert.equal(record.args[record.args.indexOf('--sandbox') + 1], 'read-only');
  assert.ok(record.args.includes('model_reasoning_effort=medium')); assert.ok(record.args.includes('features.shell_tool=false')); assert.ok(record.args.includes('web_search="disabled"'));
  assert.ok(record.args.some((arg) => arg.includes('/global/skills/sample/SKILL.md') && arg.includes('enabled=false')));
  assert.ok(record.input.includes('Do not use tools')); assert.ok(!record.keys.includes('CODEX_THREAD_ID'));
  assert.equal(response.model.name, pins.model); assert.equal(response.model.version, '0.test'); assert.equal(response.model.selection, 'explicit');
  assert.equal(response.model.effectiveReasoningEffort, pins.reasoningEffort); assert.equal(response.model.isolation.skillCatalogAbsent, true);
  assert.equal(response.model.binaryPath, await realpath(fake.command)); assert.match(response.model.binaryHash, /^[a-f0-9]{64}$/);
  assert.equal(process.listenerCount('SIGTERM'), initialListeners);
  assert.ok(response.model.args.includes('<TEMP>')); assert.ok(!JSON.stringify(response).includes(record.taskHome));
  await assert.rejects(readFile(path.join(record.taskHome, 'auth.json')), /ENOENT/);
});

test('unconfirmed pins, version and remaining inherited skills fail closed', async (t) => {
  for (const options of [{ observedModel: 'substitute' }, { effort: 'high' }, { version: '' }, { retainsSkills: true }, { invalidPrompt: true }]) {
    const fake = await fakeCodex(t, options);
    await assert.rejects(reviewWithCodex(review, { ...fake, ...pins }), /confirm|version|isolation|JSON/);
  }
  await assert.rejects(reviewWithCodex(review, { ...pins, command: '/missing/codex' }), /Codex unavailable/);
});

test('current runtime skill-root aliases are resolved before disabling skills', async (t) => {
  const fake = await fakeCodex(t, { aliasedSkills: true });
  await reviewWithCodex(review, { ...fake, ...pins });
  const record = JSON.parse(await readFile(fake.record, 'utf8'));
  assert.ok(record.args.some((argument) => argument.startsWith('skills.config=') && argument.includes('/global/skills/sample/SKILL.md') && !argument.includes('r0/sample')));
});

test('wrapper SIGTERM kills the active CLI child and removes its copied credential directory', async (t) => {
  const fake = await fakeCodex(t, { wait: true });
  await writeFile(path.join(fake.authHome, 'auth.json'), '{"testCredential":"private-sentinel"}', { mode: 0o600 });
  const adapter = fileURLToPath(new URL('./codex-adapter.js', import.meta.url));
  const child = spawn(process.execPath, [adapter, '--model', pins.model, '--reasoning-effort', pins.reasoningEffort], { env: { ...process.env, CODEX_CLI_PATH: fake.command, CODEX_HOME: fake.authHome }, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => child.kill('SIGKILL'));
  let stderr = ''; child.stderr.on('data', (chunk) => { stderr += chunk; }); child.stdout.resume(); child.stdin.end(JSON.stringify(review));
  let record;
  for (let i = 0; i < 300; i++) { try { record = JSON.parse(await readFile(fake.record, 'utf8')); break; } catch (error) { if (error.code !== 'ENOENT') throw error; await new Promise((resolve) => setTimeout(resolve, 10)); } }
  assert.ok(record, 'CLI child reached active execution');
  assert.match(await readFile(path.join(record.taskHome, 'auth.json'), 'utf8'), /private-sentinel/);
  const closed = once(child, 'close'); child.kill('SIGTERM'); const [exitCode] = await closed;
  assert.equal(exitCode, 1); assert.match(stderr, /cancelled/); assert.ok(!stderr.includes('private-sentinel'));
  await assert.rejects(readFile(path.join(record.taskHome, 'auth.json')), /ENOENT/);
  assert.throws(() => process.kill(record.pid, 0), { code: 'ESRCH' });
});

test('judge evaluates substantive explanation and accepts rejected findings without retuning', async (t) => {
  const judgments = [{ actualIndex: 0, expectedIndex: 0, defect: false, scope: true, remedy: false, reason: 'Same ID and file, but the stated defect and remedy contradict the caller contract.' }];
  const fake = await fakeCodex(t, { result: { judgments } });
  const request = { task: 'adjudicate_findings', code: review.code, context: '', reviewContext: { contracts: ['value can be zero'] }, findings: [{ ruleId: 'test', file: 'test.js', line: 1, message: 'Zero is missing; reject zero.' }], expectedFindings: [{ ruleId: 'test', file: 'test.js', line: 1, explanation: 'Only undefined is missing.' }] };
  assert.deepEqual((await reviewWithCodex(request, { ...fake, ...pins })).judgments, judgments);
  const record = JSON.parse(await readFile(fake.record, 'utf8'));
  assert.match(record.input, /Rule IDs, files and lines alone never prove correctness/); assert.match(record.input, /Do not invent a remedy/);
  assert.ok(!record.input.includes('"skill"')); assert.ok(!record.input.includes('"arm"'));
});

test('judge rejects missing, duplicate and out-of-range indices and missing semantic explanation', async (t) => {
  const valid = { actualIndex: 0, expectedIndex: 0, defect: true, scope: true, remedy: true, reason: 'Concrete defect and correction.' };
  const request = { task: 'adjudicate_findings', findings: [{}, {}], expectedFindings: [{}] };
  for (const judgments of [[valid], [valid, valid], [valid, { ...valid, actualIndex: 1, expectedIndex: 5 }], [valid, { ...valid, actualIndex: 1, reason: '' }], [valid, { ...valid, actualIndex: 1, defect: 'yes' }]]) {
    const fake = await fakeCodex(t, { result: { judgments } });
    await assert.rejects(reviewWithCodex(request, { ...fake, ...pins }), /adjudication/);
  }
});

test('unknown rules and malformed finding explanations fail at the response boundary', async (t) => {
  for (const finding of [{ ruleId: 'unknown', file: 'test.js', line: 1, message: 'Defect.' }, { ruleId: 'test', file: '', line: 1, message: 'Defect.' }, { ruleId: 'test', file: 'test.js', line: 0, message: 'Defect.' }, { ruleId: 'test', file: 'test.js', line: 1, message: '' }]) {
    const fake = await fakeCodex(t, { result: { findings: [finding] } });
    await assert.rejects(reviewWithCodex(review, { ...fake, ...pins }), /invalid findings/);
  }
});
