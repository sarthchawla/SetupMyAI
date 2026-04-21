import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import { mdToMdc, mdFilenameToMdc } from './converter.js';
import { mergeSettings, mergeMcpConfig } from './merger.js';
import { SUPPORTED_TOOLS } from './packages.js';

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

function resolveTools(tools) {
  if (!tools || tools === 'all') return [...SUPPORTED_TOOLS];
  if (Array.isArray(tools)) return tools;
  return tools.split(',').map((t) => t.trim()).filter(Boolean);
}

function getToolRoot(targetDir, level, tool) {
  if (level === 'user') {
    return path.join(os.homedir(), `.${tool}`);
  }
  return path.join(targetDir, `.${tool}`);
}

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

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dirName = entry.name;

    if (dirName === 'hooks') {
      await installHooks(pkgDir, targetDir, tools, level);
      filesInstalled++;
      continue;
    }

    if (dirName === 'scripts') {
      await installScripts(pkgDir);
      filesInstalled++;
      continue;
    }

    if (dirName === 'mcp') {
      await installMcp(pkgDir, targetDir, tools, level);
      filesInstalled++;
      continue;
    }

    const srcDir = path.join(pkgDir, dirName);
    const files = await fs.readdir(srcDir);

    for (const file of files) {
      const srcFile = path.join(srcDir, file);
      const stat = await fs.stat(srcFile);
      if (!stat.isFile()) continue;

      for (const tool of tools) {
        const contentDir = CONTENT_DIRS[dirName];
        if (!contentDir) continue;

        const toolRoot = getToolRoot(targetDir, level, tool);
        const isRule = dirName === 'rules' || dirName === '{rules}';
        const isMdFile = file.endsWith('.md');
        const needsMdcConvert = tool === 'cursor' && isRule && isMdFile;

        if (needsMdcConvert) {
          const content = await fs.readFile(srcFile, 'utf-8');
          const mdcContent = mdToMdc(content);
          const mdcFilename = mdFilenameToMdc(file);
          const dest = path.join(toolRoot, contentDir, mdcFilename);
          await fs.ensureDir(path.dirname(dest));
          await fs.writeFile(dest, mdcContent, 'utf-8');
        } else {
          const dest = path.join(toolRoot, contentDir, file);
          await fs.ensureDir(path.dirname(dest));
          await fs.copy(srcFile, dest);
        }
        filesInstalled++;
      }
    }
  }

  return filesInstalled;
}

async function installHooks(pkgDir, targetDir, tools, level) {
  const hooksDir = path.join(pkgDir, 'hooks');
  const files = await fs.readdir(hooksDir);

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const hooksConfig = await fs.readJson(path.join(hooksDir, file));

    for (const tool of tools) {
      if (tool !== 'claude') continue;
      const toolRoot = getToolRoot(targetDir, level, tool);
      const settingsPath = path.join(toolRoot, 'settings.json');
      await mergeSettings(settingsPath, hooksConfig);
    }
  }
}

async function installScripts(pkgDir) {
  const scriptsDir = path.join(pkgDir, 'scripts');
  const userScriptsDir = path.join(os.homedir(), '.claude', 'scripts');
  await fs.ensureDir(userScriptsDir);
  await fs.copy(scriptsDir, userScriptsDir, { overwrite: false });
}

async function installMcp(pkgDir, targetDir, tools, level) {
  const mcpDir = path.join(pkgDir, 'mcp');
  const files = await fs.readdir(mcpDir);

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const mcpConfig = await fs.readJson(path.join(mcpDir, file));

    for (const tool of tools) {
      if (tool !== 'cursor') continue;
      const toolRoot = getToolRoot(targetDir, level, tool);
      const mcpPath = path.join(toolRoot, 'mcp.json');
      await mergeMcpConfig(mcpPath, mcpConfig);
    }
  }
}
