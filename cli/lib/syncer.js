import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import { loadSources, saveSources } from './scanner.js';

const SETUP_ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const SOURCES_PATH = path.join(SETUP_ROOT, 'sources.yml');

/**
 * Add a new repo to sources.yml
 */
export async function addRepo(repoPath, alias) {
  const sources = await loadSources(SOURCES_PATH);
  if (!sources.repos) sources.repos = {};

  const absPath = path.resolve(repoPath);
  // Check if already tracked
  for (const [key, repo] of Object.entries(sources.repos)) {
    if (repo.path === absPath) {
      return { key, existing: true };
    }
  }

  const key = alias || path.basename(absPath).toLowerCase().replace(/[^a-z0-9-]/g, '-');
  sources.repos[key] = { path: absPath, alias: alias || path.basename(absPath) };
  await saveSources(SOURCES_PATH, sources);
  return { key, existing: false };
}

/**
 * Import items from a scanned repo into SetupMyAi packages.
 * Each item needs: { name, type, relativePath, absolutePath, isDir, targetPackage }
 */
export async function importItems(items, repoKey, repoPath) {
  const sources = await loadSources(SOURCES_PATH);
  if (!sources.files) sources.files = [];

  const results = [];
  const today = new Date().toISOString().slice(0, 10);

  for (const item of items) {
    const pkg = item.targetPackage;
    const typeDir = item.type + 's'; // command -> commands, rule -> rules, etc.
    const destDir = path.join(SETUP_ROOT, 'packages', pkg, typeDir);

    await fs.ensureDir(destDir);

    let destPath;
    if (item.isDir) {
      destPath = path.join(destDir, item.name);
      await fs.copy(item.absolutePath, destPath, { overwrite: false });
    } else {
      destPath = path.join(destDir, item.name);
      await fs.copy(item.absolutePath, destPath, { overwrite: false });
    }

    const localRelative = path.relative(SETUP_ROOT, destPath);

    // Add to sources tracking
    sources.files.push({
      local: localRelative,
      sources: [{ repo: repoKey, path: item.relativePath }],
      package: pkg,
      type: item.type,
      last_synced: today,
      direction: 'origin',
    });

    results.push({ item, destPath: localRelative, status: 'imported' });
  }

  await saveSources(SOURCES_PATH, sources);
  return results;
}

/**
 * Sync FROM source repos into SetupMyAi (pull).
 * Compares file modification times to detect which side is newer.
 */
export async function syncFrom(repoFilter) {
  const sources = await loadSources(SOURCES_PATH);
  const changes = [];

  for (const entry of sources.files || []) {
    const localPath = path.join(SETUP_ROOT, entry.local);

    for (const src of entry.sources || []) {
      // Filter by repo if specified
      if (repoFilter && src.repo !== repoFilter) continue;

      const repo = sources.repos?.[src.repo];
      if (!repo) continue;

      const sourcePath = path.join(repo.path, src.path);

      if (!(await fs.pathExists(sourcePath))) {
        changes.push({ entry, sourcePath, status: 'source-missing' });
        continue;
      }
      if (!(await fs.pathExists(localPath))) {
        changes.push({ entry, sourcePath, localPath, status: 'local-missing', direction: 'pull' });
        continue;
      }

      const sourceStat = await fs.stat(sourcePath);
      const localStat = await fs.stat(localPath);

      if (sourceStat.mtimeMs > localStat.mtimeMs) {
        changes.push({
          entry,
          sourcePath,
          localPath,
          status: 'source-newer',
          direction: 'pull',
          sourceModified: sourceStat.mtime,
          localModified: localStat.mtime,
        });
      }
    }
  }

  return changes;
}

/**
 * Sync TO source repos from SetupMyAi (push).
 * Compares file modification times to detect which side is newer.
 */
