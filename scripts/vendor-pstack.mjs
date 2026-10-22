#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = 'https://github.com/backnotprop/pstack';
const revision = 'e44668c2aad92eacf4e84df47984121fefb11b82';
const target = fileURLToPath(new URL('../packages/pstack/', import.meta.url));
const args = process.argv.slice(2);
const check = args.includes('--check');
const sources = args.filter(arg => arg !== '--check');
assert(sources.length <= 1 && sources.every(arg => !arg.startsWith('-')),
  'Usage: node scripts/vendor-pstack.mjs [--check] [upstream-checkout]');
const temporary = sources.length ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'vendor-pstack-'));
const source = sources.length ? path.resolve(sources[0]) : path.join(temporary, 'upstream.git');
const git = (...argv) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-C', source, ...argv]);
const files = new Map();
const put = (name, data, mode = 0o644) => files.set(name, {
  data: Buffer.isBuffer(data) ? data : Buffer.from(data), mode,
});
const pinned = (name) => `${repository}/${name.endsWith('/') ? 'tree' : 'blob'}/${revision}/${name}`;

try {
  if (temporary) execFileSync('git', ['-c', 'core.hooksPath=/dev/null', 'clone', '--bare', '--quiet', `${repository}.git`, source], { stdio: 'inherit' });
  assert.equal(git('rev-parse', `${revision}^{commit}`).toString().trim(), revision);
  const entries = git('ls-tree', '-rz', '--full-tree', revision, '--', 'skills', 'docs', 'README.md', 'LICENSE')
    .toString().split('\0').filter(Boolean);
  for (const entry of entries) {
    const [, mode, name] = /^(100644|100755) blob [0-9a-f]{40}\t(.+)$/.exec(entry) ?? [];
    assert(name, `Unsupported upstream entry: ${entry}`);
    let data = git('show', `${revision}:${name}`);
    let destination = name;
    if (name === 'README.md') {
      destination = 'skills/poteto-help/README.md';
      data = data.toString().replaceAll('(./skills/', '(../')
        .replace(/\(\.\/(agents|automations)\/([^)]*)\)/g, (_, dir, rest) => `(${pinned(`${dir}/${rest}`)})`);
    } else if (name.startsWith('docs/')) {
      destination = `skills/poteto-help/${name}`;
      if (name.endsWith('.md')) data = data.toString().replaceAll('(../../skills/', '(../../../')
        .replace(/\(\.\.\/\.\.\/(agents|automations)\/([^)]*)\)/g, (_, dir, rest) => `(${pinned(`${dir}/${rest}`)})`);
    } else if (name === 'skills/poteto-help/SKILL.md') {
      data = data.toString().replaceAll('../../README.md', 'README.md').replaceAll('../../docs/', 'docs/');
    }
    put(destination, data, Number.parseInt(mode, 8) & 0o777);
  }
  const skills = [...files.keys()].filter(name => /^skills\/[^/]+\/SKILL\.md$/.test(name));
  assert.equal(skills.length, 56, 'Pinned pstack skill inventory changed');
  for (const skill of skills) {
    const directory = path.posix.dirname(skill);
    put(`${directory}/LICENSE`, files.get('LICENSE').data);
    if (/^disable-model-invocation: true$/m.test(files.get(skill).data.toString())) {
      put(`${directory}/agents/openai.yaml`, 'policy:\n  allow_implicit_invocation: false\n');
    }
  }
  put('apm.yml', `name: "@setupmyai/pstack"
version: 1.0.0
description: "Pinned pstack skills and supporting workflows"
primitives:
  skills:
    - skills/*/SKILL.md
`);
  put('README.md', `# pstack

Optional shared/public bundle of all 56 [pstack skills](${repository}/tree/${revision}/skills), including 24 principles. The source is pinned to [\`${revision}\`](${repository}/commit/${revision}) (upstream plugin version 0.15.28).

Install the complete bundle so sibling skill references resolve:

\`\`\`sh
setupmyai install --tool codex pstack
\`\`\`

Choose another supported tool with \`--tool\`. Installing does not invoke a skill, activate \`poteto-mode\`, change model settings, or create automations. Invoke \`/poteto-help\` for guidance or explicitly request \`/poteto-mode\` for its workflows. \`/setup-pstack\` is optional and confirms model choices before writing its settings file (\`~/.agents/pstack-models.md\` in Codex). Only that setup skill allows automatic invocation from matching requests; the other 55 preserve upstream's \`disable-model-invocation: true\` and include Codex-native \`agents/openai.yaml\` with \`policy.allow_implicit_invocation: false\`.

## Runtime requirements

Reading skills needs no extra runtime. Optional executable workflows need:

- Bun and authenticated GitHub CLI (\`gh\`) for \`poteto-mode/scripts/watch-pr/watch-pr\`. Its first run installs dependencies with \`bun install --frozen-lockfile\`; the pinned package and lockfile are retained.
- Bun, Git, and GitHub CLI or Origin for the orchestration CLI in \`poteto-mode/scripts/orch/\`.
- Node.js for \`poteto-mode/scripts/check-plan.mjs\`.
- Bash for \`show-me-your-work/scripts/log.sh\`; Bash, Git, and jq for \`poteto-mode/scripts/worktree-audit.sh\` (GitHub CLI or Origin adds PR data).

These tools are retained, never run by the installer. Upstream workflows can create commits, PRs, messages, settings, and cleanup actions when invoked; the host's permissions and the user's instructions still apply. The upstream Harness section supplies fallbacks for Cursor-specific tools and unavailable models.

## Provenance and refresh

[MIT LICENSE](LICENSE), copyright 2026 Lauren Tan. Every installed skill includes the same license. \`UPSTREAM.json\` records the repository, revision, and SHA-256 of every package file except itself.

From the repository root, regenerate from the pinned Git objects or verify the existing package:

\`\`\`sh
node scripts/vendor-pstack.mjs [upstream-checkout]
node scripts/vendor-pstack.mjs --check [upstream-checkout]
\`\`\`

Omitting the checkout clones upstream into a temporary bare repository. The script reads committed blobs at the pin, so local source edits cannot enter the bundle. It rebuilds this generated package and never installs dependencies or executes upstream scripts.

The complete recursive \`skills/\` tree is retained. To keep help portable after individual skill folders are installed, upstream README and docs (including images) live inside \`poteto-help/\`. The skill prose changes only in help/documentation paths, and 55 Codex policy files preserve upstream's explicit-invocation intent. Sibling skill links remain local; optional Cursor agent and automation pack links point to the pinned upstream files. Those optional packs are not installed or enabled.
`);
  const hashes = Object.fromEntries([...files].sort(([a], [b]) => a.localeCompare(b)).map(([name, file]) =>
    [name, createHash('sha256').update(file.data).digest('hex')]));
  put('UPSTREAM.json', `${JSON.stringify({ repository, revision, license: 'MIT', files: hashes }, null, 2)}\n`);
  if (check) {
    const actual = fs.readdirSync(target, { recursive: true }).filter(name => {
      const stat = fs.lstatSync(path.join(target, name));
      assert(!stat.isSymbolicLink(), `Unexpected symlink: ${name}`);
      return stat.isFile();
    });
    assert.deepEqual(actual.sort(), [...files.keys()].sort(), 'Package file inventory differs');
    for (const [name, file] of files) {
      const absolute = path.join(target, name);
      assert(fs.readFileSync(absolute).equals(file.data), `Content differs: ${name}`);
      assert.equal(fs.statSync(absolute).mode & 0o111, file.mode & 0o111, `Executable mode differs: ${name}`);
    }
  } else {
    const staging = fs.mkdtempSync(path.join(path.dirname(target), '.pstack-'));
    try {
      for (const [name, file] of files) {
        const absolute = path.join(staging, name);
        fs.mkdirSync(path.dirname(absolute), { recursive: true });
        fs.writeFileSync(absolute, file.data, { mode: file.mode });
      }
      fs.rmSync(target, { recursive: true, force: true });
      fs.renameSync(staging, target);
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }
  }
  console.log(`${check ? 'Verified' : 'Vendored'} ${skills.length} pstack skills, ${files.size} files at ${revision}`);
} finally {
  if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
}
