import { execFile } from 'node:child_process';
import { spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import fs from 'fs-extra';
import path from 'path';

const execFileAsync = promisify(execFile);
const REGISTRY_URL = 'https://registry.npmjs.org/@setupmyai%2fcli';
const SETUP_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);

  for (let index = 0; index < 3; index++) {
    const diff = left.core[index] - right.core[index];
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }

  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0;
  if (left.prerelease.length === 0) return 1;
  if (right.prerelease.length === 0) return -1;

  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index++) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;

    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) {
      return Number(leftPart) > Number(rightPart) ? 1 : -1;
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart > rightPart ? 1 : -1;
  }
  return 0;
}

function parseVersion(value) {
  const match = String(value || '0').match(
    /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/
  );
  if (!match) {
    throw new TypeError(`Invalid version: ${value}`);
  }
  return {
    core: [
      Number(match[1]),
      Number(match[2] || 0),
      Number(match[3] || 0),
    ],
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

export async function getCliVersion() {
  const packageJson = await fs.readJson(path.join(SETUP_ROOT, 'package.json'));
  return packageJson.version;
}

export async function getLatestCliVersion(fetchImpl = globalThis.fetch) {
  if (!fetchImpl) {
    throw new Error('fetch is not available in this Node.js runtime');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);

  try {
    const response = await fetchImpl(REGISTRY_URL, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`npm registry returned ${response.status}`);
    }
    const payload = await response.json();
    return payload?.['dist-tags']?.latest || null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getCliUpdateStatus(fetchImpl) {
  const current = await getCliVersion();

  try {
    const latest = await getLatestCliVersion(fetchImpl);
    return {
      current,
      latest,
      updateAvailable: Boolean(latest && compareVersions(latest, current) > 0),
      error: null,
    };
  } catch (err) {
    return {
      current,
      latest: null,
      updateAvailable: false,
      error: err.message,
    };
  }
}

export async function resolveSelfUpdateCommand(commandExistsImpl = commandExists) {
  if (await commandExistsImpl('pnpm')) {
    return { command: 'pnpm', args: ['add', '-g', '@setupmyai/cli@latest'] };
  }
  if (await commandExistsImpl('npm')) {
    return { command: 'npm', args: ['install', '-g', '@setupmyai/cli@latest'] };
  }
  throw new Error('Neither pnpm nor npm is available to update @setupmyai/cli globally.');
}

export async function runSelfUpdate(options = {}) {
  const command = options.command || await resolveSelfUpdateCommand();
  const spawnImpl = options.spawnImpl || spawnAsync;
  await spawnImpl(command.command, command.args);
  return command;
}

async function commandExists(command) {
  try {
    await execFileAsync(command, ['--version']);
    return true;
  } catch {
    return false;
  }
}

function spawnAsync(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });
  });
}
