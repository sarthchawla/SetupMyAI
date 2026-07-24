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

export function outputFilenameForSuite(suite) {
  const slug =
    suite.skillName.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'skill';
  const identity = createHash('sha256')
    .update(suite.relativeEvalPath)
    .digest('hex')
    .slice(0, 12);

  return `${slug}--${identity}.json`;
}

async function clearPreviousRunArtifacts(outputDir) {
  const manifestPath = path.join(outputDir, RESULT_MANIFEST);
  let artifactNames = [];

  try {
    const manifest = await fs.readJson(manifestPath);
    if (Array.isArray(manifest.artifacts)) {
      artifactNames = manifest.artifacts.filter(
        (name) =>
          typeof name === 'string' &&
          path.basename(name) === name &&
          /^[a-z0-9-]+--[a-f0-9]{12}\.json$/.test(name)
      );
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(
        `Ignoring unreadable prior Waza result manifest: ${error.message}`
      );
    }
  }

  await Promise.all(
    [
      path.join(outputDir, 'summary.json'),
      manifestPath,
      ...artifactNames.map((name) => path.join(outputDir, name)),
    ].map((artifactPath) => fs.remove(artifactPath))
  );
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

  await fs.remove(outputPath);
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

  await fs.ensureDir(options.outputDir);
  await clearPreviousRunArtifacts(options.outputDir);

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
    await fs.writeJson(
      path.join(options.outputDir, RESULT_MANIFEST),
      {
        artifacts: suites.map(outputFilenameForSuite),
      },
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
      path.join(options.outputDir, 'summary.json'),
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
