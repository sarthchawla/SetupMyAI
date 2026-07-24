import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import YAML from 'yaml';
import { generateWazaSuites } from './generate.js';

const temporaryRoots = [];

async function createRepositoryFixture() {
  const repositoryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'setupmyai-waza-')
  );
  temporaryRoots.push(repositoryRoot);

  await fs.outputFile(
    path.join(
      repositoryRoot,
      'packages',
      'demo',
      'skills',
      'demo-skill',
      'SKILL.md'
    ),
    [
      '---',
      'name: demo-skill',
      'description: Use for deterministic demo tasks.',
      '---',
      '',
    ].join('\n')
  );
  await fs.outputFile(
    path.join(repositoryRoot, 'evals', 'cases.yaml'),
    YAML.stringify({
      schemaVersion: '1.0',
      wazaVersion: '0.38.3',
      skills: [
        {
          package: 'demo',
          directory: 'demo-skill',
          name: 'demo-skill',
          tasks: [
            {
              id: 'demo-positive',
              tags: ['positive'],
              trigger: 'positive',
              prompt: 'Use the deterministic demo skill.',
              contract: 'Recognize the demo request.',
            },
          ],
        },
      ],
    })
  );

  return repositoryRoot;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.remove(root)));
});

describe('generateWazaSuites', () => {
  it('generates an offline mock suite with trigger-only task graders', async () => {
    const repositoryRoot = await createRepositoryFixture();

    await generateWazaSuites(repositoryRoot);

    const suiteDirectory = path.join(
      repositoryRoot,
      'evals',
      'demo',
      'demo-skill'
    );
    const evaluation = YAML.parse(
      await fs.readFile(path.join(suiteDirectory, 'mock.eval.yaml'), 'utf8')
    );
    const task = YAML.parse(
      await fs.readFile(
        path.join(suiteDirectory, 'mock-tasks', 'demo-positive.yaml'),
        'utf8'
      )
    );

    assert.equal(evaluation.config.executor, 'mock');
    assert.equal(evaluation.config.inject_skill_body, false);
    assert.equal(evaluation.config.model, 'offline-mock');
    assert.deepEqual(evaluation.metrics, [
      {
        name: 'trigger-accuracy',
        weight: 1,
        threshold: 0.6,
      },
    ]);
    assert.ok(!Object.hasOwn(evaluation, 'graders'));
    assert.deepEqual(evaluation.tasks, ['mock-tasks/*.yaml']);
    assert.deepEqual(
      task.graders.map((grader) => grader.type),
      ['trigger']
    );
    assert.ok(
      task.graders.every((grader) => grader.type !== 'prompt'),
      'offline tasks must not use model-backed prompt graders'
    );
  });

  it('maps optional fixtures and deterministic constraints only to model tasks', async () => {
    const repositoryRoot = await createRepositoryFixture();
    const casePath = path.join(repositoryRoot, 'evals', 'cases.yaml');
    const caseSet = YAML.parse(await fs.readFile(casePath, 'utf8'));
    Object.assign(caseSet.skills[0].tasks[0], {
      modelPrompt: 'Inspect the synthetic fixture without changing it.',
      files: [
        {
          path: 'example.txt',
          content: 'synthetic public fixture',
        },
      ],
      outputContains: ['synthetic'],
      outputNotContains: ['secret-value'],
      maxToolCalls: 3,
      forbiddenTools: ['bash', 'sql'],
    });
    await fs.writeFile(casePath, YAML.stringify(caseSet));

    await generateWazaSuites(repositoryRoot);

    const suiteDirectory = path.join(
      repositoryRoot,
      'evals',
      'demo',
      'demo-skill'
    );
    const modelTask = YAML.parse(
      await fs.readFile(
        path.join(suiteDirectory, 'tasks', 'demo-positive.yaml'),
        'utf8'
      )
    );
    const offlineTask = YAML.parse(
      await fs.readFile(
        path.join(suiteDirectory, 'mock-tasks', 'demo-positive.yaml'),
        'utf8'
      )
    );

    assert.equal(
      modelTask.inputs.prompt,
      'Inspect the synthetic fixture without changing it.'
    );
    assert.deepEqual(modelTask.inputs.files, [
      {
        path: 'example.txt',
        content: 'synthetic public fixture',
      },
    ]);
    assert.deepEqual(modelTask.expected.output_contains, ['synthetic']);
    assert.deepEqual(modelTask.expected.output_not_contains, ['secret-value']);
    assert.equal(modelTask.expected.behavior.max_tool_calls, 3);
    assert.deepEqual(modelTask.expected.behavior.forbidden_tools, [
      'bash',
      'sql',
    ]);
    assert.deepEqual(
      modelTask.graders.find((grader) => grader.type === 'behavior'),
      {
        type: 'behavior',
        name: 'demo-positive-behavior',
        config: {
          max_tool_calls: 3,
          forbidden_tools: ['bash', 'sql'],
        },
      }
    );
    assert.match(
      modelTask.graders.find((grader) => grader.type === 'prompt').config
        .prompt,
      /advertised behavior contract/
    );

    assert.equal(
      offlineTask.inputs.prompt,
      'Use the deterministic demo skill.'
    );
    assert.ok(!Object.hasOwn(offlineTask.inputs, 'files'));
    assert.deepEqual(offlineTask.expected, {});
    assert.deepEqual(
      offlineTask.graders.map((grader) => grader.type),
      ['trigger']
    );
  });

  it('preserves existing model task defaults when optional fields are absent', async () => {
    const repositoryRoot = await createRepositoryFixture();

    await generateWazaSuites(repositoryRoot);

    const task = YAML.parse(
      await fs.readFile(
        path.join(
          repositoryRoot,
          'evals',
          'demo',
          'demo-skill',
          'tasks',
          'demo-positive.yaml'
        ),
        'utf8'
      )
    );

    assert.deepEqual(task.inputs, {
      prompt: 'Use the deterministic demo skill.',
    });
    assert.deepEqual(task.expected, {
      outcomes: [{ type: 'task_completed' }],
      behavior: {
        max_tool_calls: 20,
        max_iterations: 10,
        max_tokens: 12000,
      },
    });
    assert.deepEqual(
      task.graders.find((grader) => grader.type === 'behavior'),
      {
        type: 'behavior',
        name: 'demo-positive-behavior',
        config: {
          max_tool_calls: 20,
        },
      }
    );
  });

  it('removes stale generated model and offline tasks', async () => {
    const repositoryRoot = await createRepositoryFixture();
    const casePath = path.join(repositoryRoot, 'evals', 'cases.yaml');

    await generateWazaSuites(repositoryRoot);

    const caseSet = YAML.parse(await fs.readFile(casePath, 'utf8'));
    caseSet.skills[0].tasks = [
      {
        id: 'replacement-positive',
        tags: ['positive'],
        trigger: 'positive',
        prompt: 'Use the replacement demo workflow.',
        contract: 'Recognize the replacement request.',
      },
    ];
    await fs.writeFile(casePath, YAML.stringify(caseSet));
    await generateWazaSuites(repositoryRoot);

    const suiteDirectory = path.join(
      repositoryRoot,
      'evals',
      'demo',
      'demo-skill'
    );
    assert.equal(
      await fs.pathExists(
        path.join(suiteDirectory, 'tasks', 'demo-positive.yaml')
      ),
      false
    );
    assert.equal(
      await fs.pathExists(
        path.join(suiteDirectory, 'mock-tasks', 'demo-positive.yaml')
      ),
      false
    );
    assert.equal(
      await fs.pathExists(
        path.join(suiteDirectory, 'tasks', 'replacement-positive.yaml')
      ),
      true
    );
    assert.equal(
      await fs.pathExists(
        path.join(suiteDirectory, 'mock-tasks', 'replacement-positive.yaml')
      ),
      true
    );
  });

  it('prunes removed suite directories without touching eval support files', async () => {
    const repositoryRoot = await createRepositoryFixture();
    const staleSuite = path.join(
      repositoryRoot,
      'evals',
      'retired-package',
      'retired-skill'
    );
    const baselinePath = path.join(
      repositoryRoot,
      'evals',
      'baseline',
      'red.md'
    );
    const supportFixturePath = path.join(
      repositoryRoot,
      'evals',
      'lib',
      'fixtures',
      'keep.txt'
    );
    const generatedSuiteMarker = [
      '# Generated from evals/cases.yaml. Edit the canonical case file, then regenerate.',
      'name: retired-skill-eval',
    ].join('\n');
    await fs.outputFile(
      path.join(staleSuite, 'eval.yaml'),
      generatedSuiteMarker
    );
    await fs.outputFile(
      path.join(staleSuite, 'mock.eval.yaml'),
      generatedSuiteMarker
    );
    await fs.outputFile(
      path.join(staleSuite, 'tasks', 'stale.yaml'),
      'stale'
    );
    await fs.outputFile(baselinePath, 'preserve this report');
    await fs.outputFile(supportFixturePath, 'preserve this fixture');

    await generateWazaSuites(repositoryRoot);

    assert.equal(await fs.pathExists(staleSuite), false);
    assert.equal(await fs.pathExists(baselinePath), true);
    assert.equal(
      await fs.readFile(supportFixturePath, 'utf8'),
      'preserve this fixture'
    );
  });
});
