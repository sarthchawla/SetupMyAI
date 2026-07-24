import fs from 'node:fs';
import path from 'node:path';
import { globSync } from 'glob';
import YAML from 'yaml';

function loadYaml(filePath) {
  return YAML.parse(fs.readFileSync(filePath, 'utf8'));
}

export async function loadEvaluationCoverage(
  repositoryRoot,
  { mode = 'model' } = {}
) {
  if (mode !== 'model' && mode !== 'offline') {
    throw new Error('mode must be "model" or "offline"');
  }

  const evalFilename = mode === 'offline' ? 'mock.eval.yaml' : 'eval.yaml';
  const evalPaths = globSync(`evals/*/*/${evalFilename}`, {
    cwd: repositoryRoot,
    nodir: true,
  }).sort();
  const suites = [];

  for (const relativeEvalPath of evalPaths) {
    const absoluteEvalPath = path.join(repositoryRoot, relativeEvalPath);
    const evaluation = loadYaml(absoluteEvalPath);
    if (mode === 'offline') {
      if (evaluation.config?.executor !== 'mock') {
        throw new Error(
          `${relativeEvalPath}: offline suite executor must be "mock"`
        );
      }
      if (evaluation.config?.inject_skill_body !== false) {
        throw new Error(
          `${relativeEvalPath}: offline suite must disable skill-body injection`
        );
      }
      if (evaluation.config?.model !== 'offline-mock') {
        throw new Error(
          `${relativeEvalPath}: offline suite model must be "offline-mock"`
        );
      }
      if (Object.hasOwn(evaluation.config || {}, 'judge_model')) {
        throw new Error(
          `${relativeEvalPath}: offline suite must not configure a model`
        );
      }
      if (Object.hasOwn(evaluation, 'hooks')) {
        throw new Error(
          `${relativeEvalPath}: offline suite must not configure hooks`
        );
      }
      for (const forbiddenKey of ['mcp_servers', 'storage']) {
        if (Object.hasOwn(evaluation.config || {}, forbiddenKey)) {
          throw new Error(
            `${relativeEvalPath}: offline suite must not configure ` +
              forbiddenKey
          );
        }
      }
      if (Object.hasOwn(evaluation, 'graders')) {
        throw new Error(
          `${relativeEvalPath}: offline suite must not define global graders`
        );
      }
      if (
        !Array.isArray(evaluation.metrics) ||
        evaluation.metrics.length === 0
      ) {
        throw new Error(
          `${relativeEvalPath}: offline suite must define metrics`
        );
      }
    }

    const evalDirectory = path.dirname(absoluteEvalPath);
    const taskPatterns = evaluation.tasks || [];
    const taskPaths = taskPatterns
      .flatMap((pattern) =>
        globSync(pattern, {
          cwd: evalDirectory,
          nodir: true,
        })
      )
      .sort();
    const tasks = taskPaths.map((taskPath) =>
      loadYaml(path.join(evalDirectory, taskPath))
    );

    if (mode === 'offline') {
      const [, packageName, directoryName] = relativeEvalPath.split('/');
      const expectedSkillPath =
        `packages/${packageName}/skills/${directoryName}/SKILL.md`;

      for (const task of tasks) {
        if (Object.hasOwn(task.inputs || {}, 'responder')) {
          throw new Error(
            `${task.id}: offline task must not configure a responder`
          );
        }
        if (Object.hasOwn(task, 'checkpoints')) {
          throw new Error(
            `${task.id}: offline task must not define checkpoint graders`
          );
        }
        if (
          !Array.isArray(task.graders) ||
          task.graders.length !== 1 ||
          task.graders[0]?.type !== 'trigger'
        ) {
          throw new Error(
            `${task.id || relativeEvalPath}: offline task must define ` +
              'exactly one trigger grader'
          );
        }

        const triggerConfig = task.graders[0].config || {};
        if (
          triggerConfig.mode !== 'positive' &&
          triggerConfig.mode !== 'negative'
        ) {
          throw new Error(
            `${task.id}: trigger mode must be "positive" or "negative"`
          );
        }
        if (
          typeof triggerConfig.threshold !== 'number' ||
          !Number.isFinite(triggerConfig.threshold) ||
          triggerConfig.threshold < 0 ||
          triggerConfig.threshold > 1
        ) {
          throw new Error(
            `${task.id}: trigger threshold must be between 0 and 1`
          );
        }
        if (triggerConfig.skill_path !== expectedSkillPath) {
          throw new Error(
            `${task.id}: trigger skill_path must be ${expectedSkillPath}`
          );
        }
      }
    }

    suites.push({
      skillName: evaluation.skill,
      relativeEvalPath,
      skillDirectories: evaluation.config?.skill_directories || [],
      tasks,
    });
  }

  const skillNames = new Set(suites.map((suite) => suite.skillName));
  if (skillNames.size !== suites.length) {
    throw new Error('Each Waza suite must target a unique skill');
  }

  const taskIds = suites.flatMap((suite) =>
    suite.tasks.map((task) => task.id)
  );
  if (new Set(taskIds).size !== taskIds.length) {
    throw new Error('Waza task IDs must be globally unique');
  }

  return suites;
}
