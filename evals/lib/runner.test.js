import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runSuites } from './runner.js';

describe('runSuites', () => {
  it('runs every suite with bounded concurrency and aggregates failures', async () => {
    const suites = [
      {
        skillName: 'one',
        relativeEvalPath: 'evals/one/eval.yaml',
        tasks: [{ id: 'one-a' }, { id: 'one-b' }],
      },
      {
        skillName: 'two',
        relativeEvalPath: 'evals/two/eval.yaml',
        tasks: [{ id: 'two-a' }, { id: 'two-b' }],
      },
      {
        skillName: 'three',
        relativeEvalPath: 'evals/three/eval.yaml',
        tasks: [{ id: 'three-a' }, { id: 'three-b' }],
      },
    ];
    const started = [];
    let active = 0;
    let maxActive = 0;

    const summary = await runSuites(suites, {
      concurrency: 2,
      execute: async (suite) => {
        started.push(suite.skillName);
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        return {
          exitCode: suite.skillName === 'two' ? 1 : 0,
          passed: suite.skillName !== 'two',
          outputPath: `${suite.skillName}.json`,
          taskSummary: {
            total: 2,
            succeeded: suite.skillName === 'two' ? 1 : 2,
            failed: suite.skillName === 'two' ? 1 : 0,
            errors: 0,
            skipped: 0,
          },
        };
      },
    });

    assert.deepEqual(started.sort(), ['one', 'three', 'two']);
    assert.equal(maxActive, 2);
    assert.deepEqual(summary, {
      total: 3,
      passed: 2,
      failed: 1,
      artifactErrors: 0,
      expectedTasks: 6,
      tasks: {
        total: 6,
        succeeded: 5,
        failed: 1,
        errors: 0,
        skipped: 0,
      },
      results: [
        {
          skillName: 'one',
          exitCode: 0,
          passed: true,
          outputPath: 'one.json',
          taskSummary: {
            total: 2,
            succeeded: 2,
            failed: 0,
            errors: 0,
            skipped: 0,
          },
        },
        {
          skillName: 'two',
          exitCode: 1,
          passed: false,
          outputPath: 'two.json',
          taskSummary: {
            total: 2,
            succeeded: 1,
            failed: 1,
            errors: 0,
            skipped: 0,
          },
        },
        {
          skillName: 'three',
          exitCode: 0,
          passed: true,
          outputPath: 'three.json',
          taskSummary: {
            total: 2,
            succeeded: 2,
            failed: 0,
            errors: 0,
            skipped: 0,
          },
        },
      ],
    });
  });

  it('does not treat exit code zero as a pass without validated output', async () => {
    const summary = await runSuites(
      [
        {
          skillName: 'missing-artifact',
          tasks: [{ id: 'missing-a' }, { id: 'missing-b' }],
        },
      ],
      {
        execute: async () => ({
          exitCode: 0,
          outputPath: 'missing.json',
        }),
      }
    );

    assert.equal(summary.passed, 0);
    assert.equal(summary.failed, 1);
    assert.equal(summary.artifactErrors, 1);
    assert.equal(summary.expectedTasks, 2);
    assert.deepEqual(summary.tasks, {
      total: 0,
      succeeded: 0,
      failed: 0,
      errors: 0,
      skipped: 0,
    });
  });
});
