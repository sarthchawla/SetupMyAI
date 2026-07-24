#!/usr/bin/env node

import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import fs from 'fs-extra';
import { loadEvaluationCoverage } from '../evals/lib/coverage.js';
import { parseWazaOptions } from '../evals/lib/options.js';
import { runSuites } from '../evals/lib/runner.js';
import { verifyWazaBinaryChecksum } from '../evals/lib/waza-integrity.js';
import { readValidatedWazaResult } from '../evals/lib/waza-result.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(__dirname, '..');
const execFileAsync = promisify(execFile);
const PINNED_WAZA_VERSION = '0.38.3';
const RESULT_MANIFEST = '.waza-results-manifest.json';
const RESULT_MANIFEST_OWNER = '@setupmyai/cli:waza-results';
const RESULT_MANIFEST_VERSION = 1;
const RESULT_SUMMARY = 'summary.json';
const RESULT_FILENAME_PATTERN =
  /^[a-z0-9-]+--[a-f0-9]{12}\.json$/;

export function outputFilenameForSuite(suite) {
  const slug =
    suite.skillName.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'skill';
  const identity = createHash('sha256')
    .update(suite.relativeEvalPath)
    .digest('hex')
    .slice(0, 12);

  return `${slug}--${identity}.json`;
}

function validateResultManifest(manifest) {
  if (
    !manifest ||
    typeof manifest !== 'object' ||
    Array.isArray(manifest) ||
    JSON.stringify(Object.keys(manifest).sort()) !==
      JSON.stringify(['artifacts', 'owner', 'summary', 'version'])
  ) {
    return false;
  }
  if (
    manifest.owner !== RESULT_MANIFEST_OWNER ||
    manifest.version !== RESULT_MANIFEST_VERSION ||
    manifest.summary !== RESULT_SUMMARY ||
    !Array.isArray(manifest.artifacts)
  ) {
    return false;
  }
  if (new Set(manifest.artifacts).size !== manifest.artifacts.length) {
    return false;
  }

  return manifest.artifacts.every(
    (name) =>
      typeof name === 'string' &&
      path.basename(name) === name &&
      RESULT_FILENAME_PATTERN.test(name)
  );
}

async function unlinkOwnedFile(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}

async function prepareOutputDirectory(outputDir) {
  let outputStats;
  try {
    outputStats = await fs.lstat(outputDir);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    await fs.ensureDir(outputDir);
    return;
  }

  if (!outputStats.isDirectory()) {
    throw new Error('Waza output path must be a real directory');
  }

  const existingEntries = (await fs.readdir(outputDir)).sort();
  if (existingEntries.length === 0) {
    return;
  }

  const manifestPath = path.join(outputDir, RESULT_MANIFEST);
  if (!existingEntries.includes(RESULT_MANIFEST)) {
    throw new Error(
      'Waza output directory is nonempty and is not owned by this runner'
    );
  }

  const manifestStats = await fs.lstat(manifestPath);
  if (!manifestStats.isFile()) {
    throw new Error('Waza output ownership manifest is invalid');
  }

  let manifest;
  try {
    manifest = await fs.readJson(manifestPath);
  } catch (error) {
    throw new Error(
      `Waza output ownership manifest is invalid: ${error.message}`
    );
  }
  if (!validateResultManifest(manifest)) {
    throw new Error('Waza output ownership manifest is invalid');
  }

  const ownedEntries = new Set([
    RESULT_MANIFEST,
    manifest.summary,
    ...manifest.artifacts,
  ]);
  const unownedEntries = existingEntries.filter(
    (name) => !ownedEntries.has(name)
  );
  if (unownedEntries.length > 0) {
    throw new Error(
      'Waza output directory contains unowned entries: ' +
        unownedEntries.join(', ')
    );
  }

  for (const name of existingEntries) {
    const entryStats = await fs.lstat(path.join(outputDir, name));
    if (!entryStats.isFile()) {
      throw new Error(
        `Waza output owned entry must be a regular file: ${name}`
      );
    }
  }

  await Promise.all(
    [
      path.join(outputDir, manifest.summary),
      ...manifest.artifacts.map((name) => path.join(outputDir, name)),
    ].map(unlinkOwnedFile)
  );
  await unlinkOwnedFile(manifestPath);
}

async function createIsolatedOfflineEnvironment() {
  const home = await fs.mkdtemp(
    path.join(os.tmpdir(), 'setupmyai-waza-home-')
  );
  const environment = {};
  const passthroughVariables = [
    'PATH',
    'TMPDIR',
    'TMP',
    'TEMP',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'TERM',
    'NO_COLOR',
    'SYSTEMROOT',
    'WINDIR',
    'COMSPEC',
    'PATHEXT',
  ];

  for (const variable of passthroughVariables) {
    if (process.env[variable] !== undefined) {
      environment[variable] = process.env[variable];
    }
  }

  Object.assign(environment, {
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
    XDG_DATA_HOME: path.join(home, '.local', 'share'),
  });
  await Promise.all(
    [
      environment.XDG_CONFIG_HOME,
      environment.XDG_CACHE_HOME,
      environment.XDG_DATA_HOME,
    ].map((directory) => fs.ensureDir(directory))
  );

  return { environment, home };
}