export async function syncTo(repoFilter) {
  const sources = await loadSources(SOURCES_PATH);
  const changes = [];

  for (const entry of sources.files || []) {
    const localPath = path.join(SETUP_ROOT, entry.local);

    if (!(await fs.pathExists(localPath))) continue;

    for (const src of entry.sources || []) {
      if (repoFilter && src.repo !== repoFilter) continue;

      const repo = sources.repos?.[src.repo];
      if (!repo) continue;

      const sourcePath = path.join(repo.path, src.path);
      const localStat = await fs.stat(localPath);

      if (!(await fs.pathExists(sourcePath))) {
        changes.push({
          entry,
          sourcePath,
          localPath,
          status: 'new-in-setupmyai',
          direction: 'push',
        });
        continue;
      }

      const sourceStat = await fs.stat(sourcePath);

      if (localStat.mtimeMs > sourceStat.mtimeMs) {
        changes.push({
          entry,
          sourcePath,
          localPath,
          status: 'local-newer',
          direction: 'push',
          sourceModified: sourceStat.mtime,
          localModified: localStat.mtime,
        });
      }
    }
  }

  return changes;
}

/**
 * Apply sync changes (both pull and push).
 */
export async function applyChanges(changes) {
  const sources = await loadSources(SOURCES_PATH);
  const today = new Date().toISOString().slice(0, 10);
  const applied = [];

  for (const change of changes) {
    if (change.direction === 'pull') {
      await fs.ensureDir(path.dirname(change.localPath));
      await fs.copy(change.sourcePath, change.localPath, { overwrite: true });

      // Update last_synced
      const tracked = sources.files?.find((f) => f.local === change.entry.local);
      if (tracked) tracked.last_synced = today;

      applied.push({ ...change, result: 'applied' });
    } else if (change.direction === 'push') {
      await fs.ensureDir(path.dirname(change.sourcePath));
      await fs.copy(change.localPath, change.sourcePath, { overwrite: true });

      const tracked = sources.files?.find((f) => f.local === change.entry.local);
      if (tracked) tracked.last_synced = today;

      applied.push({ ...change, result: 'applied' });
    }
  }

  await saveSources(SOURCES_PATH, sources);
  return applied;
}

/**
 * Build a preview table for sync operations.
 */
export function buildSyncPreview(changes, direction) {
  const lines = [];
  lines.push('');
  lines.push(chalk.bold(`  Preview: sync-${direction}`));
  lines.push(chalk.gray('  ─'.repeat(35)));
  lines.push('');

  if (changes.length === 0) {
    lines.push(chalk.green('  Everything is up to date!'));
    lines.push('');
    return lines.join('\n');
  }

  // Group by repo
  const grouped = {};
  for (const change of changes) {
    for (const src of change.entry.sources || []) {
      const repo = src.repo;
      if (!grouped[repo]) grouped[repo] = [];
      grouped[repo].push(change);
    }
  }

  for (const [repo, repoChanges] of Object.entries(grouped).sort()) {
    lines.push(`  ${chalk.blue(`📂 ${repo}`)}`);

    for (const change of repoChanges) {
      const icon = { command: '⚡', rule: '📏', agent: '🤖', skill: '🧠', hook: '🪝', script: '📜' }[change.entry.type] || '📄';

      let status;
      if (change.status === 'source-missing') {
        status = chalk.red('✗ source deleted');
      } else if (change.status === 'source-newer') {
        status = chalk.cyan('← pull (source newer)');
      } else if (change.status === 'local-newer') {
        status = chalk.yellow('→ push (local newer)');
      } else if (change.status === 'local-missing') {
        status = chalk.cyan('← pull (new in source)');
      } else if (change.status === 'new-in-setupmyai') {
        status = chalk.yellow('→ push (new locally)');
      }

      const name = path.basename(change.entry.local);
      const pkg = change.entry.package;
      lines.push(`    ${icon} ${name.padEnd(35)} ${chalk.gray(pkg.padEnd(18))} ${status}`);

      // Show timestamps if available
      if (change.sourceModified && change.localModified) {
        const srcTime = new Date(change.sourceModified).toLocaleString();
        const locTime = new Date(change.localModified).toLocaleString();
        lines.push(chalk.gray(`      source: ${srcTime}  |  local: ${locTime}`));
      }
    }
    lines.push('');
  }

  lines.push(chalk.gray(`  Total: ${changes.length} change(s)`));
  lines.push('');

  return lines.join('\n');
}
