import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import {
  getInventory,
  getManifestPath,
  loadManifest,
  saveManifest,
  updateInventory,
} from './inventory.js';
import { installPackage } from './installer.js';

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
    await installPackage('kotlin-backend', targetDir, { tool: 'codex', level: 'project' });

    const manifestPath = getManifestPath(targetDir, 'project');
    const manifest = await loadManifest(targetDir, 'project');

    assert.ok(await fs.pathExists(manifestPath));
    assert.ok(manifest.items.length > 0);
    assert.equal(manifest.items[0].packageKey, 'kotlin-backend');
    assert.equal(manifest.items[0].tool, 'codex');
    assert.equal(manifest.items[0].level, 'project');
    assert.ok(manifest.items[0].sourceHash);
    assert.ok(manifest.items[0].installedHash);
  });

  it('writes a user-level manifest during install', async () => {
    const targetDir = path.join(tmpDir, 'user-manifest');
    await installPackage('kotlin-backend', targetDir, { tool: 'codex', level: 'user' });

    const manifestPath = getManifestPath(targetDir, 'user');
    const manifest = await loadManifest(targetDir, 'user');

    assert.ok(await fs.pathExists(manifestPath));
    assert.ok(manifest.items.some((item) => item.level === 'user' && item.tool === 'codex'));
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

    const check = spawnSync(process.execPath, [CLI, 'update', '--dir', targetDir, '--level', 'project', '--tool', 'codex', '--check', '--dry-run'], {
      encoding: 'utf-8',
      env: { ...process.env, HOME: testHome },
    });
    assert.equal(check.status, 1);

    const sync = spawnSync(process.execPath, [CLI, 'sync', '--dir', targetDir, '--level', 'project', '--tool', 'codex', '--dry-run'], {
      encoding: 'utf-8',
      env: { ...process.env, HOME: testHome },
    });
    assert.equal(sync.status, 0);
    assert.match(sync.stdout, /sync is an alias for update/);
  });
});