async function executeWaza(
  waza,
  suite,
  outputDir,
  taskWorkers,
  repositoryRoot,
  environment
) {
  const outputPath = path.join(
    outputDir,
    outputFilenameForSuite(suite)
  );
  const args = [
    '--no-update-check',
    'run',
    suite.relativeEvalPath,
    '--parallel',
    '--workers',
    String(taskWorkers),
    '--output',
    outputPath,
  ];

  await unlinkOwnedFile(outputPath);
  const exitCode = await new Promise((resolve, reject) => {
    console.log(`\n[Waza] ${suite.skillName}`);
    const child = spawn(waza, args, {
      cwd: repositoryRoot,
      env: environment,
      stdio: 'inherit',
    });

    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? 2));
  });
  const taskSummary = await readValidatedWazaResult(outputPath, suite);

  return {
    exitCode,
    passed:
      exitCode === 0 &&
      taskSummary.succeeded === taskSummary.total &&
      taskSummary.failed === 0 &&
      taskSummary.errors === 0 &&
      taskSummary.skipped === 0,
    outputPath,
    taskSummary,
  };
}

async function verifyWazaVersion(waza, repositoryRoot, environment) {
  const { stdout } = await execFileAsync(waza, ['--version'], {
    cwd: repositoryRoot,
    env: environment,
  });
  const match = stdout.match(/\bwaza version ([0-9]+\.[0-9]+\.[0-9]+)\b/);
  if (!match) {
    throw new Error(`Unable to parse Waza version from: ${stdout.trim()}`);
  }
  if (match[1] !== PINNED_WAZA_VERSION) {
    throw new Error(
      `Waza ${PINNED_WAZA_VERSION} is required; received ${match[1]}`
    );
  }
  return match[1];
}

export async function runWazaEvals(
  args,
  {
    repositoryRoot = REPOSITORY_ROOT,
    verifyBinaryChecksum = verifyWazaBinaryChecksum,
  } = {}
) {
  const options = parseWazaOptions(args, {
    repositoryRoot,
  });
  if (options.command !== 'run') {
    throw new Error(`Unsupported command: ${options.command}`);
  }
  if (!options.waza) {
    throw new Error('run requires --waza /path/to/waza');
  }
  if (options.mode === 'model') {
    throw new Error(
      'Model-backed execution is disabled until Waza host isolation is proven'
    );
  }

  await prepareOutputDirectory(options.outputDir);

  const integrity = await verifyBinaryChecksum(
    options.waza,
    path.join(repositoryRoot, 'evals', 'waza.lock.yaml')
  );
  if (integrity.version !== PINNED_WAZA_VERSION) {
    throw new Error(
      `waza.lock.yaml must pin Waza ${PINNED_WAZA_VERSION}; ` +
        `received ${integrity.version}`
    );
  }

  const isolated = await createIsolatedOfflineEnvironment();
  try {
    const wazaVersion = await verifyWazaVersion(
      options.waza,
      repositoryRoot,
      isolated.environment
    );
    const suites = await loadEvaluationCoverage(repositoryRoot, {
      mode: options.mode,
    });
    const resultManifest = {
      owner: RESULT_MANIFEST_OWNER,
      version: RESULT_MANIFEST_VERSION,
      summary: RESULT_SUMMARY,
      artifacts: suites.map(outputFilenameForSuite),
    };
    if (!validateResultManifest(resultManifest)) {
      throw new Error('Generated Waza result manifest is invalid');
    }
    await fs.writeJson(
      path.join(options.outputDir, RESULT_MANIFEST),
      resultManifest,
      { spaces: 2 }
    );
    const summary = await runSuites(suites, {
      concurrency: options.concurrency,
      execute: (suite) =>
        executeWaza(
          options.waza,
          suite,
          options.outputDir,
          options.taskWorkers,
          repositoryRoot,
          isolated.environment
        ),
    });
    const report = {
      generatedAt: new Date().toISOString(),
      wazaVersion,
      wazaAsset: integrity.asset,
      wazaChecksum: integrity.checksum,
      mode: options.mode,
      modelTransmissionAcknowledged:
        options.modelTransmissionAcknowledged,
      ...summary,
    };

    await fs.writeJson(
      path.join(options.outputDir, RESULT_SUMMARY),
      report,
      {
        spaces: 2,
      }
    );
    console.log(
      `\nWaza suites: ${summary.passed}/${summary.total} passed; ` +
        `${summary.failed} failed. Tasks: ` +
        `${summary.tasks.succeeded}/${summary.tasks.total} succeeded; ` +
        `${summary.tasks.errors} errors.`
    );

    return {
      exitCode: summary.failed === 0 ? 0 : 1,
      report,
    };
  } finally {
    await fs.remove(isolated.home);
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = await runWazaEvals(process.argv.slice(2));
  process.exitCode = result.exitCode;
}
