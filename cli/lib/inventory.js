import crypto from 'crypto';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { isDeepStrictEqual } from 'node:util';
import yaml from 'yaml';
import { mdToMdc } from './converter.js';
import { getHookEntryKey } from './merger.js';
import { getPackage, SUPPORTED_TOOLS } from './packages.js';

const PACKAGES_ROOT = path.resolve(
  new URL('../../packages', import.meta.url).pathname
);

export const MANIFEST_VERSION = 1;
export const MANAGED_DIR = '.setupmyai';
export const MANIFEST_FILE = 'installed.yml';
export const INVENTORY_DIRS = ['commands', 'rules', 'agents', 'skills', 'hooks', 'scripts', 'plugins'];
export const UPDATEABLE_STATUSES = new Set(['outdated', 'missing']);
const MISSING_MANAGED_VALUE = Object.freeze({ $setupmyai: 'missing' });

function toPosixPath(value) {
  return value.split(path.sep).join('/');
}

function nowIso() {
  return new Date().toISOString();
}

function hashContent(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
}

function hashManagedContent(value) {
  return hashContent(JSON.stringify(canonicalize(value)));
}

function isMergeMode(installMode) {
  return installMode === 'merge-settings'
    || installMode === 'merge-settings-project'
    || installMode === 'merge-mcp';
}

function projectScriptCommand(command) {
  return command.replace(
    /^~\/\.claude\/scripts\/([^\s]+)/,
    '"${CLAUDE_PROJECT_DIR}/.claude/scripts/$1"'
  );
}

export function prepareSettingsConfig(config, installMode) {
  if (installMode !== 'merge-settings-project') return config;

  const prepared = structuredClone(config);
  for (const hookEntries of Object.values(prepared.hooks || {})) {
    for (const entry of hookEntries) {
      if (typeof entry.command === 'string') {
        entry.command = projectScriptCommand(entry.command);
      }
      for (const handler of entry.hooks || []) {
        if (typeof handler.command === 'string') {
          handler.command = projectScriptCommand(handler.command);
        }
      }
    }
  }
  return prepared;
}

