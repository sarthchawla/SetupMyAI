import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { installPackage } from './installer.js';
import { getPackage, SUPPORTED_TOOLS } from './packages.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const bundle = path.join(root, 'packages/pstack');
const revision = 'e44668c2aad92eacf4e84df47984121fefb11b82';

async function tree(directory, prefix = '') {
  const files = {};
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(files, await tree(absolute, relative));
    else {
      assert.ok(entry.isFile(), `Unexpected non-file: ${absolute}`);
      files[relative] = createHash('sha256').update(await fs.readFile(absolute)).digest('hex');
    }
  }
  return files;
}

test('pstack is optional, registered, pinned, and complete', async () => {
  assert.equal(getPackage('pstack').name, '@setupmyai/pstack');
  assert.equal(getPackage('pstack').tier, 2);
  const apm = YAML.parse(await fs.readFile(path.join(root, 'apm.yml'), 'utf8'));
  assert.ok(apm.packages.includes('packages/pstack'));
  const provenance = await fs.readJson(path.join(bundle, 'UPSTREAM.json'));
  assert.equal(provenance.revision, revision);
  const actual = await tree(bundle);
  delete actual['UPSTREAM.json'];
  assert.deepEqual(actual, provenance.files);
  for (const relative of Object.keys(actual).filter(name => name.startsWith('skills/poteto-help/') && name.endsWith('.md'))) {
    const file = path.join(bundle, relative);
    const markdown = await fs.readFile(file, 'utf8');
    for (const [, href] of markdown.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(href)) continue;
      assert.ok(await fs.pathExists(path.resolve(path.dirname(file), href.split('#')[0])), `${relative}: ${href}`);
    }
  }
  const skills = await fs.readdir(path.join(bundle, 'skills'));
  assert.equal(skills.length, 56);
  for (const skill of skills) {
    const directory = path.join(bundle, 'skills', skill);
    assert.match(await fs.readFile(path.join(directory, 'LICENSE'), 'utf8'), /2026 Lauren Tan/);
    if (/^disable-model-invocation: true$/m.test(await fs.readFile(path.join(directory, 'SKILL.md'), 'utf8'))) {
      const metadata = YAML.parse(await fs.readFile(path.join(directory, 'agents/openai.yaml'), 'utf8'));
      assert.equal(metadata.policy.allow_implicit_invocation, false, skill);
    }
  }
  for (const relative of [
    'poteto-mode/playbooks/feature.md',
    'poteto-mode/scripts/bootstrap.ts',
    'poteto-mode/scripts/bun.lock',
    'poteto-mode/scripts/watch-pr/watch-pr',
    'poteto-help/docs/guide/01-setup.md',
    'no-comments/references/comment-sicko.md',
  ]) assert.ok(await fs.pathExists(path.join(bundle, 'skills', relative)), relative);
});

test('pstack installs complete skill trees for every supported tool without activating a mode', async () => {
  const target = await fs.mkdtemp(path.join(os.tmpdir(), 'pstack-install-'));
  try {
    const expected = await tree(path.join(bundle, 'skills'));
    assert.equal(await installPackage('pstack', target, { tool: 'all' }), 56 * SUPPORTED_TOOLS.length);
    for (const tool of SUPPORTED_TOOLS) {
      const toolRoot = path.join(target, tool === 'codex' ? '.agents' : `.${tool}`);
      assert.deepEqual(await tree(path.join(toolRoot, 'skills')), expected, tool);
      assert.deepEqual(await fs.readdir(toolRoot), ['skills'], tool);
      assert.ok((await fs.stat(path.join(toolRoot, 'skills/poteto-mode/scripts/worktree-audit.sh'))).mode & 0o111);
    }
    assert.ok(!(await fs.pathExists(path.join(target, '.codex'))));
  } finally {
    await fs.remove(target);
  }
});

test('CLI installs pstack for Codex at project and user level with an isolated home', async () => {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'pstack-cli-'));
  try {
    const project = path.join(sandbox, 'project');
    const home = path.join(sandbox, 'home');
    await fs.ensureDir(home);
    const env = { ...process.env, HOME: home, USERPROFILE: home };
    for (const level of ['project', 'user']) {
      const output = execFileSync(process.execPath, [path.join(root, 'cli/bin/index.js'), 'install', 'pstack', '--tool', 'codex', '--level', level, '--dir', project], { env, encoding: 'utf8' });
      assert.match(output, /pstack.*56 items/);
      assert.deepEqual(await tree(path.join(level === 'user' ? home : project, '.agents/skills')), await tree(path.join(bundle, 'skills')));
    }
    assert.deepEqual(await fs.readdir(home), ['.agents']);
  } finally {
    await fs.remove(sandbox);
  }
});
