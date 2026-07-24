#!/usr/bin/env node

import { execFile, spawn } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import fs from 'fs-extra';
import { loadEvaluationCoverage } from '../evals/lib/coverage.js';
import { parseWazaOptions } from '../evals/lib/options.js';
import { runSuites } from '../evals/lib/runner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(__dirname, '..');
const execFileAsync = promisify(execFile);
const PINNED_WAZA_VERSION = '0.38.3';

function outputFilename(skillName) {
  return `${skillName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`;
}

function executeWaza(waza, suite, outputDir, taskWorkers) {
  const outputPath = path.join(outputDir, outputFilename(suite.skillName));
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

  return new Promise((resolve, reject) => {
    console.log(`\n[Waza] ${suite.skillName}`);
    const child = spawn(waza, args, {
      cwd: REPOSITORY_ROOT,
      stdio: 'inherit',
    });

    child.once('error', reject);
    child.once('close', (exitCode) => {
      resolve({
        exitCode: exitCode ?? 2,
        outputPath,
      });
    });
  });
}

async function verifyWazaVersion(waza) {
  const { stdout } = await execFileAsync(waza, ['--version'], {
    cwd: REPOSITORY_ROOT,
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

async function main() {
  const options = parseWazaOptions(process.argv.slice(2), {
    repositoryRoot: REPOSITORY_ROOT,
  });
  if (options.command !== 'run') {
    throw new Error(`Unsupported command: ${options.command}`);
  }
  if (!options.waza) {
    throw new Error('run requires --waza /path/to/waza');
  }

  const wazaVersion = await verifyWazaVersion(options.waza);
  await fs.ensureDir(options.outputDir);
  const suites = await loadEvaluationCoverage(REPOSITORY_ROOT, {
    mode: options.mode,
  });
  const summary = await runSuites(suites, {
    concurrency: options.concurrency,
    execute: (suite) =>
      executeWaza(
        options.waza,
        suite,
        options.outputDir,
        options.taskWorkers
      ),
  });
  const report = {
    generatedAt: new Date().toISOString(),
    wazaVersion,
    mode: options.mode,
    ...summary,
  };

  await fs.writeJson(path.join(options.outputDir, 'summary.json'), report, {
    spaces: 2,
  });
  console.log(
    `\nWaza suites: ${summary.passed}/${summary.total} passed; ` +
      `${summary.failed} failed.`
  );

  process.exitCode = summary.failed === 0 ? 0 : 1;
}

await main();
