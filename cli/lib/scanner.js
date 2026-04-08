import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import yaml from 'yaml';

// Directories to scan inside .claude/ and .cursor/
const SCAN_DIRS = ['commands', 'rules', 'agents', 'skills', 'hooks', 'scripts'];

// Map discovered items to their type
const TYPE_MAP = {
  commands: 'command',
  rules: 'rule',
  agents: 'agent',
  skills: 'skill',
  hooks: 'hook',
  scripts: 'script',
};

/**
 * Scan a repo for all AI config files (.claude/, .cursor/, root CLAUDE.md, AGENTS.md)
 * Returns a structured inventory of everything found.
 */
export async function scanRepo(repoPath) {
  const absPath = path.resolve(repoPath);
  if (!(await fs.pathExists(absPath))) {
    throw new Error(`Repo path does not exist: ${absPath}`);
  }

  const repoName = path.basename(absPath);
  const inventory = {
    repoPath: absPath,
    repoName,
    items: [],
    rootFiles: [],
  };

  // Check root-level files
  for (const rootFile of ['CLAUDE.md', 'AGENTS.md']) {
    const fp = path.join(absPath, rootFile);
    if (await fs.pathExists(fp)) {
      inventory.rootFiles.push({ file: rootFile, path: fp });
    }
  }

  // Scan .claude/ and .cursor/
  for (const toolDir of ['.claude', '.cursor']) {
    const toolBase = path.join(absPath, toolDir);
    if (!(await fs.pathExists(toolBase))) continue;

    for (const dir of SCAN_DIRS) {
      const scanDir = path.join(toolBase, dir);
      if (!(await fs.pathExists(scanDir))) continue;

      const entries = await fs.readdir(scanDir, { withFileTypes: true });

      for (const entry of entries) {
        const entryPath = path.join(scanDir, entry.name);
        const relativePath = path.relative(absPath, entryPath);

        if (entry.isFile()) {
          inventory.items.push({
            name: entry.name,
            type: TYPE_MAP[dir] || dir,
            tool: toolDir.replace('.', ''),
            relativePath,
            absolutePath: entryPath,
            isDir: false,
          });
        } else if (entry.isDirectory()) {
          // Skills are directories with SKILL.md inside
          const skillFile = path.join(entryPath, 'SKILL.md');
          const skillFileAlt = path.join(entryPath, 'SKILL.MD');
          const hasSkill = (await fs.pathExists(skillFile)) || (await fs.pathExists(skillFileAlt));

          inventory.items.push({
            name: entry.name,
            type: TYPE_MAP[dir] || dir,
            tool: toolDir.replace('.', ''),
            relativePath,
            absolutePath: entryPath,
            isDir: true,
            hasSkillMd: hasSkill,
          });
        }
      }
    }

    // Also check settings.json for plugins/hooks
    const settingsPath = path.join(toolBase, 'settings.json');
    if (await fs.pathExists(settingsPath)) {
      inventory.items.push({
        name: 'settings.json',
        type: 'config',
        tool: toolDir.replace('.', ''),
        relativePath: path.relative(absPath, settingsPath),
        absolutePath: settingsPath,
        isDir: false,
      });
    }
  }

  return inventory;
}

/**
 * Compare scanned repo items against existing sources.yml to find new/changed items.
 */
export async function diffWithSources(inventory, sourcesPath) {
  const existing = await loadSources(sourcesPath);
  const existingPaths = new Set();

  // Collect all source paths already tracked
  for (const entry of existing.files || []) {
    for (const src of entry.sources || []) {
      existingPaths.add(src.path);
    }
  }

  const newItems = [];
  const existingItems = [];

  for (const item of inventory.items) {
    if (item.type === 'config') continue; // skip settings.json from diff

    if (existingPaths.has(item.relativePath)) {
      existingItems.push(item);
    } else {
      newItems.push(item);
    }
  }

  return { newItems, existingItems };
}

/**
 * Load sources.yml
 */
export async function loadSources(sourcesPath) {
  if (!(await fs.pathExists(sourcesPath))) {
    return { repos: {}, files: [] };
  }
  const content = await fs.readFile(sourcesPath, 'utf-8');
  return yaml.parse(content) || { repos: {}, files: [] };
}

/**
 * Save sources.yml
 */
export async function saveSources(sourcesPath, data) {
  const header = `# SetupMyAi Source Manifest
# Tracks where every file originated from, enabling bidirectional sync.
# Auto-generated — edits will be preserved on next scan.

`;
  const content = header + yaml.stringify(data, { lineWidth: 120 });
  await fs.writeFile(sourcesPath, content, 'utf-8');
}

/**
 * Suggest which package a scanned item should belong to, based on its name/type.
 */
export function suggestPackage(item) {
  const name = item.name.toLowerCase();

  if (name.includes('bdd') || name.includes('playwright')) return 'bdd-testing';
  if (name.includes('kotlin') || name.includes('ktor')) return 'kotlin-backend';
  if (name.includes('vercel') || name.includes('nextjs')) return 'vercel-nextjs';
  if (name.includes('auth') || name.includes('security') || name.includes('2fa') || name.includes('password')) return 'auth-security';
  if (name.includes('postgres') || name.includes('migration') || name.includes('database')) return 'database';
  if (name.includes('react') || name.includes('frontend') || name.includes('component') || name.includes('css')) return 'react-frontend';
  if (name.includes('mr') || name.includes('ci') || name.includes('worktree') || name.includes('rebase') || name.includes('test')) return 'universal';

  return 'universal'; // default
}

/**
 * Build a preview table for display before executing.
 */
export function buildPreview(items, repoAlias, action = 'import') {
  const lines = [];
  lines.push('');
  lines.push(chalk.bold(`  Preview: ${action === 'import' ? 'Import from' : 'Sync to'} ${chalk.cyan(repoAlias)}`));
  lines.push(chalk.gray('  ─'.repeat(35)));
  lines.push('');

  const grouped = {};
  for (const item of items) {
    const pkg = item.targetPackage || suggestPackage(item);
    if (!grouped[pkg]) grouped[pkg] = [];
    grouped[pkg].push(item);
  }

  for (const [pkg, pkgItems] of Object.entries(grouped).sort()) {
    lines.push(`  ${chalk.blue(`📦 ${pkg}`)}`);
    for (const item of pkgItems) {
      const icon = { command: '⚡', rule: '📏', agent: '🤖', skill: '🧠', hook: '🪝', script: '📜' }[item.type] || '📄';
      const status = action === 'import'
        ? chalk.green('+ new')
        : item.direction === 'newer-local' ? chalk.yellow('→ push') : chalk.cyan('← pull');
      lines.push(`    ${icon} ${item.name.padEnd(40)} ${chalk.gray(item.type.padEnd(10))} ${status}`);
    }
    lines.push('');
  }

  lines.push(chalk.gray(`  Total: ${items.length} item(s)`));
  lines.push('');

  return lines.join('\n');
}
