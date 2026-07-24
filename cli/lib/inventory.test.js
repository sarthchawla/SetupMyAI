import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import {
  buildManagedRecord,
  getInventory,
  getManifestPath,
  loadManifest,
  recordInstall,
  saveManifest,
  updateInventory,
} from './inventory.js';
import { installPackage } from './installer.js';
import { mergeMcpConfig, mergeSettings } from './merger.js';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const CLI = path.join(ROOT, 'cli', 'bin', 'index.js');

describe('installed inventory', () => {
  let tmpDir;
  let testHome;
  let originalHome;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'setupmyai-inventory-'));
    testHome = path.join(tmpDir, 'home');
    await fs.ensureDir(testHome);
    originalHome = process.env.HOME;
    process.env.HOME = testHome;
  });

  after(async () => {
    process.env.HOME = originalHome;
    await fs.remove(tmpDir);
  });

  it('writes a project-level manifest during install', async () => {
    const targetDir = path.join(tmpDir, 'project-manifest');
    const tools = ['claude', 'cursor', 'codex'];
    for (const tool of tools) {
      await installPackage('kotlin-backend', targetDir, { tool, level: 'project' });
    }

    const manifestPath = getManifestPath(targetDir, 'project');
    const manifest = await loadManifest(targetDir, 'project');

    assert.ok(await fs.pathExists(manifestPath));
    assert.ok(manifest.items.length > 0);
    for (const tool of tools) {
      const item = manifest.items.find((candidate) => candidate.tool === tool);
      assert.ok(item);
      assert.equal(item.packageKey, 'kotlin-backend');
      assert.equal(item.level, 'project');
      assert.ok(item.sourceHash);
      assert.ok(item.installedHash);
    }
  });

  it('writes a user-level manifest during install', async () => {
    const targetDir = path.join(tmpDir, 'user-manifest');
    const tools = ['claude', 'cursor', 'codex'];
    for (const tool of tools) {
      await installPackage('kotlin-backend', targetDir, { tool, level: 'user' });
    }

    const manifestPath = getManifestPath(targetDir, 'user');
    const manifest = await loadManifest(targetDir, 'user');

    assert.ok(await fs.pathExists(manifestPath));
    for (const tool of tools) {
      const item = manifest.items.find((candidate) => candidate.tool === tool);
      assert.ok(item);
      assert.equal(item.packageKey, 'kotlin-backend');
      assert.equal(item.level, 'user');
      assert.ok(item.sourceHash);
      assert.ok(item.installedHash);
    }
  });

  it('classifies current, outdated, modified, missing, unmanaged, and orphaned items', async () => {
    const targetDir = path.join(tmpDir, 'classification');
    await installPackage('kotlin-backend', targetDir, { tool: 'codex', level: 'project' });

    let inventory = await getInventory(targetDir, { tool: 'codex', level: 'project' });
    assert.ok(inventory.items.some((item) => item.status === 'current'));

    let manifest = await loadManifest(targetDir, 'project');
    manifest.items[0].sourceHash = 'not-the-current-source-hash';
    await saveManifest(targetDir, 'project', manifest);
    inventory = await getInventory(targetDir, { tool: 'codex', level: 'project' });
    assert.equal(inventory.items.find((item) => item.status !== 'unmanaged').status, 'outdated');

    await updateInventory(targetDir, { tool: 'codex', level: 'project' });
    manifest = await loadManifest(targetDir, 'project');
    await fs.appendFile(manifest.items[0].destinationPath, '\nlocal edit\n');
    inventory = await getInventory(targetDir, { tool: 'codex', level: 'project' });
    assert.ok(inventory.items.some((item) => item.status === 'modified'));

    await fs.remove(manifest.items[0].destinationPath);
    inventory = await getInventory(targetDir, { tool: 'codex', level: 'project' });
    assert.ok(inventory.items.some((item) => item.status === 'missing'));

    const unmanagedPath = path.join(targetDir, '.codex', 'rules', 'unmanaged.md');
    await fs.ensureDir(path.dirname(unmanagedPath));
    await fs.writeFile(unmanagedPath, '# unmanaged\n', 'utf-8');
    inventory = await getInventory(targetDir, { tool: 'codex', level: 'project' });
    assert.ok(inventory.items.some((item) => item.status === 'unmanaged' && item.destinationPath === unmanagedPath));

    manifest = await loadManifest(targetDir, 'project');
    manifest.items[0].sourcePath = 'packages/kotlin-backend/rules/does-not-exist.md';
    await saveManifest(targetDir, 'project', manifest);
    inventory = await getInventory(targetDir, { tool: 'codex', level: 'project' });
    assert.ok(inventory.items.some((item) => item.status === 'orphaned'));
  });

  it('updates outdated files and skips modified files unless forced', async () => {
    const targetDir = path.join(tmpDir, 'update-behavior');
    await installPackage('kotlin-backend', targetDir, { tool: 'codex', level: 'project' });

    let manifest = await loadManifest(targetDir, 'project');
    manifest.items[0].sourceHash = 'old-source-hash';
    await saveManifest(targetDir, 'project', manifest);

    let result = await updateInventory(targetDir, { tool: 'codex', level: 'project', dryRun: true });
    assert.ok(result.results.some((item) => item.result === 'would-update'));

    result = await updateInventory(targetDir, { tool: 'codex', level: 'project' });
    assert.ok(result.results.some((item) => item.result === 'updated'));

    manifest = await loadManifest(targetDir, 'project');
    await fs.appendFile(manifest.items[0].destinationPath, '\nlocal edit\n');
    result = await updateInventory(targetDir, { tool: 'codex', level: 'project' });
    assert.ok(result.results.some((item) => item.result === 'skipped-modified'));

    result = await updateInventory(targetDir, { tool: 'codex', level: 'project', force: true });
    assert.ok(result.results.some((item) => item.result === 'updated'));
  });

  it('keeps scripts at the selected level and tracks only managed hook fragments', async () => {
    const targetDir = path.join(tmpDir, 'hook-script-provenance');
    const settingsPath = path.join(targetDir, '.claude', 'settings.json');
    await fs.ensureDir(path.dirname(settingsPath));
    await fs.writeJson(settingsPath, {
      theme: 'dark',
      hooks: {
        Stop: [
          {
            matcher: 'custom',
            hooks: [{ type: 'command', command: 'custom-command' }],
          },
        ],
      },
    });

    await installPackage('universal', targetDir, { tool: 'claude', level: 'project' });

    const scriptPath = path.join(targetDir, '.claude', 'scripts', 'notify.sh');
    assert.ok(await fs.pathExists(scriptPath));
    assert.ok(!(await fs.pathExists(path.join(testHome, '.claude', 'scripts', 'notify.sh'))));

    let manifest = await loadManifest(targetDir, 'project');
    assert.ok(manifest.items.some((item) => item.type === 'script' && item.level === 'project'));
    assert.ok(manifest.items.some((item) => item.type === 'hook' && item.level === 'project'));
    assert.notEqual((await fs.stat(scriptPath)).mode & 0o111, 0);

    await fs.remove(scriptPath);
    let result = await updateInventory(targetDir, {
      tool: 'claude',
      level: 'project',
    });
    assert.ok(
      result.results.some(
        (item) => item.destinationPath === scriptPath && item.result === 'updated'
      )
    );
    assert.notEqual((await fs.stat(scriptPath)).mode & 0o111, 0);

    let settings = await fs.readJson(settingsPath);
    assert.equal(settings.theme, 'dark');
    assert.ok(settings.hooks.Stop.some((entry) => entry.matcher === 'custom'));
    assert.ok(
      settings.hooks.Stop
        .find((entry) => entry.matcher === '')
        .hooks[0]
        .command.includes('${CLAUDE_PROJECT_DIR}/.claude/scripts/notify.sh')
    );

    settings.theme = 'light';
    await fs.writeJson(settingsPath, settings);
    let inventory = await getInventory(targetDir, { tool: 'claude', level: 'project' });
    assert.equal(inventory.items.find((item) => item.type === 'hook').status, 'current');

    settings = await fs.readJson(settingsPath);
    const managedStop = settings.hooks.Stop.find((entry) => entry.matcher === '');
    managedStop.hooks[0].command = 'stale-managed-command';
    await fs.writeJson(settingsPath, settings);

    inventory = await getInventory(targetDir, { tool: 'claude', level: 'project' });
    assert.equal(inventory.items.find((item) => item.type === 'hook').status, 'modified');

    result = await updateInventory(targetDir, { tool: 'claude', level: 'project' });
    assert.ok(result.results.some((item) => item.type === 'hook' && item.result === 'skipped-modified'));

    result = await updateInventory(targetDir, { tool: 'claude', level: 'project', force: true });
    assert.ok(result.results.some((item) => item.type === 'hook' && item.result === 'updated'));

    settings = await fs.readJson(settingsPath);
    assert.equal(settings.theme, 'light');
    assert.ok(settings.hooks.Stop.some((entry) => entry.matcher === 'custom'));
    assert.ok(
      settings.hooks.Stop
        .find((entry) => entry.matcher === '')
        .hooks[0]
        .command.includes('notify.sh')
    );
  });

  it('tracks multiple MCP fragments without clobbering unrelated servers', async () => {
    const targetDir = path.join(tmpDir, 'mcp-provenance');
    const sourceDir = path.join(tmpDir, 'mcp-sources');
    const sourceA = path.join(sourceDir, 'managed-a.json');
    const sourceB = path.join(sourceDir, 'managed-b.json');
    const destinationPath = path.join(targetDir, '.cursor', 'mcp.json');
    await fs.ensureDir(sourceDir);
    await fs.ensureDir(path.dirname(destinationPath));
    await fs.writeJson(sourceA, {
      mcpServers: {
        managedA: { command: 'new-managed-a' },
      },
    });
    await fs.writeJson(sourceB, {
      mcpServers: {
        managedB: { command: 'managed-b' },
      },
    });
    await fs.writeJson(destinationPath, {
      mcpServers: {
        unrelated: { command: 'keep-me' },
        managedA: { command: 'local-managed-a' },
      },
    });

    await mergeMcpConfig(destinationPath, await fs.readJson(sourceA));
    const recordA = await buildManagedRecord({
      packageName: 'universal',
      tool: 'cursor',
      level: 'project',
      type: 'mcp',
      sourcePath: sourceA,
      destinationPath,
      installMode: 'merge-mcp',
      targetDir,
    });

    await mergeMcpConfig(destinationPath, await fs.readJson(sourceB));
    const recordB = await buildManagedRecord({
      packageName: 'universal',
      tool: 'cursor',
      level: 'project',
      type: 'mcp',
      sourcePath: sourceB,
      destinationPath,
      installMode: 'merge-mcp',
      targetDir,
    });
    await recordInstall(targetDir, 'project', [recordA, recordB]);

    let manifest = await loadManifest(targetDir, 'project');
    assert.equal(
      manifest.items.filter((item) => item.destinationPath === destinationPath).length,
      2
    );

    let inventory = await getInventory(targetDir, { tool: 'cursor', level: 'project' });
    assert.equal(
      inventory.items.find((item) => item.sourcePath === sourceA).status,
      'modified'
    );
    assert.equal(
      inventory.items.find((item) => item.sourcePath === sourceB).status,
      'current'
    );

    let result = await updateInventory(targetDir, { tool: 'cursor', level: 'project' });
    assert.ok(
      result.results.some(
        (item) => item.sourcePath === sourceA && item.result === 'skipped-modified'
      )
    );

    result = await updateInventory(targetDir, {
      tool: 'cursor',
      level: 'project',
      force: true,
    });
    assert.ok(
      result.results.some(
        (item) => item.sourcePath === sourceA && item.result === 'updated'
      )
    );

    const merged = await fs.readJson(destinationPath);
    assert.equal(merged.mcpServers.unrelated.command, 'keep-me');
    assert.equal(merged.mcpServers.managedA.command, 'new-managed-a');
    assert.equal(merged.mcpServers.managedB.command, 'managed-b');

    inventory = await getInventory(targetDir, { tool: 'cursor', level: 'project' });
    assert.ok(
      inventory.items
        .filter((item) => item.type === 'mcp')
        .every((item) => item.status === 'current')
    );
  });

  it('replaces renamed managed MCP servers and removes the prior owned key', async () => {
    const targetDir = path.join(tmpDir, 'mcp-rename');
    const sourcePath = path.join(tmpDir, 'mcp-rename-source.json');
    const destinationPath = path.join(targetDir, '.cursor', 'mcp.json');
    await fs.ensureDir(path.dirname(destinationPath));
    await fs.writeJson(sourcePath, {
      mcpServers: {
        oldName: { command: 'old-command' },
      },
    });
    await fs.writeJson(destinationPath, {
      mcpServers: {
        unrelated: { command: 'keep-me' },
      },
    });
    await mergeMcpConfig(destinationPath, await fs.readJson(sourcePath));
    await recordInstall(targetDir, 'project', [
      await buildManagedRecord({
        packageName: 'universal',
        tool: 'cursor',
        level: 'project',
        type: 'mcp',
        sourcePath,
        destinationPath,
        installMode: 'merge-mcp',
        targetDir,
      }),
    ]);

    await fs.writeJson(sourcePath, {
      mcpServers: {
        newName: { command: 'new-command' },
      },
    });

    let inventory = await getInventory(targetDir, {
      tool: 'cursor',
      level: 'project',
    });
    assert.equal(inventory.items.find((item) => item.type === 'mcp').status, 'outdated');

    const result = await updateInventory(targetDir, {
      tool: 'cursor',
      level: 'project',
    });
    assert.ok(result.results.some((item) => item.type === 'mcp' && item.result === 'updated'));

    const merged = await fs.readJson(destinationPath);
    assert.equal(merged.mcpServers.oldName, undefined);
    assert.deepStrictEqual(merged.mcpServers.newName, { command: 'new-command' });
    assert.deepStrictEqual(merged.mcpServers.unrelated, { command: 'keep-me' });

    inventory = await getInventory(targetDir, {
      tool: 'cursor',
      level: 'project',
    });
    assert.equal(inventory.items.find((item) => item.type === 'mcp').status, 'current');
  });

  it('replaces renamed managed hooks without clobbering a shared matcher', async () => {
    const targetDir = path.join(tmpDir, 'hook-rename');
    const sourcePath = path.join(tmpDir, 'hook-rename-source.json');
    const destinationPath = path.join(targetDir, '.claude', 'settings.json');
    const unrelatedHook = {
      matcher: '',
      hooks: [{ type: 'command', command: 'unrelated-command' }],
    };
    await fs.ensureDir(path.dirname(destinationPath));
    await fs.writeJson(sourcePath, {
      hooks: {
        Stop: [
          {
            matcher: '',
            hooks: [{ type: 'command', command: 'old-command' }],
          },
        ],
      },
    });
    await fs.writeJson(destinationPath, {
      hooks: {
        Stop: [unrelatedHook],
      },
    });
    await mergeSettings(destinationPath, await fs.readJson(sourcePath));
    await recordInstall(targetDir, 'project', [
      await buildManagedRecord({
        packageName: 'universal',
        tool: 'claude',
        level: 'project',
        type: 'hook',
        sourcePath,
        destinationPath,
        installMode: 'merge-settings',
        targetDir,
      }),
    ]);

    await fs.writeJson(sourcePath, {
      hooks: {
        Stop: [
          {
            matcher: '',
            hooks: [{ type: 'command', command: 'new-command' }],
          },
        ],
      },
    });

    let inventory = await getInventory(targetDir, {
      tool: 'claude',
      level: 'project',
    });
    assert.equal(inventory.items.find((item) => item.type === 'hook').status, 'outdated');

    const result = await updateInventory(targetDir, {
      tool: 'claude',
      level: 'project',
    });
    assert.ok(result.results.some((item) => item.type === 'hook' && item.result === 'updated'));

    const settings = await fs.readJson(destinationPath);
    const commands = settings.hooks.Stop.map((entry) => entry.hooks[0].command);
    assert.deepStrictEqual(commands, ['unrelated-command', 'new-command']);

    inventory = await getInventory(targetDir, {
      tool: 'claude',
      level: 'project',
    });
    assert.equal(inventory.items.find((item) => item.type === 'hook').status, 'current');
  });

  it('updates multiple same-matcher hook records in one forced run', async () => {
    const targetDir = path.join(tmpDir, 'hook-multi-update');
    const sourceA = path.join(tmpDir, 'hook-multi-a.json');
    const sourceB = path.join(tmpDir, 'hook-multi-b.json');
    const destinationPath = path.join(targetDir, '.claude', 'settings.json');
    const hookConfig = (command) => ({
      hooks: {
        Stop: [
          {
            matcher: '',
            hooks: [{ type: 'command', command }],
          },
        ],
      },
    });
    await fs.ensureDir(path.dirname(destinationPath));
    await fs.writeJson(destinationPath, { hooks: { Stop: [] } });
    await fs.writeJson(sourceA, hookConfig('a-command'));
    await fs.writeJson(sourceB, hookConfig('b-command'));

    await mergeSettings(destinationPath, await fs.readJson(sourceA));
    const recordA = await buildManagedRecord({
      packageName: 'universal',
      tool: 'claude',
      level: 'project',
      type: 'hook',
      sourcePath: sourceA,
      destinationPath,
      installMode: 'merge-settings',
      targetDir,
    });
    await mergeSettings(destinationPath, await fs.readJson(sourceB));
    const recordB = await buildManagedRecord({
      packageName: 'universal',
      tool: 'claude',
      level: 'project',
      type: 'hook',
      sourcePath: sourceB,
      destinationPath,
      installMode: 'merge-settings',
      targetDir,
    });
    await recordInstall(targetDir, 'project', [recordA, recordB]);

    await fs.writeJson(sourceA, hookConfig('a2-command'));
    const settings = await fs.readJson(destinationPath);
    settings.hooks.Stop
      .find((entry) => entry.hooks[0].command === 'b-command')
      .hooks[0]
      .command = 'b-local-command';
    await fs.writeJson(destinationPath, settings);

    const result = await updateInventory(targetDir, {
      tool: 'claude',
      level: 'project',
      force: true,
    });
    assert.equal(
      result.results.filter((item) => item.type === 'hook' && item.result === 'updated').length,
      2
    );

    const commands = (await fs.readJson(destinationPath)).hooks.Stop
      .map((entry) => entry.hooks[0].command);
    assert.deepStrictEqual(commands, ['a2-command', 'b-command']);

    const inventory = await getInventory(targetDir, {
      tool: 'claude',
      level: 'project',
    });
    assert.ok(
      inventory.items
        .filter((item) => item.type === 'hook')
        .every((item) => item.status === 'current')
    );
  });

  it('reports unmanaged Codex plugins and root hook config', async () => {
    const targetDir = path.join(tmpDir, 'plugin-inventory');
    const pluginPath = path.join(targetDir, '.codex', 'plugins', 'example', 'plugin.json');
    const hooksPath = path.join(targetDir, '.codex', 'hooks.json');
    await fs.ensureDir(path.dirname(pluginPath));
    await fs.writeJson(pluginPath, { name: 'example' });
    await fs.writeJson(hooksPath, { hooks: {} });

    const inventory = await getInventory(targetDir, {
      tool: 'codex',
      level: 'project',
    });
    assert.ok(
      inventory.items.some(
        (item) => item.destinationPath === pluginPath
          && item.type === 'plugin'
          && item.status === 'unmanaged'
      )
    );
    assert.ok(
      inventory.items.some(
        (item) => item.destinationPath === hooksPath
          && item.type === 'hook'
          && item.status === 'unmanaged'
      )
    );
  });

  it('records one authoritative source for Cursor rules with explicit .mdc files', async () => {
    const targetDir = path.join(tmpDir, 'cursor-rule-provenance');
    await installPackage('kotlin-backend', targetDir, {
      tool: 'cursor',
      level: 'project',
    });

    const manifest = await loadManifest(targetDir, 'project');
    const destinationPath = path.join(
      targetDir,
      '.cursor',
      'rules',
      'kotlin-backend.mdc'
    );
    const records = manifest.items.filter(
      (item) => item.destinationPath === destinationPath
    );
    assert.equal(records.length, 1);
    assert.match(records[0].sourcePath, /kotlin-backend\.mdc$/);
    assert.equal(records[0].installMode, 'copy');

    const inventory = await getInventory(targetDir, {
      tool: 'cursor',
      level: 'project',
    });
    assert.equal(
      inventory.items.find((item) => item.destinationPath === destinationPath).status,
      'current'
    );
  });

  it('filters updates by package and supports all install levels', async () => {
    const targetDir = path.join(tmpDir, 'filtered-all-levels');
    await installPackage('kotlin-backend', targetDir, { tool: 'codex', level: 'project' });
    await installPackage('react-frontend', targetDir, { tool: 'codex', level: 'project' });
    await installPackage('kotlin-backend', targetDir, { tool: 'codex', level: 'user' });

    for (const level of ['project', 'user']) {
      const manifest = await loadManifest(targetDir, level);
      for (const item of manifest.items) {
        item.sourceHash = `old-${level}-${item.packageKey}`;
      }
      await saveManifest(targetDir, level, manifest);
    }

    const filtered = await updateInventory(targetDir, {
      level: 'all',
      tool: 'codex',
      package: 'kotlin-backend',
      dryRun: true,
    });

    const updates = filtered.results.filter((item) => item.result === 'would-update');
    assert.ok(updates.length > 0);
    assert.deepStrictEqual(new Set(updates.map((item) => item.packageKey)), new Set(['kotlin-backend']));
    assert.deepStrictEqual(new Set(updates.map((item) => item.level)), new Set(['project', 'user']));
    assert.equal(filtered.inventory.items.some((item) => item.status === 'unmanaged'), false);
  });

  it('supports status, update --dry-run, update --check, and sync alias from the CLI', async () => {
    const targetDir = path.join(tmpDir, 'cli-smoke');
    await installPackage('kotlin-backend', targetDir, { tool: 'codex', level: 'project' });

    const status = spawnSync(process.execPath, [CLI, 'status', '--dir', targetDir, '--level', 'project', '--tool', 'codex', '--json'], {
      encoding: 'utf-8',
      env: { ...process.env, HOME: testHome },
    });
    assert.equal(status.status, 0);
    assert.equal(JSON.parse(status.stdout).summary.byStatus.current > 0, true);

    const dryRun = spawnSync(process.execPath, [CLI, 'update', '--dir', targetDir, '--level', 'project', '--tool', 'codex', '--dry-run'], {
      encoding: 'utf-8',
      env: { ...process.env, HOME: testHome },
    });
    assert.equal(dryRun.status, 0);
    assert.match(dryRun.stdout, /SetupMyAi update dry run/);

    const manifest = await loadManifest(targetDir, 'project');
    manifest.items[0].sourceHash = 'old-source-hash';
    await saveManifest(targetDir, 'project', manifest);

    const check = spawnSync(process.execPath, [CLI, 'update', '--dir', targetDir, '--level', 'project', '--tool', 'codex', '--check'], {
      encoding: 'utf-8',
      env: { ...process.env, HOME: testHome },
    });
    assert.equal(check.status, 1);
    assert.match(check.stdout, /SetupMyAi update dry run/);
    assert.equal(
      (await loadManifest(targetDir, 'project')).items[0].sourceHash,
      'old-source-hash'
    );

    const sync = spawnSync(process.execPath, [CLI, 'sync', '--dir', targetDir, '--level', 'project', '--tool', 'codex', '--dry-run'], {
      encoding: 'utf-8',
      env: { ...process.env, HOME: testHome },
    });
    assert.equal(sync.status, 0);
    assert.match(sync.stdout, /sync is an alias for update/);
  });
});
