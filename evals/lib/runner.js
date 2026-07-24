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

  return {
    total: results.length,
    passed: results.filter((result) => result.exitCode === 0).length,
    failed: results.filter((result) => result.exitCode !== 0).length,
    results,
  };
}
