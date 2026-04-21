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

  // ── tool filtering ──────────────────────────────────────────────────────

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

  // ── new tools: codex, opencode, gemini ──────────────────────────────────

  it('installs rules to .codex/rules/ when tool=codex', async () => {
    const targetDir = path.join(tmpDir, 'codex-only');
    await fs.ensureDir(targetDir);

    await installPackage('kotlin-backend', targetDir, { tool: 'codex' });

    const codexRules = path.join(targetDir, '.codex', 'rules');
    assert.ok(await fs.pathExists(path.join(codexRules, 'kotlin-backend.md')));
    assert.ok(!(await fs.pathExists(path.join(targetDir, '.claude'))));
    assert.ok(!(await fs.pathExists(path.join(targetDir, '.cursor'))));
  });

  it('installs rules to .opencode/rules/ when tool=opencode', async () => {
    const targetDir = path.join(tmpDir, 'opencode-only');
    await fs.ensureDir(targetDir);

    await installPackage('kotlin-backend', targetDir, { tool: 'opencode' });

    const opencodeRules = path.join(targetDir, '.opencode', 'rules');
    assert.ok(await fs.pathExists(path.join(opencodeRules, 'kotlin-backend.md')));
    assert.ok(!(await fs.pathExists(path.join(targetDir, '.claude'))));
    assert.ok(!(await fs.pathExists(path.join(targetDir, '.cursor'))));
  });

  it('installs rules to .gemini/rules/ when tool=gemini', async () => {
    const targetDir = path.join(tmpDir, 'gemini-only');
    await fs.ensureDir(targetDir);

    await installPackage('kotlin-backend', targetDir, { tool: 'gemini' });

    const geminiRules = path.join(targetDir, '.gemini', 'rules');
    assert.ok(await fs.pathExists(path.join(geminiRules, 'kotlin-backend.md')));
    assert.ok(!(await fs.pathExists(path.join(targetDir, '.claude'))));
    assert.ok(!(await fs.pathExists(path.join(targetDir, '.cursor'))));
  });

  // ── multi-tool selection ────────────────────────────────────────────────

  it('installs to multiple selected tools via array', async () => {
    const targetDir = path.join(tmpDir, 'multi-tool-array');
    await fs.ensureDir(targetDir);

    await installPackage('kotlin-backend', targetDir, { tool: ['claude', 'codex', 'gemini'] });

    assert.ok(await fs.pathExists(path.join(targetDir, '.claude', 'rules', 'kotlin-backend.md')));
    assert.ok(await fs.pathExists(path.join(targetDir, '.codex', 'rules', 'kotlin-backend.md')));
    assert.ok(await fs.pathExists(path.join(targetDir, '.gemini', 'rules', 'kotlin-backend.md')));
    assert.ok(!(await fs.pathExists(path.join(targetDir, '.cursor'))));
    assert.ok(!(await fs.pathExists(path.join(targetDir, '.opencode'))));
  });

  it('installs to multiple selected tools via comma-separated string', async () => {
    const targetDir = path.join(tmpDir, 'multi-tool-string');
    await fs.ensureDir(targetDir);

    await installPackage('kotlin-backend', targetDir, { tool: 'claude,opencode' });

    assert.ok(await fs.pathExists(path.join(targetDir, '.claude', 'rules', 'kotlin-backend.md')));
    assert.ok(await fs.pathExists(path.join(targetDir, '.opencode', 'rules', 'kotlin-backend.md')));
    assert.ok(!(await fs.pathExists(path.join(targetDir, '.cursor'))));
    assert.ok(!(await fs.pathExists(path.join(targetDir, '.codex'))));
  });

  it('only cursor gets .mdc conversion in multi-tool install', async () => {
    const targetDir = path.join(tmpDir, 'mdc-only-cursor');
    await fs.ensureDir(targetDir);

    await installPackage('kotlin-backend', targetDir, { tool: ['cursor', 'codex'] });

    assert.ok(await fs.pathExists(path.join(targetDir, '.cursor', 'rules', 'kotlin-backend.mdc')));
    assert.ok(await fs.pathExists(path.join(targetDir, '.codex', 'rules', 'kotlin-backend.md')));
  });

  // ── user-level installation ─────────────────────────────────────────────

  it('installs to user home directory when level=user', async () => {
    const targetDir = path.join(tmpDir, 'user-level');
    await fs.ensureDir(targetDir);

    await installPackage('kotlin-backend', targetDir, { tool: 'claude', level: 'user' });

    const installedPath = path.join(os.homedir(), '.claude', 'rules', 'kotlin-backend.md');
    assert.ok(await fs.pathExists(installedPath));

    // Cleanup
    await fs.remove(installedPath);
    const mdcPath = path.join(os.homedir(), '.claude', 'rules', 'kotlin-backend.mdc');
    if (await fs.pathExists(mdcPath)) await fs.remove(mdcPath);
  });

  it('does NOT install to project dir when level=user', async () => {
    const targetDir = path.join(tmpDir, 'user-no-project');
    await fs.ensureDir(targetDir);

    await installPackage('kotlin-backend', targetDir, { tool: 'codex', level: 'user' });

    assert.ok(!(await fs.pathExists(path.join(targetDir, '.codex'))));

    const userPath = path.join(os.homedir(), '.codex', 'rules', 'kotlin-backend.md');
    assert.ok(await fs.pathExists(userPath));

    // Cleanup
    await fs.remove(path.join(os.homedir(), '.codex'));
  });

  it('installs to user home for multiple tools when level=user', async () => {
    const targetDir = path.join(tmpDir, 'user-multi');
    await fs.ensureDir(targetDir);

    await installPackage('kotlin-backend', targetDir, {
      tool: ['opencode', 'gemini'],
      level: 'user',
    });

    const opencodePath = path.join(os.homedir(), '.opencode', 'rules', 'kotlin-backend.md');
    const geminiPath = path.join(os.homedir(), '.gemini', 'rules', 'kotlin-backend.md');
    assert.ok(await fs.pathExists(opencodePath));
    assert.ok(await fs.pathExists(geminiPath));

    // Cleanup
    await fs.remove(path.join(os.homedir(), '.opencode'));
    await fs.remove(path.join(os.homedir(), '.gemini'));
  });

  // ── file count ──────────────────────────────────────────────────────────

  it('returns correct file count for single tool', async () => {
    const targetDir = path.join(tmpDir, 'count-single');
    await fs.ensureDir(targetDir);

    const count = await installPackage('kotlin-backend', targetDir, { tool: 'claude' });

    assert.equal(count, 2);
  });

  it('returns higher count for multiple tools', async () => {
    const targetDir = path.join(tmpDir, 'count-multi');
    await fs.ensureDir(targetDir);

    const countSingle = await installPackage('kotlin-backend', path.join(tmpDir, 'count-s'), { tool: 'claude' });
    await fs.ensureDir(path.join(tmpDir, 'count-s'));

    const countTriple = await installPackage('kotlin-backend', targetDir, { tool: ['claude', 'codex', 'gemini'] });

    assert.equal(countTriple, countSingle * 3);
  });

  // ── default behavior ────────────────────────────────────────────────────

  it('defaults to project level when no level specified', async () => {
    const targetDir = path.join(tmpDir, 'default-level');
    await fs.ensureDir(targetDir);

    await installPackage('kotlin-backend', targetDir, { tool: 'codex' });

    assert.ok(await fs.pathExists(path.join(targetDir, '.codex', 'rules', 'kotlin-backend.md')));
  });

  it('defaults to all tools when no tool specified', async () => {
    const targetDir = path.join(tmpDir, 'default-tool');
    await fs.ensureDir(targetDir);

    await installPackage('kotlin-backend', targetDir);

    assert.ok(await fs.pathExists(path.join(targetDir, '.claude', 'rules')));
    assert.ok(await fs.pathExists(path.join(targetDir, '.cursor', 'rules')));
    assert.ok(await fs.pathExists(path.join(targetDir, '.codex', 'rules')));
    assert.ok(await fs.pathExists(path.join(targetDir, '.opencode', 'rules')));
    assert.ok(await fs.pathExists(path.join(targetDir, '.gemini', 'rules')));
  });
});
