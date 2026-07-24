import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { mdToMdc, mdFilenameToMdc } from './converter.js';
import { mergeSettings, mergeMcpConfig } from './merger.js';
import {
  buildManagedRecord,
  getToolRoot,
  recordInstall,
  resolveTools,
} from './inventory.js';

const PACKAGES_ROOT = path.resolve(
  new URL('../../packages', import.meta.url).pathname
);

const CONTENT_DIRS = {
  commands: 'commands',
  rules: 'rules',
  agents: 'agents',
  skills: 'skills',
  '{skills}': 'skills',
  '{rules}': 'rules',
};

/**
 * Install a single package into the target directory.
 *
 * @param {string} packageName - Key from PACKAGES registry
 * @param {string} targetDir   - Absolute path to the user's project root
 * @param {object} options      - { tool: string|string[], level: 'user'|'project' }
 */
export async function installPackage(packageName, targetDir, options = {}) {
  const tools = resolveTools(options.tool || 'all');
  const level = options.level || 'project';
  const pkgDir = path.join(PACKAGES_ROOT, packageName);

  if (!(await fs.pathExists(pkgDir))) {
    throw new Error(`Package "${packageName}" not found at ${pkgDir}`);
  }

  const entries = await fs.readdir(pkgDir, { withFileTypes: true });
  let filesInstalled = 0;
  const records = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dirName = entry.name;

    if (dirName === 'hooks') {
      const installed = await installHooks(pkgDir, targetDir, tools, level, packageName, records);
      filesInstalled += installed;
      continue;
    }

    if (dirName === 'scripts') {
      const installed = await installScripts(pkgDir, targetDir, level, packageName, records);
      filesInstalled += installed;
      continue;
    }

    if (dirName === 'mcp') {
      const installed = await installMcp(pkgDir, targetDir, tools, level, packageName, records);
      filesInstalled += installed;
      continue;
    }

    const srcDir = path.join(pkgDir, dirName);
    const files = await listFiles(srcDir);

    for (const srcFile of files) {
      const relativeFile = path.relative(srcDir, srcFile);

      for (const tool of tools) {
        const contentDir = CONTENT_DIRS[dirName];
        if (!contentDir) continue;

        const toolRoot = getToolRoot(targetDir, level, tool);
        const isRule = dirName === 'rules' || dirName === '{rules}';
        const isMdFile = relativeFile.endsWith('.md');
        const needsMdcConvert = tool === 'cursor' && isRule && isMdFile;

        if (needsMdcConvert) {
          const content = await fs.readFile(srcFile, 'utf-8');
          const mdcContent = mdToMdc(content);
          const mdcFilename = mdFilenameToMdc(relativeFile);
          const dest = path.join(toolRoot, contentDir, mdcFilename);
          await fs.ensureDir(path.dirname(dest));
          await fs.writeFile(dest, mdcContent, 'utf-8');
          records.push(await buildManagedRecord({
            packageName,
            tool,
            level,
            type: primitiveType(dirName),
            sourcePath: srcFile,
            destinationPath: dest,
            installMode: 'cursor-mdc',
            targetDir,
          }));
        } else {
          const dest = path.join(toolRoot, contentDir, relativeFile);
          await fs.ensureDir(path.dirname(dest));
          await fs.copy(srcFile, dest);
          records.push(await buildManagedRecord({
            packageName,
            tool,
            level,
            type: primitiveType(dirName),
            sourcePath: srcFile,
            destinationPath: dest,
            installMode: 'copy',
            targetDir,
          }));
        }
        filesInstalled++;
      }
    }
  }

  await recordInstall(targetDir, level, records);
  return filesInstalled;
}

async function listFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

function primitiveType(dirName) {
  const normalized = CONTENT_DIRS[dirName] || dirName;
  return normalized.endsWith('s') ? normalized.slice(0, -1) : normalized;
}

async function installHooks(pkgDir, targetDir, tools, level, packageName, records) {
  const hooksDir = path.join(pkgDir, 'hooks');
  const files = await fs.readdir(hooksDir);
  let installed = 0;

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const sourcePath = path.join(hooksDir, file);
    const hooksConfig = await fs.readJson(path.join(hooksDir, file));

    for (const tool of tools) {
      if (tool !== 'claude') continue;
      const toolRoot = getToolRoot(targetDir, level, tool);
      const settingsPath = path.join(toolRoot, 'settings.json');
      await mergeSettings(settingsPath, hooksConfig);
      records.push(await buildManagedRecord({
        packageName,
        tool,
        level,
        type: 'hook',
        sourcePath,
        destinationPath: settingsPath,
        installMode: 'merge-settings',
        targetDir,
      }));
      installed++;
    }
  }

  return installed;
}

async function installScripts(pkgDir, targetDir, level, packageName, records) {
  const scriptsDir = path.join(pkgDir, 'scripts');
  const userScriptsDir = path.join(os.homedir(), '.claude', 'scripts');
  const files = await listFiles(scriptsDir);
  let installed = 0;

  await fs.ensureDir(userScriptsDir);
  for (const sourcePath of files) {
    const relativeFile = path.relative(scriptsDir, sourcePath);
    const destinationPath = path.join(userScriptsDir, relativeFile);
    await fs.ensureDir(path.dirname(destinationPath));
    await fs.copy(sourcePath, destinationPath, { overwrite: false });
    records.push(await buildManagedRecord({
      packageName,
      tool: 'claude',
      level,
      type: 'script',
      sourcePath,
      destinationPath,
      installMode: 'copy',
      targetDir,
    }));
    installed++;
  }

  return installed;
}

async function installMcp(pkgDir, targetDir, tools, level, packageName, records) {
  const mcpDir = path.join(pkgDir, 'mcp');
  const files = await fs.readdir(mcpDir);
  let installed = 0;

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const sourcePath = path.join(mcpDir, file);
    const mcpConfig = await fs.readJson(sourcePath);

    for (const tool of tools) {
      if (tool !== 'cursor') continue;
      const toolRoot = getToolRoot(targetDir, level, tool);
      const mcpPath = path.join(toolRoot, 'mcp.json');
      await mergeMcpConfig(mcpPath, mcpConfig);
      records.push(await buildManagedRecord({
        packageName,
        tool,
        level,
        type: 'mcp',
        sourcePath,
        destinationPath: mcpPath,
        installMode: 'merge-mcp',
        targetDir,
      }));
      installed++;
    }
  }

  return installed;
}
