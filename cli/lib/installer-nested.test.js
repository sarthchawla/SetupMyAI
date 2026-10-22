import { it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import fs from 'fs-extra';
import { glob } from 'glob';
import os from 'node:os';
import path from 'node:path';
import { installPackage } from './installer.js';

const run = promisify(execFile);
const sourceRoot = fileURLToPath(new URL('../../packages/react-frontend/skills', import.meta.url));
const cli = fileURLToPath(new URL('../bin/index.js', import.meta.url));
const codexSkillRoot = '.agents';

for (const entrypoint of ['installer', 'CLI']) {
  for (const tools of [['cursor'], ['codex'], ['cursor', 'codex']]) {
    it(`${entrypoint} preserves nested skill bytes for ${tools.join(',')}`, async (t) => {
      const target = await fs.mkdtemp(path.join(os.tmpdir(), 'setupmyai-nested-'));
      t.after(() => fs.remove(target));

      if (entrypoint === 'installer') {
        await installPackage('react-frontend', target, { tool: tools });
      } else {
        await run(process.execPath, [cli, 'install', 'react-frontend', '--tool', tools.join(','), '--dir', target]);
      }

      const files = await glob('**/*', { cwd: sourceRoot, nodir: true, dot: true });
      assert.ok(files.includes('frontend-code-review/SKILL.md'));
      assert.ok(files.includes('frontend-code-review/references/code-quality.md'));
      for (const tool of tools) {
        const skillRoot = path.join(target, tool === 'codex' ? codexSkillRoot : '.cursor', 'skills');
        assert.deepEqual((await glob('**/*', { cwd: skillRoot, nodir: true, dot: true })).sort(), files.sort());
        for (const file of files) {
          assert.deepEqual(await fs.readFile(path.join(skillRoot, file)), await fs.readFile(path.join(sourceRoot, file)), `${tool}: ${file}`);
        }
        const rule = path.join(target, `.${tool}`, 'rules', `react-frontend.${tool === 'cursor' ? 'mdc' : 'md'}`);
        if (tool === 'cursor') {
          assert.match(await fs.readFile(rule, 'utf8'), /^---\n[\s\S]*alwaysApply:/);
          assert.equal(await fs.pathExists(path.join(target, '.cursor/rules/react-frontend.md')), false);
        } else {
          assert.deepEqual(await fs.readFile(rule), await fs.readFile(new URL('../../packages/react-frontend/rules/react-frontend.md', import.meta.url)));
        }
      }
      for (const root of ['.claude', '.opencode', '.gemini', ...(!tools.includes('cursor') ? ['.cursor'] : []), ...(!tools.includes('codex') ? ['.codex', '.agents'] : [])]) {
        assert.equal(await fs.pathExists(path.join(target, root)), false, `${root} must stay unselected`);
      }
    });
  }
}
