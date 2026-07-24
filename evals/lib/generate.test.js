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
});
