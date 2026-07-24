import crypto from 'crypto';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import yaml from 'yaml';
import { mdToMdc } from './converter.js';
import { mergeMcpConfig, mergeSettings } from './merger.js';
import { getPackage, SUPPORTED_TOOLS } from './packages.js';

const PACKAGES_ROOT = path.resolve(
  new URL('../../packages', import.meta.url).pathname
);

export const MANIFEST_VERSION = 1;
export const MANAGED_DIR = '.setupmyai';
export const MANIFEST_FILE = 'installed.yml';
export const INVENTORY_DIRS = ['commands', 'rules', 'agents', 'skills', 'hooks', 'scripts'];
export const UPDATEABLE_STATUSES = new Set(['outdated', 'missing']);

function toPosixPath(value) {
  return value.split(path.sep).join('/');
}

function nowIso() {
  return new Date().toISOString();
}

function hashContent(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function hashFile(filePath) {
  return hashContent(await fs.readFile(filePath));
}

export function resolveTools(tools) {
  if (!tools || tools === 'all') return [...SUPPORTED_TOOLS];
  if (Array.isArray(tools)) return tools;
  return tools.split(',').map((tool) => tool.trim()).filter(Boolean);
}

export function resolveLevels(level) {
  if (!level || level === 'project') return ['project'];
  if (level === 'all') return ['project', 'user'];
  return [level];
}

export function getToolRoot(targetDir, level, tool) {
  if (level === 'user') {
    return path.join(os.homedir(), `.${tool}`);
  }
  return path.join(targetDir, `.${tool}`);
}

export function getManifestPath(targetDir, level) {
  if (level === 'user') {
    return path.join(os.homedir(), MANAGED_DIR, MANIFEST_FILE);
  }
  return path.join(targetDir, MANAGED_DIR, MANIFEST_FILE);
}

export function relativeToSetupRoot(filePath) {
  return toPosixPath(path.relative(path.resolve(new URL('../..', import.meta.url).pathname), filePath));
}

export async function loadManifest(targetDir, level) {
  const manifestPath = getManifestPath(targetDir, level);
  if (!(await fs.pathExists(manifestPath))) {
    return {
      version: MANIFEST_VERSION,
      generatedAt: nowIso(),
      items: [],
    };
  }

  const content = await fs.readFile(manifestPath, 'utf-8');
  const manifest = yaml.parse(content) || {};
  return {
    version: manifest.version || MANIFEST_VERSION,
    generatedAt: manifest.generatedAt || nowIso(),
    items: Array.isArray(manifest.items) ? manifest.items : [],
  };
}

export async function saveManifest(targetDir, level, manifest) {
  const manifestPath = getManifestPath(targetDir, level);
  const nextManifest = {
    version: MANIFEST_VERSION,
    generatedAt: nowIso(),
    items: manifest.items || [],
  };
  await fs.ensureDir(path.dirname(manifestPath));
  await fs.writeFile(
    manifestPath,
    yaml.stringify(nextManifest, { lineWidth: 120 }),
    'utf-8'
  );
}

export async function getPackageVersion(packageName) {
  const apmPath = path.join(PACKAGES_ROOT, packageName, 'apm.yml');
  if (!(await fs.pathExists(apmPath))) return null;
  const apm = yaml.parse(await fs.readFile(apmPath, 'utf-8')) || {};
  return apm.version ? String(apm.version) : null;
}

export async function buildManagedRecord({
  packageName,
  tool,
  level,
  type,
  sourcePath,
  destinationPath,
  installMode,
  targetDir,
}) {
  const pkg = getPackage(packageName);
  const packageVersion = await getPackageVersion(packageName);
  const sourceHash = await getExpectedSourceHash({
    sourcePath,
    installMode,
  });
  const installedHash = await hashFile(destinationPath);

  return {
    packageKey: packageName,
    packageName: pkg?.name || `@setupmyai/${packageName}`,
    packageVersion,
    tool,
    level,
    type,
    destinationPath,
    sourcePath: relativeToSetupRoot(sourcePath),
    sourceHash,
    installedHash,
    installedAt: nowIso(),
    installMode,
    targetDir,
  };
}

export async function recordInstall(targetDir, level, records) {
  if (!records.length) return;

  const manifest = await loadManifest(targetDir, level);
  const byDestination = new Map(
    manifest.items.map((item) => [path.resolve(item.destinationPath), item])
  );

  for (const record of records) {
    byDestination.set(path.resolve(record.destinationPath), record);
  }

  manifest.items = [...byDestination.values()].sort((a, b) => {
    return a.destinationPath.localeCompare(b.destinationPath);
  });
  await saveManifest(targetDir, level, manifest);
}

async function getExpectedContent({ sourcePath, installMode }) {
  const source = await fs.readFile(sourcePath, 'utf-8');
  if (installMode === 'cursor-mdc') {
    return mdToMdc(source);
  }
  return source;
}

async function getExpectedSourceHash({ sourcePath, installMode }) {
  if (!(await fs.pathExists(sourcePath))) return null;
  return hashContent(await getExpectedContent({ sourcePath, installMode }));
}

async function getCurrentPackageVersion(item) {
  return await getPackageVersion(item.packageKey);
}

async function classifyManagedItem(item) {
  const sourcePath = path.join(path.resolve(new URL('../..', import.meta.url).pathname), item.sourcePath);
  const destinationPath = item.destinationPath;
  const sourceExists = await fs.pathExists(sourcePath);
  const destinationExists = await fs.pathExists(destinationPath);

  if (!sourceExists) {
    return {
      ...item,
      status: 'orphaned',
      sourcePath,
      destinationPath,
    };
  }

  if (!destinationExists) {
    return {
      ...item,
      status: 'missing',
      sourcePath,
      destinationPath,
      currentPackageVersion: await getCurrentPackageVersion(item),
      currentSourceHash: await getExpectedSourceHash({ sourcePath, installMode: item.installMode }),
    };
  }

  const currentInstalledHash = await hashFile(destinationPath);
  const currentSourceHash = await getExpectedSourceHash({
    sourcePath,
    installMode: item.installMode,
  });
  const currentPackageVersion = await getCurrentPackageVersion(item);

  let status = 'current';
  if (currentInstalledHash !== item.installedHash) {
    status = 'modified';
  } else if (currentSourceHash !== item.sourceHash || currentPackageVersion !== item.packageVersion) {
    status = 'outdated';
  }

  return {
    ...item,
    status,
    sourcePath,
    destinationPath,
    currentInstalledHash,
    currentSourceHash,
    currentPackageVersion,
  };
}

async function walkFiles(dir) {
  if (!(await fs.pathExists(dir))) return [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

async function scanUnmanaged({ targetDir, levels, tools, managedDestinations }) {
  const unmanaged = [];

  for (const level of levels) {
    for (const tool of tools) {
      const toolRoot = getToolRoot(targetDir, level, tool);
      for (const dir of INVENTORY_DIRS) {
        const scanDir = path.join(toolRoot, dir);
        const files = await walkFiles(scanDir);
        for (const file of files) {
          const resolved = path.resolve(file);
          if (managedDestinations.has(resolved)) continue;
          unmanaged.push({
            name: path.basename(file),
            type: dir.endsWith('s') ? dir.slice(0, -1) : dir,
            tool,
            level,
            destinationPath: file,
            status: 'unmanaged',
          });
        }
      }

      for (const configFile of ['settings.json', 'mcp.json']) {
        const configPath = path.join(toolRoot, configFile);
        if (await fs.pathExists(configPath)) {
          const resolved = path.resolve(configPath);
          if (!managedDestinations.has(resolved)) {
            unmanaged.push({
              name: configFile,
              type: 'config',
              tool,
              level,
              destinationPath: configPath,
              status: 'unmanaged',
            });
          }
        }
      }
    }
  }

  return unmanaged.sort((a, b) => a.destinationPath.localeCompare(b.destinationPath));
}

export async function getInventory(targetDir, options = {}) {
  const levels = resolveLevels(options.level || 'project');
  const requestedTools = resolveTools(options.tool || 'all');
  const managed = [];
  const managedDestinations = new Set();
  const manifests = [];

  for (const level of levels) {
    const manifest = await loadManifest(targetDir, level);
    manifests.push({ level, path: getManifestPath(targetDir, level), manifest });

    for (const item of manifest.items) {
      if (!requestedTools.includes(item.tool)) continue;
      const classified = await classifyManagedItem(item);
      managed.push(classified);
      managedDestinations.add(path.resolve(item.destinationPath));
    }
  }

  const unmanaged = options.includeUnmanaged === false
    ? []
    : await scanUnmanaged({
      targetDir,
      levels,
      tools: requestedTools,
      managedDestinations,
    });

  const items = [...managed, ...unmanaged];
  const summary = items.reduce((acc, item) => {
    acc.total++;
    acc.byStatus[item.status] = (acc.byStatus[item.status] || 0) + 1;
    acc.byLevel[item.level] = (acc.byLevel[item.level] || 0) + 1;
    acc.byTool[item.tool] = (acc.byTool[item.tool] || 0) + 1;
    return acc;
  }, { total: 0, byStatus: {}, byLevel: {}, byTool: {} });

  return {
    targetDir,
    manifests,
    items,
    summary,
  };
}

async function writeExpectedContent(item) {
  const content = await getExpectedContent({
    sourcePath: item.sourcePath,
    installMode: item.installMode,
  });
  await fs.ensureDir(path.dirname(item.destinationPath));
  await fs.writeFile(item.destinationPath, content, 'utf-8');
}

async function applyManagedUpdate(item, options = {}) {
  if (item.installMode === 'merge-settings') {
    await mergeSettings(item.destinationPath, await fs.readJson(item.sourcePath));
  } else if (item.installMode === 'merge-mcp') {
    await mergeMcpConfig(item.destinationPath, await fs.readJson(item.sourcePath));
  } else {
    await writeExpectedContent(item);
  }

  const nextSourceHash = await getExpectedSourceHash({
    sourcePath: item.sourcePath,
    installMode: item.installMode,
  });
  const nextInstalledHash = await hashFile(item.destinationPath);

  return {
    ...item,
    packageVersion: await getCurrentPackageVersion(item),
    sourceHash: nextSourceHash,
    installedHash: nextInstalledHash,
    installedAt: nowIso(),
    result: options.result || 'updated',
  };
}

export async function updateInventory(targetDir, options = {}) {
  const inventory = await getInventory(targetDir, {
    level: options.level || 'project',
    tool: options.tool || 'all',
    includeUnmanaged: true,
  });
  const results = [];

  for (const item of inventory.items) {
    if (item.status === 'unmanaged') {
      results.push({ ...item, result: 'skipped-unmanaged' });
      continue;
    }
    if (item.status === 'orphaned') {
      results.push({ ...item, result: 'skipped-orphaned' });
      continue;
    }
    if (item.status === 'modified' && !options.force) {
      results.push({ ...item, result: 'skipped-modified' });
      continue;
    }
    if (!UPDATEABLE_STATUSES.has(item.status) && !(item.status === 'modified' && options.force)) {
      results.push({ ...item, result: 'skipped-current' });
      continue;
    }

    if (options.dryRun) {
      results.push({ ...item, result: 'would-update' });
      continue;
    }

    const updated = await applyManagedUpdate(item);
    results.push(updated);
  }

  if (!options.dryRun) {
    const updatedByLevel = new Map();
    for (const level of resolveLevels(options.level || 'project')) {
      const manifest = await loadManifest(targetDir, level);
      updatedByLevel.set(level, new Map(manifest.items.map((item) => [path.resolve(item.destinationPath), item])));
    }

    for (const result of results) {
      if (result.result !== 'updated') continue;
      const levelMap = updatedByLevel.get(result.level);
      if (!levelMap) continue;
      const manifestItem = { ...result };
      manifestItem.sourcePath = path.isAbsolute(manifestItem.sourcePath)
        ? relativeToSetupRoot(manifestItem.sourcePath)
        : manifestItem.sourcePath;
      delete manifestItem.status;
      delete manifestItem.result;
      delete manifestItem.currentInstalledHash;
      delete manifestItem.currentSourceHash;
      delete manifestItem.currentPackageVersion;
      levelMap.set(path.resolve(result.destinationPath), manifestItem);
    }

    for (const [level, itemsByDestination] of updatedByLevel) {
      await saveManifest(targetDir, level, {
        items: [...itemsByDestination.values()].sort((a, b) => a.destinationPath.localeCompare(b.destinationPath)),
      });
    }
  }

  return {
    inventory,
    results,
    needsUpdate: inventory.items.some((item) => ['outdated', 'missing', 'modified'].includes(item.status)),
  };
}

export function summarizeInstalled(inventory) {
  const packages = new Map();

  for (const item of inventory.items) {
    if (item.status === 'unmanaged') continue;
    const key = `${item.level}:${item.tool}:${item.packageKey}`;
    const existing = packages.get(key) || {
      packageKey: item.packageKey,
      packageName: item.packageName,
      packageVersion: item.packageVersion,
      level: item.level,
      tool: item.tool,
      itemCount: 0,
      statuses: {},
    };
    existing.itemCount++;
    existing.statuses[item.status] = (existing.statuses[item.status] || 0) + 1;
    packages.set(key, existing);
  }

  return [...packages.values()].sort((a, b) => {
    return `${a.level}:${a.tool}:${a.packageKey}`.localeCompare(`${b.level}:${b.tool}:${b.packageKey}`);
  });
}
