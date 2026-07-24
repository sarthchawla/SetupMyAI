export async function runSuites(
  suites,
  { concurrency = 2, execute }
) {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('concurrency must be a positive integer');
  }
  if (typeof execute !== 'function') {
    throw new Error('execute must be a function');
  }

  const results = new Array(suites.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < suites.length) {
      const index = nextIndex++;
      const suite = suites[index];

      try {
        const result = await execute(suite);
        results[index] = {
          skillName: suite.skillName,
          ...result,
        };
      } catch (error) {
        results[index] = {
          skillName: suite.skillName,
          exitCode: 2,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  }

  const workerCount = Math.min(concurrency, Math.max(suites.length, 1));
  await Promise.all(
    Array.from({ length: workerCount }, () => worker())
  );

  const taskTotals = results.reduce(
    (totals, result) => {
      const taskSummary = result.taskSummary;
      if (!taskSummary) return totals;

      for (const field of [
        'total',
        'succeeded',
        'failed',
        'errors',
        'skipped',
      ]) {
        totals[field] += taskSummary[field];
      }
      return totals;
    },
    {
      total: 0,
      succeeded: 0,
      failed: 0,
      errors: 0,
      skipped: 0,
    }
  );

  return {
    total: results.length,
    passed: results.filter((result) => result.passed === true).length,
    failed: results.filter((result) => result.passed !== true).length,
    artifactErrors: results.filter((result) => !result.taskSummary).length,
    expectedTasks: suites.reduce(
      (total, suite) => total + (suite.tasks?.length ?? 0),
      0
    ),
    tasks: taskTotals,
    results,
  };
}
