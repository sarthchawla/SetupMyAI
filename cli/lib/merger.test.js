import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { mergeSettings, mergeMcpConfig } from './merger.js';

describe('mergeSettings', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'setupmyai-test-'));
  });

  after(async () => {
    await fs.remove(tmpDir);
  });

  it('creates settings file if it does not exist', async () => {
    const settingsPath = path.join(tmpDir, 'new-settings', 'settings.json');
    const config = {
      hooks: {
        PreToolUse: [{ command: 'echo hello' }],
      },
    };

    const result = await mergeSettings(settingsPath, config);

    assert.ok(await fs.pathExists(settingsPath));
    assert.deepStrictEqual(result.hooks.PreToolUse, [{ command: 'echo hello' }]);
  });

  it('merges hooks into existing settings without clobbering', async () => {
    const settingsPath = path.join(tmpDir, 'merge-hooks', 'settings.json');
    await fs.ensureDir(path.dirname(settingsPath));
    await fs.writeJson(settingsPath, {
      hooks: {
        PreToolUse: [{ command: 'existing-cmd' }],
      },
    });

    const config = {
      hooks: {
        PostToolUse: [{ command: 'new-cmd' }],
      },
    };

    const result = await mergeSettings(settingsPath, config);

    assert.deepStrictEqual(result.hooks.PreToolUse, [{ command: 'existing-cmd' }]);
    assert.deepStrictEqual(result.hooks.PostToolUse, [{ command: 'new-cmd' }]);
  });

  it('deduplicates hooks by command string', async () => {
    const settingsPath = path.join(tmpDir, 'dedup-hooks', 'settings.json');
    await fs.ensureDir(path.dirname(settingsPath));
    await fs.writeJson(settingsPath, {
      hooks: {
        PreToolUse: [{ command: 'shared-cmd', timeout: 10 }],
      },
    });

    const config = {
      hooks: {
        PreToolUse: [
          { command: 'shared-cmd', timeout: 99 },
          { command: 'brand-new-cmd' },
        ],
      },
    };

    const result = await mergeSettings(settingsPath, config);

    const preHooks = result.hooks.PreToolUse;
    assert.equal(preHooks.length, 2);
    assert.equal(preHooks[0].command, 'shared-cmd');
    assert.equal(preHooks[0].timeout, 10); // original preserved, not overwritten
    assert.equal(preHooks[1].command, 'brand-new-cmd');
  });

  it('preserves existing non-hooks keys', async () => {
    const settingsPath = path.join(tmpDir, 'preserve-keys', 'settings.json');
    await fs.ensureDir(path.dirname(settingsPath));
    await fs.writeJson(settingsPath, {
      permissions: { allow: ['Read'] },
    });

    const config = {
      hooks: {
        PreToolUse: [{ command: 'cmd' }],
      },
    };

    const result = await mergeSettings(settingsPath, config);

    assert.deepStrictEqual(result.permissions, { allow: ['Read'] });
    assert.ok(result.hooks);
  });

  it('adds new top-level keys that do not exist yet', async () => {
    const settingsPath = path.join(tmpDir, 'add-new-keys', 'settings.json');
    await fs.ensureDir(path.dirname(settingsPath));
    await fs.writeJson(settingsPath, {});

    const config = {
      model: 'opus',
      theme: 'dark',
    };

    const result = await mergeSettings(settingsPath, config);

    assert.equal(result.model, 'opus');
    assert.equal(result.theme, 'dark');
  });

  it('skips top-level keys that already exist', async () => {
    const settingsPath = path.join(tmpDir, 'skip-existing', 'settings.json');
    await fs.ensureDir(path.dirname(settingsPath));
    await fs.writeJson(settingsPath, { model: 'sonnet' });

    const config = {
      model: 'opus',
    };

    const result = await mergeSettings(settingsPath, config);

    assert.equal(result.model, 'sonnet');
  });

  it('returns the merged result', async () => {
    const settingsPath = path.join(tmpDir, 'returns-result', 'settings.json');

    const config = {
      hooks: {
        PreToolUse: [{ command: 'test-cmd' }],
      },
      newKey: 'value',
    };

    const result = await mergeSettings(settingsPath, config);

    assert.equal(typeof result, 'object');
    assert.deepStrictEqual(result.hooks.PreToolUse, [{ command: 'test-cmd' }]);
    assert.equal(result.newKey, 'value');

    // Verify on-disk matches return value
    const onDisk = await fs.readJson(settingsPath);
    assert.deepStrictEqual(onDisk, result);
  });
});

describe('mergeMcpConfig', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'setupmyai-test-'));
  });

  after(async () => {
    await fs.remove(tmpDir);
  });

  it('creates mcp.json if it does not exist', async () => {
    const mcpPath = path.join(tmpDir, 'new-mcp', 'mcp.json');
    const config = {
      mcpServers: {
        myServer: { command: 'node', args: ['server.js'] },
      },
    };

    const result = await mergeMcpConfig(mcpPath, config);

    assert.ok(await fs.pathExists(mcpPath));
    assert.deepStrictEqual(result.mcpServers.myServer, {
      command: 'node',
      args: ['server.js'],
    });
  });

  it('adds new MCP server entries', async () => {
    const mcpPath = path.join(tmpDir, 'add-servers', 'mcp.json');
    await fs.ensureDir(path.dirname(mcpPath));
    await fs.writeJson(mcpPath, {
      mcpServers: {
        existingServer: { command: 'existing' },
      },
    });

    const config = {
      mcpServers: {
        newServer: { command: 'new-cmd' },
      },
    };

    const result = await mergeMcpConfig(mcpPath, config);

    assert.deepStrictEqual(result.mcpServers.existingServer, { command: 'existing' });
    assert.deepStrictEqual(result.mcpServers.newServer, { command: 'new-cmd' });
  });

  it('does NOT overwrite existing server entries', async () => {
    const mcpPath = path.join(tmpDir, 'no-overwrite', 'mcp.json');
    await fs.ensureDir(path.dirname(mcpPath));
    await fs.writeJson(mcpPath, {
      mcpServers: {
        myServer: { command: 'original' },
      },
    });

    const config = {
      mcpServers: {
        myServer: { command: 'replacement' },
      },
    };

    const result = await mergeMcpConfig(mcpPath, config);

    assert.equal(result.mcpServers.myServer.command, 'original');
  });

  it('preserves all existing config keys', async () => {
    const mcpPath = path.join(tmpDir, 'preserve-config', 'mcp.json');
    await fs.ensureDir(path.dirname(mcpPath));
    await fs.writeJson(mcpPath, {
      version: '1.0',
      mcpServers: {},
    });

    const config = {
      mcpServers: {
        newServer: { command: 'cmd' },
      },
    };

    const result = await mergeMcpConfig(mcpPath, config);

    assert.equal(result.version, '1.0');
    assert.ok(result.mcpServers.newServer);
  });

  it('handles empty mcpServers in new config', async () => {
    const mcpPath = path.join(tmpDir, 'empty-servers', 'mcp.json');
    await fs.ensureDir(path.dirname(mcpPath));
    await fs.writeJson(mcpPath, {
      mcpServers: {
        existing: { command: 'keep' },
      },
    });

    const config = { mcpServers: {} };

    const result = await mergeMcpConfig(mcpPath, config);

    assert.deepStrictEqual(result.mcpServers.existing, { command: 'keep' });
    assert.equal(Object.keys(result.mcpServers).length, 1);
  });
});
