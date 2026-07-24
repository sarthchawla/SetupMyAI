import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import fs from 'fs-extra';
import {
  outputFilenameForSuite,
  runWazaEvals,
} from '../../scripts/waza-evals.js';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(__dirname, '../..');
const temporaryRoots = [];
const RESULT_MANIFEST_NAME = '.waza-results-manifest.json';

function resultManifest(artifacts) {
  return {
    owner: '@setupmyai/cli:waza-results',
    version: 1,
    summary: 'summary.json',
    artifacts,
  };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.remove(root)));
});

describe('waza-evals CLI', () => {
  it('uses collision-safe deterministic result filenames', () => {
    const first = outputFilenameForSuite({
      skillName: 'demo/skill',
      relativeEvalPath: 'evals/one/demo-skill/mock.eval.yaml',
    });
    const second = outputFilenameForSuite({
      skillName: 'demo-skill',
      relativeEvalPath: 'evals/two/demo-skill/mock.eval.yaml',
    });

    assert.match(first, /^demo-skill--[a-f0-9]{12}\.json$/);
    assert.match(second, /^demo-skill--[a-f0-9]{12}\.json$/);
    assert.notEqual(first, second);
    assert.equal(
      first,
      outputFilenameForSuite({
        skillName: 'demo/skill',
        relativeEvalPath: 'evals/one/demo-skill/mock.eval.yaml',
      })
    );
  });

  it('defaults to offline suites without passing model-backed options', async () => {
    const temporaryRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'setupmyai-waza-cli-')
    );
    temporaryRoots.push(temporaryRoot);
    const argumentLog = path.join(temporaryRoot, 'arguments.ndjson');
    const environmentLog = path.join(temporaryRoot, 'environment.ndjson');
    const fakeWaza = path.join(temporaryRoot, 'fake-waza.mjs');
    const outputDirectory = path.join(temporaryRoot, 'results');

    await fs.writeFile(
      fakeWaza,
      [
        '#!/usr/bin/env node',
        "import fs from 'node:fs';",
        "import path from 'node:path';",
        `const argumentLog = ${JSON.stringify(argumentLog)};`,
        `const environmentLog = ${JSON.stringify(environmentLog)};`,
        'const args = process.argv.slice(2);',
        'fs.appendFileSync(argumentLog, `${JSON.stringify(args)}\\n`);',
        'fs.appendFileSync(environmentLog, `${JSON.stringify({',
        '  home: process.env.HOME,',
        '  xdgConfigHome: process.env.XDG_CONFIG_HOME,',
        '  xdgCacheHome: process.env.XDG_CACHE_HOME,',
        '  xdgDataHome: process.env.XDG_DATA_HOME,',
        '})}\\n`);',
        "if (process.argv[2] === '--version') {",
        "  console.log('waza version 0.38.3');",
        '  process.exit(0);',
        '}',
        'const evalPath = path.resolve(args[2]);',
        "const outputPath = args[args.indexOf('--output') + 1];",
        'const evalDirectory = path.dirname(evalPath);',
        'const evalText = fs.readFileSync(evalPath, "utf8");',
        'const evaluationName = evalText.match(/^name:\\s*(.+)$/m)[1];',
        "const taskDirectory = path.join(evalDirectory, 'mock-tasks');",
        'const taskIds = fs.readdirSync(taskDirectory)',
        "  .filter((name) => name.endsWith('.yaml'))",
        '  .map((name) =>',
        '    fs.readFileSync(path.join(taskDirectory, name), "utf8")',
        '      .match(/^id:\\s*(.+)$/m)[1]',
        ');',
        'fs.writeFileSync(outputPath, JSON.stringify({',
        '  skill: path.basename(evalDirectory),',
        '  eval_name: evaluationName,',
        "  config: { engine_type: 'mock' },",
        '  summary: {',
        '    total_tests: taskIds.length,',
        '    succeeded: taskIds.length,',
        '    failed: 0, errors: 0, skipped: 0,',
        '  },',
        "  tasks: taskIds.map((test_id) => ({ test_id, status: 'passed' })),",
        '}));',
      ].join('\n')
    );
    await fs.chmod(fakeWaza, 0o755);

    const result = await runWazaEvals(
      [
        'run',
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
        repositoryRoot: REPOSITORY_ROOT,
        verifyBinaryChecksum: async () => ({
          version: '0.38.3',
          asset: 'test-only-fake-waza',
          checksum: 'test-only',
        }),
      }
    );
    assert.equal(result.exitCode, 0);

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

    const environments = (await fs.readFile(environmentLog, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(environments.length, 16);
    for (const environment of environments) {
      assert.notEqual(environment.home, os.homedir());
      assert.match(environment.home, /setupmyai-waza-home-/);
      assert.equal(
        environment.xdgConfigHome,
        path.join(environment.home, '.config')
      );
      assert.equal(
        environment.xdgCacheHome,
        path.join(environment.home, '.cache')
      );
      assert.equal(
        environment.xdgDataHome,
        path.join(environment.home, '.local', 'share')
      );
    }
    assert.equal(await fs.pathExists(environments[0].home), false);

    const summary = await fs.readJson(
      path.join(outputDirectory, 'summary.json')
    );
    assert.equal(summary.mode, 'offline');
    assert.equal(summary.modelTransmissionAcknowledged, false);
    assert.deepEqual(summary.tasks, {
      total: 60,
      succeeded: 60,
      failed: 0,
      errors: 0,
      skipped: 0,
    });
    const manifest = await fs.readJson(
      path.join(outputDirectory, RESULT_MANIFEST_NAME)
    );
    assert.equal(manifest.owner, '@setupmyai/cli:waza-results');
    assert.equal(manifest.version, 1);
    assert.equal(manifest.summary, 'summary.json');
    assert.equal(manifest.artifacts.length, 15);
    assert.equal(new Set(manifest.artifacts).size, 15);
  });

  it('removes stale artifacts and fails closed when Waza writes no result', async () => {
    const temporaryRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'setupmyai-waza-stale-')
    );
    temporaryRoots.push(temporaryRoot);
    const fakeWaza = path.join(temporaryRoot, 'fake-waza.mjs');
    const outputDirectory = path.join(temporaryRoot, 'results');
    await fs.ensureDir(outputDirectory);

    await fs.writeFile(
      fakeWaza,
      [
        '#!/usr/bin/env node',
        "if (process.argv[2] === '--version') {",
        "  console.log('waza version 0.38.3');",
        '}',
      ].join('\n')
    );
    await fs.chmod(fakeWaza, 0o755);

    const stalePath = path.join(
      outputDirectory,
      outputFilenameForSuite({
        skillName: 'better-auth-best-practices',
        relativeEvalPath:
          'evals/auth-security/better-auth-best-practices/mock.eval.yaml',
      })
    );
    await fs.writeJson(stalePath, {
      skill: 'better-auth-best-practices',
      eval_name: 'better-auth-best-practices-offline-eval',
      config: { engine_type: 'mock' },
      summary: {
        total_tests: 4,
        succeeded: 4,
        failed: 0,
        errors: 0,
        skipped: 0,
      },
      tasks: [],
    });
    await fs.writeJson(
      path.join(outputDirectory, RESULT_MANIFEST_NAME),
      resultManifest([path.basename(stalePath)])
    );

    const result = await runWazaEvals(
      [
        'run',
        '--waza',
        fakeWaza,
        '--output-dir',
        outputDirectory,
        '--concurrency',
        '4',
      ],
      {
        repositoryRoot: REPOSITORY_ROOT,
        verifyBinaryChecksum: async () => ({
          version: '0.38.3',
          asset: 'test-only-fake-waza',
          checksum: 'test-only',
        }),
      }
    );

    assert.equal(result.exitCode, 1);
    assert.equal(result.report.passed, 0);
    assert.equal(result.report.failed, 15);
    assert.equal(result.report.artifactErrors, 15);
    assert.equal(await fs.pathExists(stalePath), false);
  });

  it('rejects a checksum mismatch before executing the supplied binary', async () => {
    const temporaryRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'setupmyai-waza-tampered-')
    );
    temporaryRoots.push(temporaryRoot);
    const executionMarker = path.join(temporaryRoot, 'executed');
    const fakeWaza = path.join(temporaryRoot, 'waza');

    await fs.writeFile(
      fakeWaza,
      [
        '#!/usr/bin/env node',
        "import fs from 'node:fs';",
        `fs.writeFileSync(${JSON.stringify(executionMarker)}, 'executed');`,
        "console.log('waza version 0.38.3');",
      ].join('\n')
    );
    await fs.chmod(fakeWaza, 0o755);

    await assert.rejects(
      execFileAsync(
        process.execPath,
        [
          path.join(REPOSITORY_ROOT, 'scripts', 'waza-evals.js'),
          'run',
          '--waza',
          fakeWaza,
          '--output-dir',
          path.join(temporaryRoot, 'results'),
        ],
        { cwd: REPOSITORY_ROOT }
      ),
      (error) => {
        assert.match(error.stderr, /checksum mismatch/);
        return true;
      }
    );
    assert.equal(await fs.pathExists(executionMarker), false);
  });

  it('clears prior runner-owned artifacts before integrity preflight', async () => {
    const temporaryRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'setupmyai-waza-preflight-')
    );
    temporaryRoots.push(temporaryRoot);
    const outputDirectory = path.join(temporaryRoot, 'results');
    const obsoleteResult = 'retired-skill--0123456789ab.json';
    await fs.ensureDir(outputDirectory);
    await fs.writeJson(path.join(outputDirectory, 'summary.json'), {
      passed: 15,
      failed: 0,
    });
    await fs.writeJson(path.join(outputDirectory, obsoleteResult), {
      stale: true,
    });
    await fs.writeJson(
      path.join(outputDirectory, RESULT_MANIFEST_NAME),
      resultManifest([obsoleteResult])
    );

    await assert.rejects(
      runWazaEvals(
        [
          'run',
          '--waza',
          path.join(temporaryRoot, 'missing-waza'),
          '--output-dir',
          outputDirectory,
        ],
        {
          repositoryRoot: REPOSITORY_ROOT,
          verifyBinaryChecksum: async () => {
            throw new Error('checksum mismatch');
          },
        }
      ),
      /checksum mismatch/
    );

    assert.equal(
      await fs.pathExists(path.join(outputDirectory, 'summary.json')),
      false
    );
    assert.equal(
      await fs.pathExists(path.join(outputDirectory, obsoleteResult)),
      false
    );
    assert.equal(
      await fs.pathExists(
        path.join(outputDirectory, RESULT_MANIFEST_NAME)
      ),
      false
    );
  });

  it('preserves an unrelated summary in an unowned output directory', async () => {
    const temporaryRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'setupmyai-waza-unowned-')
    );
    temporaryRoots.push(temporaryRoot);
    const outputDirectory = path.join(temporaryRoot, 'reports');
    const summaryPath = path.join(outputDirectory, 'summary.json');
    const unrelatedSummary = {
      owner: 'another-tool',
      result: 'keep this',
    };
    await fs.outputJson(summaryPath, unrelatedSummary);
    let checksumCalled = false;

    await assert.rejects(
      runWazaEvals(
        [
          'run',
          '--waza',
          path.join(temporaryRoot, 'missing-waza'),
          '--output-dir',
          outputDirectory,
        ],
        {
          repositoryRoot: REPOSITORY_ROOT,
          verifyBinaryChecksum: async () => {
            checksumCalled = true;
            throw new Error('checksum should not run');
          },
        }
      ),
      /output directory is nonempty and is not owned/
    );

    assert.equal(checksumCalled, false);
    assert.deepEqual(await fs.readJson(summaryPath), unrelatedSummary);
    assert.deepEqual(await fs.readdir(outputDirectory), ['summary.json']);
  });

  it('rejects an invalid ownership manifest without mutation', async () => {
    const temporaryRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'setupmyai-waza-invalid-owner-')
    );
    temporaryRoots.push(temporaryRoot);
    const outputDirectory = path.join(temporaryRoot, 'results');
    const summaryPath = path.join(outputDirectory, 'summary.json');
    const manifestPath = path.join(
      outputDirectory,
      RESULT_MANIFEST_NAME
    );
    const unrelatedSummary = { result: 'keep this too' };
    const invalidManifest = {
      ...resultManifest([]),
      owner: 'another-tool',
    };
    await fs.outputJson(summaryPath, unrelatedSummary);
    await fs.writeJson(manifestPath, invalidManifest);
    let checksumCalled = false;

    await assert.rejects(
      runWazaEvals(
        [
          'run',
          '--waza',
          path.join(temporaryRoot, 'missing-waza'),
          '--output-dir',
          outputDirectory,
        ],
        {
          repositoryRoot: REPOSITORY_ROOT,
          verifyBinaryChecksum: async () => {
            checksumCalled = true;
            throw new Error('checksum should not run');
          },
        }
      ),
      /ownership manifest is invalid/
    );

    assert.equal(checksumCalled, false);
    assert.deepEqual(await fs.readJson(summaryPath), unrelatedSummary);
    assert.deepEqual(await fs.readJson(manifestPath), invalidManifest);
  });

  it('rejects traversal in an owned manifest without mutation', async () => {
    const temporaryRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'setupmyai-waza-traversal-')
    );
    temporaryRoots.push(temporaryRoot);
    const outputDirectory = path.join(temporaryRoot, 'results');
    const summaryPath = path.join(outputDirectory, 'summary.json');
    const artifactName = 'owned-skill--0123456789ab.json';
    const artifactPath = path.join(outputDirectory, artifactName);
    const outsidePath = path.join(temporaryRoot, 'victim.json');
    const manifestPath = path.join(
      outputDirectory,
      RESULT_MANIFEST_NAME
    );
    const manifest = resultManifest([
      artifactName,
      '../victim.json',
    ]);
    await fs.outputJson(summaryPath, { result: 'preserve' });
    await fs.writeJson(artifactPath, { result: 'preserve artifact' });
    await fs.writeJson(outsidePath, { result: 'preserve outside' });
    await fs.writeJson(manifestPath, manifest);
    let checksumCalled = false;

    await assert.rejects(
      runWazaEvals(
        [
          'run',
          '--waza',
          path.join(temporaryRoot, 'missing-waza'),
          '--output-dir',
          outputDirectory,
        ],
        {
          repositoryRoot: REPOSITORY_ROOT,
          verifyBinaryChecksum: async () => {
            checksumCalled = true;
            throw new Error('checksum should not run');
          },
        }
      ),
      /ownership manifest is invalid/
    );

    assert.equal(checksumCalled, false);
    assert.deepEqual(await fs.readJson(summaryPath), {
      result: 'preserve',
    });
    assert.deepEqual(await fs.readJson(artifactPath), {
      result: 'preserve artifact',
    });
    assert.deepEqual(await fs.readJson(outsidePath), {
      result: 'preserve outside',
    });
    assert.deepEqual(await fs.readJson(manifestPath), manifest);
  });

  it('rejects a declared artifact directory without recursive deletion', async () => {
    const temporaryRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'setupmyai-waza-artifact-directory-')
    );
    temporaryRoots.push(temporaryRoot);
    const outputDirectory = path.join(temporaryRoot, 'results');
    const summaryPath = path.join(outputDirectory, 'summary.json');
    const artifactName = 'owned-skill--0123456789ab.json';
    const artifactDirectory = path.join(outputDirectory, artifactName);
    const sentinelPath = path.join(artifactDirectory, 'sentinel.txt');
    const manifestPath = path.join(
      outputDirectory,
      RESULT_MANIFEST_NAME
    );
    const manifest = resultManifest([artifactName]);
    await fs.outputJson(summaryPath, { result: 'preserve' });
    await fs.outputFile(sentinelPath, 'do not recursively delete');
    await fs.writeJson(manifestPath, manifest);

    await assert.rejects(
      runWazaEvals(
        [
          'run',
          '--waza',
          path.join(temporaryRoot, 'missing-waza'),
          '--output-dir',
          outputDirectory,
        ],
        {
          repositoryRoot: REPOSITORY_ROOT,
          verifyBinaryChecksum: async () => {
            throw new Error('checksum should not run');
          },
        }
      ),
      /owned entry must be a regular file/
    );

    assert.equal(
      await fs.readFile(sentinelPath, 'utf8'),
      'do not recursively delete'
    );
    assert.deepEqual(await fs.readJson(summaryPath), {
      result: 'preserve',
    });
    assert.deepEqual(await fs.readJson(manifestPath), manifest);
  });

  it('rejects unlisted entries in an otherwise valid owned directory', async () => {
    const temporaryRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'setupmyai-waza-extra-output-')
    );
    temporaryRoots.push(temporaryRoot);
    const outputDirectory = path.join(temporaryRoot, 'results');
    const summaryPath = path.join(outputDirectory, 'summary.json');
    const unrelatedPath = path.join(outputDirectory, 'notes.txt');
    const manifestPath = path.join(
      outputDirectory,
      RESULT_MANIFEST_NAME
    );
    await fs.outputJson(summaryPath, { passed: 15 });
    await fs.writeFile(unrelatedPath, 'do not remove');
    await fs.writeJson(manifestPath, resultManifest([]));

    await assert.rejects(
      runWazaEvals(
        [
          'run',
          '--waza',
          path.join(temporaryRoot, 'missing-waza'),
          '--output-dir',
          outputDirectory,
        ],
        {
          repositoryRoot: REPOSITORY_ROOT,
          verifyBinaryChecksum: async () => {
            throw new Error('checksum should not run');
          },
        }
      ),
      /contains unowned entries: notes\.txt/
    );

    assert.equal(await fs.readFile(unrelatedPath, 'utf8'), 'do not remove');
    assert.deepEqual(await fs.readJson(summaryPath), { passed: 15 });
    assert.deepEqual(
      await fs.readJson(manifestPath),
      resultManifest([])
    );
  });

  it('fails closed on acknowledged model mode until host isolation exists', async () => {
    const temporaryRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'setupmyai-waza-model-disabled-')
    );
    temporaryRoots.push(temporaryRoot);
    const executionMarker = path.join(temporaryRoot, 'executed');
    const fakeWaza = path.join(temporaryRoot, 'fake-waza.mjs');

    await fs.writeFile(
      fakeWaza,
      [
        '#!/usr/bin/env node',
        "import fs from 'node:fs';",
        `fs.writeFileSync(${JSON.stringify(executionMarker)}, 'executed');`,
        "console.log('waza version 0.38.3');",
      ].join('\n')
    );
    await fs.chmod(fakeWaza, 0o755);

    await assert.rejects(
      runWazaEvals(
        [
          'run',
          '--mode',
          'model',
          '--acknowledge-model-transmission',
          '--waza',
          fakeWaza,
        ],
        {
          repositoryRoot: REPOSITORY_ROOT,
          verifyBinaryChecksum: async () => ({
            version: '0.38.3',
            asset: 'test-only-fake-waza',
            checksum: 'test-only',
          }),
        }
      ),
      /disabled until Waza host isolation is proven/
    );
    assert.equal(await fs.pathExists(executionMarker), false);
  });

  it('exposes explicit offline and model package scripts', async () => {
    const packageJson = await fs.readJson(
      path.join(REPOSITORY_ROOT, 'package.json')
    );

    assert.match(packageJson.scripts['eval:run:offline'], /--mode offline$/);
    assert.match(packageJson.scripts['eval:run:model'], /--mode model$/);
    assert.ok(!packageJson.scripts['eval:run']);
  });
});
