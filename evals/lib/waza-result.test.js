import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import { readValidatedWazaResult } from './waza-result.js';

const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.remove(root)));
});

async function createResultFile(overrides = {}) {
  const temporaryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'setupmyai-waza-result-')
  );
  temporaryRoots.push(temporaryRoot);
  const outputPath = path.join(temporaryRoot, 'result.json');
  const result = {
    skill: 'demo-skill',
    eval_name: 'demo-skill-offline-eval',
    config: {
      engine_type: 'mock',
    },
    summary: {
      total_tests: 2,
      succeeded: 1,
      failed: 1,
      errors: 0,
      skipped: 0,
    },
    tasks: [
      { test_id: 'demo-positive', status: 'passed' },
      { test_id: 'demo-negative', status: 'failed' },
    ],
    ...overrides,
  };
  await fs.writeJson(outputPath, result);
  return outputPath;
}

const suite = {
  skillName: 'demo-skill',
  evaluationName: 'demo-skill-offline-eval',
  mode: 'offline',
  executor: 'mock',
  tasks: [{ id: 'demo-positive' }, { id: 'demo-negative' }],
};

describe('readValidatedWazaResult', () => {
  it('returns task counts from a matching parseable artifact', async () => {
    const outputPath = await createResultFile();

    assert.deepEqual(await readValidatedWazaResult(outputPath, suite), {
      total: 2,
      succeeded: 1,
      failed: 1,
      errors: 0,
      skipped: 0,
    });
  });

  it('rejects mismatched skill, eval, mode, and task identities', async () => {
    const mismatches = [
      { skill: 'other-skill' },
      { eval_name: 'other-eval' },
      { config: { engine_type: 'copilot-sdk' } },
      {
        tasks: [
          { test_id: 'demo-positive', status: 'passed' },
          { test_id: 'unexpected', status: 'failed' },
        ],
      },
      {
        summary: {
          total_tests: 3,
          succeeded: 3,
          failed: 0,
          errors: 0,
          skipped: 0,
        },
      },
    ];

    for (const mismatch of mismatches) {
      const outputPath = await createResultFile(mismatch);
      await assert.rejects(
        readValidatedWazaResult(outputPath, suite),
        /does not match|task count|task IDs/
      );
    }
  });

  it('rejects missing or unsupported task statuses', async () => {
    const invalidTaskLists = [
      [
        { test_id: 'demo-positive', status: 'passed' },
        { test_id: 'demo-negative' },
      ],
      [
        { test_id: 'demo-positive', status: 'passed' },
        { test_id: 'demo-negative', status: 'cancelled' },
      ],
    ];

    for (const tasks of invalidTaskLists) {
      const outputPath = await createResultFile({ tasks });
      await assert.rejects(
        readValidatedWazaResult(outputPath, suite),
        /task status/
      );
    }
  });

  it('rejects task-status counts that disagree with the summary', async () => {
    const outputPath = await createResultFile({
      tasks: [
        { test_id: 'demo-positive', status: 'passed' },
        { test_id: 'demo-negative', status: 'passed' },
      ],
    });

    await assert.rejects(
      readValidatedWazaResult(outputPath, suite),
      /task status counts do not match the summary/
    );
  });

  it('rejects a missing or non-JSON artifact', async () => {
    const temporaryRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'setupmyai-waza-result-')
    );
    temporaryRoots.push(temporaryRoot);
    const missingPath = path.join(temporaryRoot, 'missing.json');
    await assert.rejects(
      readValidatedWazaResult(missingPath, suite),
      /missing or unreadable/
    );

    const invalidPath = path.join(temporaryRoot, 'invalid.json');
    await fs.writeFile(invalidPath, 'not JSON');
    await assert.rejects(
      readValidatedWazaResult(invalidPath, suite),
      /missing or unreadable/
    );
  });
});