function selectManagedContent(source, installMode) {
  const prepared = prepareSettingsConfig(source, installMode);
  if (installMode === 'merge-mcp') {
    return { mcpServers: prepared.mcpServers || {} };
  }
  return prepared;
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

export function resolvePackages(packages) {
  if (!packages || packages === 'all') return null;
  if (Array.isArray(packages)) return new Set(packages);
  return new Set(packages.split(',').map((packageKey) => packageKey.trim()).filter(Boolean));
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

function managedRecordKey(item) {
  const sourcePath = path.isAbsolute(item.sourcePath)
    ? relativeToSetupRoot(item.sourcePath)
    : item.sourcePath;
  return [
    item.level || '',
    item.tool || '',
    item.packageKey || '',
    item.installMode || '',
    sourcePath || '',
    path.resolve(item.destinationPath),
  ].join('\0');
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
  const managedContent = isMergeMode(installMode)
    ? selectManagedContent(await fs.readJson(sourcePath), installMode)
    : undefined;
  const installedHash = await getCurrentInstalledHash({
    sourcePath,
    destinationPath,
    installMode,
    managedContent,
  });

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
    ...(managedContent ? { managedContent } : {}),
  };
}

export async function recordInstall(targetDir, level, records) {
  if (!records.length) return;

  const manifest = await loadManifest(targetDir, level);
  const byManagedRecord = new Map(
    manifest.items.map((item) => [managedRecordKey(item), item])
  );

  for (const record of records) {
    byManagedRecord.set(managedRecordKey(record), record);
  }

  manifest.items = [...byManagedRecord.values()].sort((a, b) => {
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
  if (isMergeMode(installMode)) {
    return hashManagedContent(
      selectManagedContent(await fs.readJson(sourcePath), installMode)
    );
  }
  return hashContent(await getExpectedContent({ sourcePath, installMode }));
}

async function getCurrentPackageVersion(item) {
  return await getPackageVersion(item.packageKey);
}

function findManagedHook(currentEntries, expectedEntry, usedIndexes) {
  const availableIndexes = currentEntries
    .map((_, index) => index)
    .filter((index) => !usedIndexes.has(index));
  const exactIndex = availableIndexes.find((index) => {
    return isDeepStrictEqual(currentEntries[index], expectedEntry);
  });
  if (exactIndex !== undefined) {
    usedIndexes.add(exactIndex);
    return currentEntries[exactIndex];
  }

  const expectedKey = getHookEntryKey(expectedEntry);
  const identityMatches = availableIndexes.filter((index) => {
    return getHookEntryKey(currentEntries[index]) === expectedKey;
  });
  if (identityMatches.length === 1) {
    usedIndexes.add(identityMatches[0]);
    return currentEntries[identityMatches[0]];
  }

  if (Object.hasOwn(expectedEntry, 'matcher')) {
    const matcherMatches = availableIndexes.filter((index) => {
      return currentEntries[index]?.matcher === expectedEntry.matcher;
    });
    if (matcherMatches.length === 1) {
      usedIndexes.add(matcherMatches[0]);
      return currentEntries[matcherMatches[0]];
    }
  }

  return MISSING_MANAGED_VALUE;
}

function extractManagedSettings(current, managedContent) {
  const extracted = {};

  for (const [key, expectedValue] of Object.entries(managedContent || {})) {
    if (key !== 'hooks') {
      extracted[key] = Object.hasOwn(current, key)
        ? current[key]
        : MISSING_MANAGED_VALUE;
      continue;
    }

    extracted.hooks = {};
    for (const [event, expectedEntries] of Object.entries(expectedValue || {})) {
      const currentEntries = current.hooks?.[event] || [];
      const usedIndexes = new Set();
      extracted.hooks[event] = expectedEntries.map((entry) => {
        return findManagedHook(currentEntries, entry, usedIndexes);
      });
    }
  }

  return extracted;
}

function extractManagedMcp(current, managedContent) {
  const extracted = { mcpServers: {} };
  for (const serverName of Object.keys(managedContent?.mcpServers || {})) {
    extracted.mcpServers[serverName] = Object.hasOwn(current.mcpServers || {}, serverName)
      ? current.mcpServers[serverName]
      : MISSING_MANAGED_VALUE;
  }
  return extracted;
}

async function getManagedContent(item) {
  if (item.managedContent) return item.managedContent;
  return selectManagedContent(await fs.readJson(item.sourcePath), item.installMode);
}

async function getCurrentInstalledHash(item) {
  if (!isMergeMode(item.installMode)) {
    return hashFile(item.destinationPath);
  }

  const current = await fs.readJson(item.destinationPath);
  const managedContent = await getManagedContent(item);
  const extracted = item.installMode === 'merge-settings'
      || item.installMode === 'merge-settings-project'
    ? extractManagedSettings(current, managedContent)
    : extractManagedMcp(current, managedContent);
  return hashManagedContent(extracted);
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

  const currentInstalledHash = await getCurrentInstalledHash({
    ...item,
    sourcePath,
    destinationPath,
  });
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
  } else if (currentInstalledHash !== currentSourceHash) {
    status = 'modified';
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

      for (const configFile of ['settings.json', 'mcp.json', 'hooks.json']) {
        const configPath = path.join(toolRoot, configFile);
        if (await fs.pathExists(configPath)) {
          const resolved = path.resolve(configPath);
          if (!managedDestinations.has(resolved)) {
            unmanaged.push({
              name: configFile,
              type: configFile === 'hooks.json' ? 'hook' : 'config',
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
  const requestedPackages = resolvePackages(options.package);
  const managed = [];
  const managedDestinations = new Set();
  const manifests = [];

  for (const level of levels) {
    const manifest = await loadManifest(targetDir, level);
    manifests.push({ level, path: getManifestPath(targetDir, level), manifest });

    for (const item of manifest.items) {
      if (!requestedTools.includes(item.tool)) continue;
      if (requestedPackages && !requestedPackages.has(item.packageKey)) continue;
      const classified = await classifyManagedItem(item);
      managed.push(classified);
      managedDestinations.add(path.resolve(item.destinationPath));
    }
  }

  const unmanaged = options.includeUnmanaged === false || requestedPackages
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
  if (item.installMode === 'copy') {
    await fs.ensureDir(path.dirname(item.destinationPath));
    await fs.copy(item.sourcePath, item.destinationPath, { overwrite: true });
    return;
  }

  const content = await getExpectedContent({
    sourcePath: item.sourcePath,
    installMode: item.installMode,
  });
  await fs.ensureDir(path.dirname(item.destinationPath));
  await fs.writeFile(item.destinationPath, content, 'utf-8');
}

function hooksFromManagedContents(managedContents) {
  const hooks = {};
  for (const managedContent of managedContents) {
    for (const [event, entries] of Object.entries(managedContent?.hooks || {})) {
      hooks[event] = [...(hooks[event] || []), ...entries];
    }
  }
  return hooks;
}

function isProtectedHook(entry, protectedEntries) {
  return protectedEntries.some((candidate) => isDeepStrictEqual(candidate, entry));
}

function findReplaceableHookIndex(entries, previousEntry, protectedEntries) {
  const exactIndex = entries.findIndex((entry) => {
    return isDeepStrictEqual(entry, previousEntry)
      && !isProtectedHook(entry, protectedEntries);
  });
  if (exactIndex >= 0) return exactIndex;

  const expectedKey = getHookEntryKey(previousEntry);
  const identityMatches = entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => {
      return getHookEntryKey(entry) === expectedKey
        && !isProtectedHook(entry, protectedEntries);
    });
  if (identityMatches.length === 1) return identityMatches[0].index;
  if (identityMatches.length > 1) return -2;

  if (!Object.hasOwn(previousEntry, 'matcher')) return -1;
  const matcherMatches = entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => {
      return entry?.matcher === previousEntry.matcher
        && !isProtectedHook(entry, protectedEntries);
    });
  if (matcherMatches.length === 1) return matcherMatches[0].index;
  if (matcherMatches.length > 1) return -2;
  return -1;
}

function replaceManagedHooks(
  current,
  previousHooks = {},
  nextHooks = {},
  force = false,
  protectedHooks = {}
) {
  current.hooks = current.hooks || {};
  const events = new Set([...Object.keys(previousHooks), ...Object.keys(nextHooks)]);

  for (const event of events) {
    const entries = [...(current.hooks[event] || [])];
    const protectedEntries = protectedHooks[event] || [];
    for (const previousEntry of previousHooks[event] || []) {
      let index = entries.findIndex((entry) => {
        return isDeepStrictEqual(entry, previousEntry)
          && !isProtectedHook(entry, protectedEntries);
      });
      if (index < 0 && force) {
        index = findReplaceableHookIndex(entries, previousEntry, protectedEntries);
        if (index === -2) {
          throw new Error(`Managed hook for ${event} is ambiguous and cannot be replaced safely`);
        }
      }
      if (index >= 0) entries.splice(index, 1);
    }

    for (const nextEntry of nextHooks[event] || []) {
      if (entries.some((entry) => isDeepStrictEqual(entry, nextEntry))) continue;

      const identityCollision = entries.find((entry) => {
        return getHookEntryKey(entry) === getHookEntryKey(nextEntry);
      });
      if (identityCollision) {
        throw new Error(`Managed hook for ${event} conflicts with existing hook content`);
      }
      entries.push(nextEntry);
    }

    if (entries.length > 0) {
      current.hooks[event] = entries;
    } else {
      delete current.hooks[event];
    }
  }
}

function validateManagedProjection(current, managedContent, installMode, destinationPath) {
  const extracted = installMode === 'merge-mcp'
    ? extractManagedMcp(current, managedContent)
    : extractManagedSettings(current, managedContent);
  if (hashManagedContent(extracted) !== hashManagedContent(managedContent)) {
    throw new Error(`Managed content at ${destinationPath} could not be updated safely`);
  }
}

async function replaceManagedSettings(
  destinationPath,
  previous,
  next,
  force,
  protectedManagedContents = []
) {
  const original = await fs.pathExists(destinationPath)
    ? await fs.readJson(destinationPath)
    : {};
  const current = structuredClone(original);
  const protectedHooks = hooksFromManagedContents(protectedManagedContents);

  if (previous?.hooks || next?.hooks) {
    replaceManagedHooks(
      current,
      previous?.hooks,
      next?.hooks,
      force,
      protectedHooks
    );
  }
  const keys = new Set([
    ...Object.keys(previous || {}).filter((key) => key !== 'hooks'),
    ...Object.keys(next || {}).filter((key) => key !== 'hooks'),
  ]);

  for (const key of keys) {
    const hadPrevious = Object.hasOwn(previous || {}, key);
    const hasNext = Object.hasOwn(next || {}, key);
    const protectedValues = protectedManagedContents
      .filter((content) => Object.hasOwn(content || {}, key))
      .map((content) => content[key]);
    if (protectedValues.length > 0) {
      if (hasNext && !protectedValues.every((value) => isDeepStrictEqual(value, next[key]))) {
        throw new Error(`Managed setting "${key}" conflicts with another managed package`);
      }
      continue;
    }

    const unchanged = hadPrevious && isDeepStrictEqual(current[key], previous[key]);

    if (hadPrevious && !unchanged && !force) continue;
    if (!hadPrevious
      && hasNext
      && Object.hasOwn(current, key)
      && !isDeepStrictEqual(current[key], next[key])) {
      throw new Error(`Managed setting "${key}" conflicts with existing user content`);
    }
    if (hasNext) {
      current[key] = next[key];
    } else {
      delete current[key];
    }
  }

  validateManagedProjection(current, next, 'merge-settings', destinationPath);
  await fs.ensureDir(path.dirname(destinationPath));
  await fs.writeJson(destinationPath, current, { spaces: 2 });
}

async function replaceManagedMcp(
  destinationPath,
  previous,
  next,
  force,
  protectedManagedContents = []
) {
  const original = await fs.pathExists(destinationPath)
    ? await fs.readJson(destinationPath)
    : {};
  const current = structuredClone(original);
  current.mcpServers = current.mcpServers || {};

  const previousServers = previous?.mcpServers || {};
  const nextServers = next?.mcpServers || {};
  const serverNames = new Set([
    ...Object.keys(previousServers),
    ...Object.keys(nextServers),
  ]);

  for (const serverName of serverNames) {
    const hadPrevious = Object.hasOwn(previousServers, serverName);
    const hasNext = Object.hasOwn(nextServers, serverName);
    const protectedValues = protectedManagedContents
      .filter((content) => Object.hasOwn(content?.mcpServers || {}, serverName))
      .map((content) => content.mcpServers[serverName]);
    if (protectedValues.length > 0) {
      if (hasNext && !protectedValues.every((value) => {
        return isDeepStrictEqual(value, nextServers[serverName]);
      })) {
        throw new Error(`Managed MCP server "${serverName}" conflicts with another managed package`);
      }
      continue;
    }

    const unchanged = hadPrevious
      && isDeepStrictEqual(current.mcpServers[serverName], previousServers[serverName]);

    if (hadPrevious && !unchanged && !force) continue;
    if (!hadPrevious
      && hasNext
      && Object.hasOwn(current.mcpServers, serverName)
      && !isDeepStrictEqual(current.mcpServers[serverName], nextServers[serverName])) {
      throw new Error(`Managed MCP server "${serverName}" conflicts with existing user content`);
    }

    if (hasNext) {
      current.mcpServers[serverName] = nextServers[serverName];
    } else {
      delete current.mcpServers[serverName];
    }
  }

  validateManagedProjection(current, next, 'merge-mcp', destinationPath);
  await fs.ensureDir(path.dirname(destinationPath));
  await fs.writeJson(destinationPath, current, { spaces: 2 });
}

async function applyManagedUpdate(item, options = {}) {
  const previousManagedContent = isMergeMode(item.installMode)
    ? await getManagedContent(item)
    : undefined;
  const nextManagedContent = isMergeMode(item.installMode)
    ? selectManagedContent(await fs.readJson(item.sourcePath), item.installMode)
    : undefined;

  if (item.installMode === 'merge-settings' || item.installMode === 'merge-settings-project') {
    await replaceManagedSettings(
      item.destinationPath,
      previousManagedContent,
      nextManagedContent,
      options.force,
      options.protectedManagedContents
    );
  } else if (item.installMode === 'merge-mcp') {
    await replaceManagedMcp(
      item.destinationPath,
      previousManagedContent,
      nextManagedContent,
      options.force,
      options.protectedManagedContents
    );
  } else {
    await writeExpectedContent(item);
  }

  const nextSourceHash = await getExpectedSourceHash({
    sourcePath: item.sourcePath,
    installMode: item.installMode,
  });
  const nextInstalledHash = await getCurrentInstalledHash({
    ...item,
    managedContent: nextManagedContent,
  });
  const expectedInstalledHash = nextManagedContent
    ? hashManagedContent(nextManagedContent)
    : nextSourceHash;

  if (nextInstalledHash !== expectedInstalledHash) {
    throw new Error(`Managed content at ${item.destinationPath} could not be updated safely`);
  }

  return {
    ...item,
    packageVersion: await getCurrentPackageVersion(item),
    sourceHash: nextSourceHash,
    installedHash: nextInstalledHash,
    installedAt: nowIso(),
    ...(nextManagedContent ? { managedContent: nextManagedContent } : {}),
    result: options.result || 'updated',
  };
}

export async function updateInventory(targetDir, options = {}) {
  const inventory = await getInventory(targetDir, {
    level: options.level || 'project',
    tool: options.tool || 'all',
    package: options.package,
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

    const protectedManagedContents = inventory.manifests
      .flatMap(({ manifest }) => manifest.items)
      .filter((candidate) => {
        return candidate.managedContent
          && path.resolve(candidate.destinationPath) === path.resolve(item.destinationPath)
          && managedRecordKey(candidate) !== managedRecordKey(item);
      })
      .map((candidate) => candidate.managedContent);
    const updated = await applyManagedUpdate(item, {
      force: options.force,
      protectedManagedContents,
    });
    results.push(updated);
  }

  if (!options.dryRun) {
    const updatedByLevel = new Map();
    for (const level of resolveLevels(options.level || 'project')) {
      const manifest = await loadManifest(targetDir, level);
      updatedByLevel.set(level, new Map(manifest.items.map((item) => [managedRecordKey(item), item])));
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
      levelMap.set(managedRecordKey(manifestItem), manifestItem);
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
