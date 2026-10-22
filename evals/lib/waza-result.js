import fs from 'fs-extra';

const COUNT_FIELDS = [
  'succeeded',
  'failed',
  'errors',
  'skipped',
];
const TASK_STATUS_FIELDS = {
  passed: 'succeeded',
  failed: 'failed',
  error: 'errors',
  skipped: 'skipped',
};

export async function readValidatedWazaResult(outputPath, suite) {
  let result;
  try {
    result = await fs.readJson(outputPath);
  } catch (error) {
    throw new Error(
      `${suite.skillName}: Waza output is missing or unreadable at ` +
        `${outputPath}: ${error instanceof Error ? error.message : error}`
    );
  }

  if (result.skill !== suite.skillName) {
    throw new Error(
      `${suite.skillName}: Waza output skill does not match the loaded suite`
    );
  }
  if (result.eval_name !== suite.evaluationName) {
    throw new Error(
      `${suite.skillName}: Waza output eval does not match the loaded suite`
    );
  }
  if (result.config?.engine_type !== suite.executor) {
    throw new Error(
      `${suite.skillName}: Waza output mode does not match ${suite.mode}`
    );
  }

  const total = result.summary?.total_tests;
  const expectedTotal = suite.tasks.length;
  if (!Number.isInteger(total) || total !== expectedTotal) {
    throw new Error(
      `${suite.skillName}: Waza output task count ${total} does not match ` +
        `${expectedTotal}`
    );
  }

  const taskSummary = { total };
  for (const field of COUNT_FIELDS) {
    const value = result.summary?.[field];
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(
        `${suite.skillName}: Waza output task counts are invalid`
      );
    }
    taskSummary[field] = value;
  }
  if (
    COUNT_FIELDS.reduce(
      (sum, field) => sum + taskSummary[field],
      0
    ) !== total
  ) {
    throw new Error(
      `${suite.skillName}: Waza output task counts do not total ${total}`
    );
  }

  const expectedTaskIds = suite.tasks.map((task) => task.id).sort();
  const tasks = Array.isArray(result.tasks) ? result.tasks : [];
  const actualTaskIds = tasks.map((task) => task?.test_id).sort();
  if (JSON.stringify(actualTaskIds) !== JSON.stringify(expectedTaskIds)) {
    throw new Error(
      `${suite.skillName}: Waza output task IDs do not match the loaded suite`
    );
  }

  const statusCounts = Object.fromEntries(
    COUNT_FIELDS.map((field) => [field, 0])
  );
  for (const task of tasks) {
    const summaryField = TASK_STATUS_FIELDS[task?.status];
    if (!summaryField) {
      throw new Error(
        `${suite.skillName}: Waza output task status must be ` +
          'passed, failed, error, or skipped'
      );
    }
    statusCounts[summaryField]++;
  }
  if (
    COUNT_FIELDS.some(
      (field) => statusCounts[field] !== taskSummary[field]
    )
  ) {
    throw new Error(
      `${suite.skillName}: Waza output task status counts do not match the summary`
    );
  }

  return taskSummary;
}
