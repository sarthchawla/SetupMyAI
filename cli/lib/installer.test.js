import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { installPackage } from './installer.js';

describe('installPackage', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'setupmyai-test-'));
  });

  after(async () => {
    await fs.remove(tmpDir);
  });

  it('throws error for nonexistent package', async () => {
    await assert.rejects(
      () => installPackage('this-package-does-not-exist-xyz', tmpDir),
      (err) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes('not found'));
        return true;
      }
    );
  });

  it('installs rules to .claude/rules/ when tool=claude', async () => {
    const targetDir = path.join(tmpDir, 'claude-only');
    await fs.ensureDir(targetDir);

    await installPackage('kotlin-backend', targetDir, { tool: 'claude' });

    const claudeRules = path.join(targetDir, '.claude', 'rules');
    assert.ok(await fs.pathExists(path.join(claudeRules, 'kotlin-backend.md')));
    assert.ok(await fs.pathExists(path.join(claudeRules, 'kotlin-backend.mdc')));
  });

  it('installs rules to .cursor/rules/ when tool=cursor', async () => {
    const targetDir = path.join(tmpDir, 'cursor-only');
    await fs.ensureDir(targetDir);

    await installPackage('kotlin-backend', targetDir, { tool: 'cursor' });

    const cursorRules = path.join(targetDir, '.cursor', 'rules');
    // The .md file should be auto-converted to .mdc for Cursor
    assert.ok(await fs.pathExists(path.join(cursorRules, 'kotlin-backend.mdc')));
  });

  it('installs to both .claude/ and .cursor/ when tool=all', async () => {
    const targetDir = path.join(tmpDir, 'all-tools');
    await fs.ensureDir(targetDir);

    await installPackage('kotlin-backend', targetDir, { tool: 'all' });

    assert.ok(await fs.pathExists(path.join(targetDir, '.claude', 'rules', 'kotlin-backend.md')));
    assert.ok(await fs.pathExists(path.join(targetDir, '.cursor', 'rules', 'kotlin-backend.mdc')));
  });

  it('auto-converts .md rules to .mdc for Cursor', async () => {
    const targetDir = path.join(tmpDir, 'md-to-mdc');
    await fs.ensureDir(targetDir);

    await installPackage('kotlin-backend', targetDir, { tool: 'cursor' });

    const mdcPath = path.join(targetDir, '.cursor', 'rules', 'kotlin-backend.mdc');
    assert.ok(await fs.pathExists(mdcPath));

    const content = await fs.readFile(mdcPath, 'utf-8');
    // The converted .mdc should have frontmatter added by mdToMdc
    assert.ok(content.startsWith('---\n'));
    assert.ok(content.includes('alwaysApply:'));
  });

  it('does NOT install to .cursor/ dirs when tool=claude', async () => {
    const targetDir = path.join(tmpDir, 'no-cursor');
    await fs.ensureDir(targetDir);

    await installPackage('kotlin-backend', targetDir, { tool: 'claude' });

    assert.ok(!(await fs.pathExists(path.join(targetDir, '.cursor'))));
  });

  it('does NOT install to .claude/ dirs when tool=cursor', async () => {
    const targetDir = path.join(tmpDir, 'no-claude');
    await fs.ensureDir(targetDir);

    await installPackage('kotlin-backend', targetDir, { tool: 'cursor' });

    assert.ok(!(await fs.pathExists(path.join(targetDir, '.claude'))));
  });

  it('returns correct file count', async () => {
    const targetDir = path.join(tmpDir, 'count-check');
    await fs.ensureDir(targetDir);

    // kotlin-backend has rules/ with 2 files (kotlin-backend.md, kotlin-backend.mdc)
    // tool=claude means each file is installed once to .claude/rules/
    const count = await installPackage('kotlin-backend', targetDir, { tool: 'claude' });

    assert.equal(count, 2); // 2 rule files installed to claude target
  });

  it('returns double file count when tool=all', async () => {
    const targetDir = path.join(tmpDir, 'count-all');
    await fs.ensureDir(targetDir);

    const count = await installPackage('kotlin-backend', targetDir, { tool: 'all' });

    // 2 files x 2 targets (claude + cursor) = 4
    assert.equal(count, 4);
  });
});
