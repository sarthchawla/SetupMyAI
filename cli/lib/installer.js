import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import { mdToMdc, mdFilenameToMdc } from './converter.js';
import { mergeSettings, mergeMcpConfig } from './merger.js';

const PACKAGES_ROOT = path.resolve(
  new URL('../../packages', import.meta.url).pathname
);

// Maps package subdirectory names to their target locations
const DIR_MAPPINGS = {
  commands: { claude: '.claude/commands', cursor: '.cursor/commands' },
  rules: { claude: '.claude/rules', cursor: '.cursor/rules' },
  agents: { claude: '.claude/agents', cursor: '.cursor/agents' },
  skills: { claude: '.claude/skills', cursor: '.cursor/skills' },
  '{skills}': { claude: '.claude/skills', cursor: '.cursor/skills' },
  '{rules}': { claude: '.claude/rules', cursor: '.cursor/rules' },
};

/**
 * Install a single package into the target project directory.
 *
 * @param {string} packageName - Key from PACKAGES registry (e.g. 'universal')
 * @param {string} targetDir   - Absolute path to the user's project root
 * @param {object} options      - { tool: 'claude' | 'cursor' | 'all' }
 */
export async function installPackage(packageName, targetDir, options = {}) {
  const tool = options.tool || 'all';
  const pkgDir = path.join(PACKAGES_ROOT, packageName);

  if (!(await fs.pathExists(pkgDir))) {
    throw new Error(`Package "${packageName}" not found at ${pkgDir}`);
  }

  const entries = await fs.readdir(pkgDir, { withFileTypes: true });
  let filesInstalled = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dirName = entry.name;

    // Special case: hooks directory -> merge into settings.json
    if (dirName === 'hooks') {
      await installHooks(pkgDir, targetDir, tool);
      filesInstalled++;
      continue;
    }

    // Special case: scripts -> user-level ~/.claude/scripts/
    if (dirName === 'scripts') {
      await installScripts(pkgDir);
      filesInstalled++;
      continue;
    }

    // Special case: mcp -> merge into .cursor/mcp.json
    if (dirName === 'mcp') {
      await installMcp(pkgDir, targetDir);
      filesInstalled++;
      continue;
    }

    const mapping = DIR_MAPPINGS[dirName];
    if (!mapping) continue;

    const srcDir = path.join(pkgDir, dirName);
    const files = await fs.readdir(srcDir);

    for (const file of files) {
      const srcFile = path.join(srcDir, file);
      const stat = await fs.stat(srcFile);
      if (!stat.isFile()) continue;

      // Install to Claude target
      if (tool === 'all' || tool === 'claude') {
        const claudeDest = path.join(targetDir, mapping.claude, file);
        await fs.ensureDir(path.dirname(claudeDest));
        await fs.copy(srcFile, claudeDest);
        filesInstalled++;
      }

      // Install to Cursor target (auto-convert .md rules to .mdc)
      if (tool === 'all' || tool === 'cursor') {
        const isRule = dirName === 'rules' || dirName === '{rules}';
        const isMdFile = file.endsWith('.md');

        if (isRule && isMdFile) {
          const content = await fs.readFile(srcFile, 'utf-8');
          const mdcContent = mdToMdc(content);
          const mdcFilename = mdFilenameToMdc(file);
          const cursorDest = path.join(targetDir, mapping.cursor, mdcFilename);
          await fs.ensureDir(path.dirname(cursorDest));
          await fs.writeFile(cursorDest, mdcContent, 'utf-8');
        } else {
          const cursorDest = path.join(targetDir, mapping.cursor, file);
          await fs.ensureDir(path.dirname(cursorDest));
          await fs.copy(srcFile, cursorDest);
        }
        filesInstalled++;
      }
    }
  }

  return filesInstalled;
}

async function installHooks(pkgDir, targetDir, tool) {
  const hooksDir = path.join(pkgDir, 'hooks');
  const files = await fs.readdir(hooksDir);

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const hooksConfig = await fs.readJson(path.join(hooksDir, file));

    if (tool === 'all' || tool === 'claude') {
      const settingsPath = path.join(targetDir, '.claude', 'settings.json');
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

async function installMcp(pkgDir, targetDir) {
  const mcpDir = path.join(pkgDir, 'mcp');
  const files = await fs.readdir(mcpDir);

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const mcpConfig = await fs.readJson(path.join(mcpDir, file));
    const mcpPath = path.join(targetDir, '.cursor', 'mcp.json');
    await mergeMcpConfig(mcpPath, mcpConfig);
  }
}
