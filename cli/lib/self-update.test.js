import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  compareVersions,
  getCliUpdateStatus,
  getLatestCliVersion,
  resolveSelfUpdateCommand,
  runSelfUpdate,
} from './self-update.js';

describe('self-update', () => {
  it('compares dotted versions', () => {
    assert.equal(compareVersions('1.0.1', '1.0.0'), 1);
    assert.equal(compareVersions('1.0.0', '1.0.1'), -1);
    assert.equal(compareVersions('1.0.0', '1.0'), 0);
  });

  it('orders prereleases below stable versions using SemVer rules', () => {
    assert.equal(compareVersions('1.1.0', '1.1.0-beta.1'), 1);
    assert.equal(compareVersions('1.1.0-beta.2', '1.1.0-beta.11'), -1);
    assert.equal(compareVersions('1.1.0-beta.1', '1.1.0-alpha.9'), 1);
    assert.equal(compareVersions('1.1.0+build.2', '1.1.0+build.1'), 0);
  });

  it('reads latest version from npm registry payload', async () => {
    const latest = await getLatestCliVersion(async () => ({
      ok: true,
      json: async () => ({ 'dist-tags': { latest: '9.9.9' } }),
    }));

    assert.equal(latest, '9.9.9');
  });

  it('reports update availability with a mocked registry response', async () => {
    const status = await getCliUpdateStatus(async () => ({
      ok: true,
      json: async () => ({ 'dist-tags': { latest: '999.0.0' } }),
    }));

    assert.equal(status.latest, '999.0.0');
    assert.equal(status.updateAvailable, true);
  });

  it('prefers pnpm and falls back to npm for global updates', async () => {
    const pnpm = await resolveSelfUpdateCommand(async () => true);
    assert.deepStrictEqual(pnpm, {
      command: 'pnpm',
      args: ['add', '-g', '@setupmyai/cli@latest'],
    });

    const npm = await resolveSelfUpdateCommand(async (command) => command === 'npm');
    assert.deepStrictEqual(npm, {
      command: 'npm',
      args: ['install', '-g', '@setupmyai/cli@latest'],
    });

    await assert.rejects(
      () => resolveSelfUpdateCommand(async () => false),
      /Neither pnpm nor npm/
    );
  });

  it('executes the resolved self-update command once', async () => {
    const calls = [];
    const command = {
      command: 'npm',
      args: ['install', '-g', '@setupmyai/cli@latest'],
    };

    const result = await runSelfUpdate({
      command,
      spawnImpl: async (executable, args) => calls.push({ executable, args }),
    });

    assert.deepStrictEqual(result, command);
    assert.deepStrictEqual(calls, [
      { executable: 'npm', args: command.args },
    ]);
  });
});
