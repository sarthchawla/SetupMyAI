import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fsExtra from 'fs-extra';
import YAML from 'yaml';
import { loadSkillInventory } from './inventory.js';
import { loadEvaluationCoverage } from './coverage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(__dirname, '../..');
const temporaryRoots = [];

function createTriggerGrader(config = {}) {
  return {
    type: 'trigger',
    name: 'demo-positive-trigger',
    config: {
      skill_path: 'packages/demo/skills/demo-skill/SKILL.md',
      mode: 'positive',
      threshold: 0.6,
      ...config,
    },
  };
}

async function createOfflineCoverageFixture({
  evaluationConfig = {},
  evaluationOverrides = {},
  evaluationGraders,
  taskGraders,
  taskOverrides = {},
} = {}) {
  const repositoryRoot = await fsExtra.mkdtemp(
    path.join(os.tmpdir(), 'setupmyai-waza-coverage-')
  );
  temporaryRoots.push(repositoryRoot);
  const suiteDirectory = path.join(
    repositoryRoot,
    'evals',
    'demo',
    'demo-skill'
  );
  const evaluation = {
    name: 'demo-skill-offline-eval',
    description: 'Offline trigger evaluation for demo-skill.',
    skill: 'demo-skill',
    schemaVersion: '1.2',
    version: '1.0',
    config: {
      executor: 'mock',
      inject_skill_body: false,
      model: 'offline-mock',
      skill_directories: ['../../../packages/demo/skills'],
      ...evaluationConfig,
    },
    metrics: [
      {
        name: 'trigger-accuracy',
        weight: 1,
        threshold: 0.6,
      },
    ],
    tasks: ['mock-tasks/*.yaml'],
    ...evaluationOverrides,
  };
  if (evaluationGraders !== undefined) {
    evaluation.graders = evaluationGraders;
  }
  const task = {
    id: 'demo-positive',
    name: 'Demo Positive',
    tags: ['positive'],
    inputs: {
      prompt: 'Use the demo skill.',
    },
    expected: {},
    graders: taskGraders || [createTriggerGrader()],
    ...taskOverrides,
  };

  await fsExtra.outputFile(
    path.join(suiteDirectory, 'mock.eval.yaml'),
    YAML.stringify(evaluation)
  );
  await fsExtra.outputFile(
    path.join(suiteDirectory, 'mock-tasks', 'demo-positive.yaml'),
    YAML.stringify(task)
  );

  return repositoryRoot;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fsExtra.remove(root)));
});

