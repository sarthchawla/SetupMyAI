import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import fs from 'fs-extra';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(__dirname, '../..');
const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.remove(root)));
});

describe('waza-evals CLI', () => {
  it('runs offline suites without passing model-backed options', async () => {
    const temporaryRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'setupmyai-waza-cli-')
    );
    temporaryRoots.push(temporaryRoot);
    const argumentLog = path.join(temporaryRoot, 'arguments.ndjson');
    const fakeWaza = path.join(temporaryRoot, 'fake-waza.mjs');
    const outputDirectory = path.join(temporaryRoot, 'results');

    await fs.writeFile(
      fakeWaza,
      [
        '#!/usr/bin/env node',
        "import fs from 'node:fs';",
        "if (process.argv[2] === '--version') {",
        "  console.log('waza version 0.38.3');",
        '}',
        'fs.appendFileSync(',
        '  process.env.WAZA_ARGUMENT_LOG,',
        "  `${JSON.stringify(process.argv.slice(2))}\\n`",
        ');',
      ].join('\n')
    );
    await fs.chmod(fakeWaza, 0o755);

    await execFileAsync(
      process.execPath,
      [
        path.join(REPOSITORY_ROOT, 'scripts', 'waza-evals.js'),
        'run',
        '--mode',
        'offline',
        '--waza',
        fakeWaza,
        '--output-dir',
        outputDirectory,
        '--concurrency',
        '1',
        '--task-workers',
        '1',
      ],
      {
        cwd: REPOSITORY_ROOT,
        env: {
          ...process.env,
          WAZA_ARGUMENT_LOG: argumentLog,
        },
      }
    );

    const invocations = (await fs.readFile(argumentLog, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(invocations.length, 16);
    assert.deepEqual(invocations[0], ['--version']);

    for (const args of invocations.slice(1)) {
      assert.deepEqual(args.slice(0, 2), ['--no-update-check', 'run']);
      assert.match(args[2], /\/mock\.eval\.yaml$/);
      assert.ok(!args.includes('--model'));
      assert.ok(!args.includes('--judge-model'));
    }
  });
});
