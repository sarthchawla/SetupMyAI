import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runSuites } from './runner.js';

describe('runSuites', () => {
  it('runs every suite with bounded concurrency and aggregates failures', async () => {
    const suites = [
      { skillName: 'one', relativeEvalPath: 'evals/one/eval.yaml' },
      { skillName: 'two', relativeEvalPath: 'evals/two/eval.yaml' },
      { skillName: 'three', relativeEvalPath: 'evals/three/eval.yaml' },
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
          outputPath: `${suite.skillName}.json`,
        };
      },
    });

    assert.deepEqual(started.sort(), ['one', 'three', 'two']);
    assert.equal(maxActive, 2);
    assert.deepEqual(summary, {
      total: 3,
      passed: 2,
      failed: 1,
      results: [
        { skillName: 'one', exitCode: 0, outputPath: 'one.json' },
        { skillName: 'two', exitCode: 1, outputPath: 'two.json' },
        { skillName: 'three', exitCode: 0, outputPath: 'three.json' },
      ],
    });
  });
});
