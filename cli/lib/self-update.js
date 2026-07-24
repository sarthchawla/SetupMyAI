import { execFile } from 'node:child_process';
import { spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'fs-extra';
import path from 'path';

const execFileAsync = promisify(execFile);
const REGISTRY_URL = 'https://registry.npmjs.org/@setupmyai%2fcli';
const SETUP_ROOT = path.resolve(new URL('../..', import.meta.url).pathname);

export function compareVersions(a, b) {
  const left = String(a || '0').split('.').map((part) => Number.parseInt(part, 10) || 0);
  const right = String(b || '0').split('.').map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index++) {
    const diff = (left[index] || 0) - (right[index] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }

  return 0;
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

export async function resolveSelfUpdateCommand() {
  if (await commandExists('pnpm')) {
    return { command: 'pnpm', args: ['add', '-g', '@setupmyai/cli@latest'] };
  }
  if (await commandExists('npm')) {
    return { command: 'npm', args: ['install', '-g', '@setupmyai/cli@latest'] };
  }
  throw new Error('Neither pnpm nor npm is available to update @setupmyai/cli globally.');
}

export async function runSelfUpdate() {
  const command = await resolveSelfUpdateCommand();
  await spawnAsync(command.command, command.args);
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
