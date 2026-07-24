import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import YAML from 'yaml';
import { verifyGeneratedWazaSuites } from './generated-drift.js';
import { generateWazaSuites } from './generate.js';

const temporaryRoots = [];

async function createRepositoryFixture() {
  const repositoryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'setupmyai-generated-drift-')
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

describe('verifyGeneratedWazaSuites', () => {
  it('rejects a symlinked eval root before snapshot traversal', async () => {
    const repositoryRoot = await createRepositoryFixture();
    const evalsDirectory = path.join(repositoryRoot, 'evals');
    const externalRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'setupmyai-generated-drift-external-')
    );
    temporaryRoots.push(externalRoot);
    const externalEvalsDirectory = path.join(externalRoot, 'evals');
    await fs.move(evalsDirectory, externalEvalsDirectory);
    await fs.symlink(externalEvalsDirectory, evalsDirectory, 'dir');

    await assert.rejects(
      verifyGeneratedWazaSuites(repositoryRoot),
      /cannot snapshot a symbolic link/
    );
  });

  it('does not require git or any executable on PATH', async () => {
    const repositoryRoot = await createRepositoryFixture();
    await generateWazaSuites(repositoryRoot);
    const originalPath = process.env.PATH;

    process.env.PATH = '';
    try {
      await verifyGeneratedWazaSuites(repositoryRoot);
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it('repairs and reports stale generated artifacts', async () => {
    const repositoryRoot = await createRepositoryFixture();
    await generateWazaSuites(repositoryRoot);
    const stalePath = path.join(
      repositoryRoot,
      'evals',
      'demo',
      'demo-skill',
      'mock.eval.yaml'
    );
    await fs.appendFile(stalePath, '# stale\n');

    await assert.rejects(
      verifyGeneratedWazaSuites(repositoryRoot),
      /M evals\/demo\/demo-skill\/mock\.eval\.yaml/
    );
    assert.doesNotMatch(await fs.readFile(stalePath, 'utf8'), /# stale/);
  });

  it('reports missing and extra generated tasks', async () => {
    const repositoryRoot = await createRepositoryFixture();
    await generateWazaSuites(repositoryRoot);
    const tasksDirectory = path.join(
      repositoryRoot,
      'evals',
      'demo',
      'demo-skill',
      'tasks'
    );
    const missingTaskPath = path.join(tasksDirectory, 'demo-positive.yaml');
    const extraTaskPath = path.join(tasksDirectory, 'retired-task.yaml');
    await fs.remove(missingTaskPath);
    await fs.writeFile(extraTaskPath, 'stale task');

    await assert.rejects(
      verifyGeneratedWazaSuites(repositoryRoot),
      (error) => {
        assert.match(
          error.message,
          /\?\? evals\/demo\/demo-skill\/tasks\/demo-positive\.yaml/
        );
        assert.match(
          error.message,
          /D evals\/demo\/demo-skill\/tasks\/retired-task\.yaml/
        );
        return true;
      }
    );
    assert.equal(await fs.pathExists(missingTaskPath), true);
    assert.equal(await fs.pathExists(extraTaskPath), false);
  });
});