describe('loadEvaluationCoverage', () => {
  it('provides varied Waza cases for every repository skill', async () => {
    const skills = await loadSkillInventory(REPOSITORY_ROOT);
    const suites = await loadEvaluationCoverage(REPOSITORY_ROOT);

    assert.deepEqual(
      suites.map((suite) => suite.skillName).sort(),
      skills.map((skill) => skill.name).sort()
    );

    for (const suite of suites) {
      assert.equal(suite.tasks.length, 4, `${suite.skillName}: expected 4 cases`);

      const tags = new Set(suite.tasks.flatMap((task) => task.tags));
      assert.ok(tags.has('positive'), `${suite.skillName}: missing positive case`);
      assert.ok(
        tags.has('boundary') || tags.has('negative-trigger'),
        `${suite.skillName}: missing boundary or negative-trigger case`
      );
      assert.ok(
        tags.has('constraint') || tags.has('safety'),
        `${suite.skillName}: missing constraint or safety case`
      );

      for (const task of suite.tasks) {
        assert.ok(task.id);
        assert.ok(task.name);
        assert.ok(task.inputs?.prompt);
        assert.ok(task.expected);
      }
    }
  });

  it('places task-specific graders at the Waza task root', async () => {
    const suites = await loadEvaluationCoverage(REPOSITORY_ROOT);

    for (const suite of suites) {
      for (const task of suite.tasks) {
        assert.ok(Array.isArray(task.graders), `${task.id}: missing graders`);
        assert.ok(
          !Object.hasOwn(task.expected, 'graders'),
          `${task.id}: graders nested under expected`
        );
      }
    }
  });

  it('includes the eval envelope required by the pinned Waza schema', async () => {
    for (const mode of ['model', 'offline']) {
      const suites = await loadEvaluationCoverage(REPOSITORY_ROOT, { mode });

      for (const suite of suites) {
        const evaluation = YAML.parse(
          fs.readFileSync(
            path.join(REPOSITORY_ROOT, suite.relativeEvalPath),
            'utf8'
          )
        );
        assert.equal(typeof evaluation.config?.model, 'string');
        assert.ok(evaluation.config.model.length > 0);
        assert.ok(Array.isArray(evaluation.metrics));
        assert.ok(evaluation.metrics.length > 0);
      }
    }
  });

  it('uses resolvable skill directories and session-aware prompt graders', async () => {
    const suites = await loadEvaluationCoverage(REPOSITORY_ROOT);

    for (const suite of suites) {
      const evalDirectory = path.dirname(
        path.join(REPOSITORY_ROOT, suite.relativeEvalPath)
      );
      for (const skillDirectory of suite.skillDirectories) {
        assert.ok(
          fs.existsSync(path.resolve(evalDirectory, skillDirectory)),
          `${suite.skillName}: unresolved ${skillDirectory}`
        );
      }

      for (const task of suite.tasks) {
        const promptGraders = task.graders.filter(
          (grader) => grader.type === 'prompt'
        );
        assert.ok(promptGraders.length > 0, `${task.id}: missing prompt grader`);
        assert.ok(
          promptGraders.every(
            (grader) => grader.config?.continue_session === true
          ),
          `${task.id}: prompt grader cannot see the agent session`
        );
        for (const grader of promptGraders) {
          assert.match(grader.config.prompt, /set_waza_grade_pass/);
          assert.match(grader.config.prompt, /set_waza_grade_fail/);
        }
      }
    }
  });

  it('loads hermetic offline suites with trigger-only graders', async () => {
    const suites = await loadEvaluationCoverage(REPOSITORY_ROOT, {
      mode: 'offline',
    });

    for (const suite of suites) {
      assert.match(suite.relativeEvalPath, /\/mock\.eval\.yaml$/);

      const evaluation = YAML.parse(
        fs.readFileSync(
          path.join(REPOSITORY_ROOT, suite.relativeEvalPath),
          'utf8'
        )
      );
      assert.equal(evaluation.config.executor, 'mock');
      assert.equal(evaluation.config.inject_skill_body, false);
      assert.equal(evaluation.config.model, 'offline-mock');
      assert.ok(Array.isArray(evaluation.metrics));
      assert.ok(evaluation.metrics.length > 0);
      assert.ok(!Object.hasOwn(evaluation, 'graders'));

      for (const task of suite.tasks) {
        assert.deepEqual(
          task.graders.map((grader) => grader.type),
          ['trigger'],
          `${task.id}: offline grader must be trigger-only`
        );
      }
    }
  });

  it('rejects unknown execution modes instead of falling back to model mode', async () => {
    await assert.rejects(
      loadEvaluationCoverage(REPOSITORY_ROOT, { mode: 'remote' }),
      /mode must be "model" or "offline"/
    );
  });

  it('rejects model-backed configuration in offline suites', async () => {
    const nonMockRoot = await createOfflineCoverageFixture({
      evaluationConfig: { executor: 'copilot-sdk' },
    });
    await assert.rejects(
      loadEvaluationCoverage(nonMockRoot, { mode: 'offline' }),
      /offline suite executor must be "mock"/
    );

    const modelRoot = await createOfflineCoverageFixture({
      evaluationConfig: { model: 'gpt-4o' },
    });
    await assert.rejects(
      loadEvaluationCoverage(modelRoot, { mode: 'offline' }),
      /offline suite model must be "offline-mock"/
    );

    const bodyInjectionRoot = await createOfflineCoverageFixture({
      evaluationConfig: { inject_skill_body: true },
    });
    await assert.rejects(
      loadEvaluationCoverage(bodyInjectionRoot, { mode: 'offline' }),
      /offline suite must disable skill-body injection/
    );
  });

  it('rejects global graders in offline suites', async () => {
    const repositoryRoot = await createOfflineCoverageFixture({
      evaluationGraders: [
        {
          type: 'trigger',
          name: 'global-trigger',
          config: {
            skill_path: 'packages/demo/skills/demo-skill/SKILL.md',
            mode: 'positive',
            threshold: 0.6,
          },
        },
      ],
    });

    await assert.rejects(
      loadEvaluationCoverage(repositoryRoot, { mode: 'offline' }),
      /offline suite must not define global graders/
    );
  });

  it('requires exactly one trigger grader for each offline task', async () => {
    const invalidGraders = [
      [],
      [
        {
          type: 'prompt',
          name: 'model-judge',
          config: { model: 'auto', prompt: 'Judge this response.' },
        },
      ],
      [createTriggerGrader(), createTriggerGrader()],
    ];

    for (const taskGraders of invalidGraders) {
      const repositoryRoot = await createOfflineCoverageFixture({
        taskGraders,
      });
      await assert.rejects(
        loadEvaluationCoverage(repositoryRoot, { mode: 'offline' }),
        /offline task must define exactly one trigger grader/
      );
    }
  });

  it('validates the offline trigger mode, threshold, and skill path', async () => {
    const invalidConfigurations = [
      {
        config: { mode: 'sometimes' },
        message: /trigger mode must be "positive" or "negative"/,
      },
      {
        config: { threshold: 1.1 },
        message: /trigger threshold must be between 0 and 1/,
      },
      {
        config: { skill_path: 'packages/demo/skills/other/SKILL.md' },
        message: /trigger skill_path must be/,
      },
    ];

    for (const invalid of invalidConfigurations) {
      const repositoryRoot = await createOfflineCoverageFixture({
        taskGraders: [createTriggerGrader(invalid.config)],
      });
      await assert.rejects(
        loadEvaluationCoverage(repositoryRoot, { mode: 'offline' }),
        invalid.message
      );
    }
  });

  it('rejects hidden model-backed fields and nested prompt graders', async () => {
    const judgeModelRoot = await createOfflineCoverageFixture({
      evaluationConfig: { judge_model: 'auto' },
    });
    await assert.rejects(
      loadEvaluationCoverage(judgeModelRoot, { mode: 'offline' }),
      /offline suite must not configure a model/
    );

    const hooksRoot = await createOfflineCoverageFixture({
      evaluationOverrides: {
        hooks: {
          before_run: [{ command: 'curl https://example.com' }],
        },
      },
    });
    await assert.rejects(
      loadEvaluationCoverage(hooksRoot, { mode: 'offline' }),
      /offline suite must not configure hooks/
    );

    for (const forbiddenKey of ['mcp_servers', 'storage']) {
      const repositoryRoot = await createOfflineCoverageFixture({
        evaluationConfig: { [forbiddenKey]: {} },
      });
      await assert.rejects(
        loadEvaluationCoverage(repositoryRoot, { mode: 'offline' }),
        new RegExp(`offline suite must not configure ${forbiddenKey}`)
      );
    }

    const responderRoot = await createOfflineCoverageFixture({
      taskOverrides: {
        inputs: {
          prompt: 'Use the demo skill.',
          responder: {
            instructions: 'Answer follow-up questions.',
            max_followups: 2,
          },
        },
      },
    });
    await assert.rejects(
      loadEvaluationCoverage(responderRoot, { mode: 'offline' }),
      /offline task must not configure a responder/
    );

    const checkpointRoot = await createOfflineCoverageFixture({
      taskOverrides: {
        checkpoints: [
          {
            after_turn: 1,
            graders: [
              {
                type: 'prompt',
                name: 'checkpoint-judge',
                config: { model: 'auto', prompt: 'Judge the response.' },
              },
            ],
          },
        ],
      },
    });
    await assert.rejects(
      loadEvaluationCoverage(checkpointRoot, { mode: 'offline' }),
      /offline task must not define checkpoint graders/
    );
  });

  it('matches all 60 canonical cases exactly in both execution modes', async () => {
    const caseSet = YAML.parse(
      fs.readFileSync(path.join(REPOSITORY_ROOT, 'evals', 'cases.yaml'), 'utf8')
    );
    const canonicalBySkill = new Map(
      caseSet.skills.map((skill) => [skill.name, skill.tasks])
    );
    assert.equal(caseSet.skills.length, 15);
    assert.equal(
      caseSet.skills.reduce((total, skill) => total + skill.tasks.length, 0),
      60
    );

    for (const mode of ['model', 'offline']) {
      const suites = await loadEvaluationCoverage(REPOSITORY_ROOT, { mode });
      assert.equal(suites.length, 15);
      assert.equal(
        suites.reduce((total, suite) => total + suite.tasks.length, 0),
        60
      );

      for (const suite of suites) {
        const canonicalTasks = canonicalBySkill.get(suite.skillName);
        assert.deepEqual(
          suite.tasks
            .map((task) => ({
              id: task.id,
              prompt: task.inputs.prompt,
              description: task.description,
              tags: task.tags,
              trigger: task.graders.find((grader) => grader.type === 'trigger')
                ?.config.mode,
            }))
            .sort((left, right) => left.id.localeCompare(right.id)),
          canonicalTasks
            .map((task) => ({
              id: task.id,
              prompt: task.prompt,
              description: task.contract,
              tags: task.tags,
              trigger: task.trigger,
            }))
            .sort((left, right) => left.id.localeCompare(right.id)),
          `${suite.skillName}: ${mode} tasks drifted from evals/cases.yaml`
        );
      }
    }
  });
});
