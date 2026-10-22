import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import YAML from 'yaml';
import { validatePinnedWazaSchemas } from './schema.js';

const temporaryRoots = [];

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function createSchemaFixture() {
  const repositoryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'setupmyai-waza-schema-')
  );
  temporaryRoots.push(repositoryRoot);

  const schemas = {
    eval: JSON.stringify({
      type: 'object',
      required: ['name'],
    }),
    task: JSON.stringify({
      type: 'object',
      required: ['id'],
    }),
  };
  for (const [schemaName, schemaText] of Object.entries(schemas)) {
    await fs.outputFile(
      path.join(
        repositoryRoot,
        'evals',
        'schemas',
        `${schemaName}.schema.json`
      ),
      schemaText
    );
  }
  await fs.outputFile(
    path.join(repositoryRoot, 'evals', 'waza.lock.yaml'),
    YAML.stringify({
      version: '0.38.3',
      schemas: Object.fromEntries(
        Object.entries(schemas).map(([schemaName, schemaText]) => [
          schemaName,
          {
            url: `https://example.invalid/${schemaName}.schema.json`,
            path: `evals/schemas/${schemaName}.schema.json`,
            sha256: sha256(schemaText),
          },
        ])
      ),
    })
  );
  await fs.outputFile(
    path.join(repositoryRoot, 'evals', 'demo', 'skill', 'eval.yaml'),
    'name: demo\n'
  );
  await fs.outputFile(
    path.join(
      repositoryRoot,
      'evals',
      'demo',
      'skill',
      'tasks',
      'demo.yaml'
    ),
    'id: demo\n'
  );

  return repositoryRoot;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.remove(root)));
});

describe('validatePinnedWazaSchemas', () => {
  it('validates checksummed vendored schemas without network access', async () => {
    const repositoryRoot = await createSchemaFixture();
    let fetchCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      throw new Error('network access is forbidden');
    };

    try {
      assert.deepEqual(await validatePinnedWazaSchemas(repositoryRoot), {
        version: '0.38.3',
        evalFiles: 1,
        taskFiles: 1,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
    assert.equal(fetchCalls, 0);
  });

  it('rejects a vendored schema whose checksum no longer matches', async () => {
    const repositoryRoot = await createSchemaFixture();
    await fs.appendFile(
      path.join(repositoryRoot, 'evals', 'schemas', 'eval.schema.json'),
      '\n'
    );

    await assert.rejects(
      validatePinnedWazaSchemas(repositoryRoot),
      /eval schema checksum mismatch/
    );
  });

  it('rejects schema paths outside the vendored schema directory', async () => {
    const repositoryRoot = await createSchemaFixture();
    const lockPath = path.join(repositoryRoot, 'evals', 'waza.lock.yaml');
    const lock = YAML.parse(await fs.readFile(lockPath, 'utf8'));
    lock.schemas.eval.path = 'evals/cases.yaml';
    await fs.writeFile(lockPath, YAML.stringify(lock));

    await assert.rejects(
      validatePinnedWazaSchemas(repositoryRoot),
      /eval schema path must stay within evals\/schemas/
    );
  });

  it('rejects a vendored schema symlink before reading its target', async () => {
    const repositoryRoot = await createSchemaFixture();
    const schemaPath = path.join(
      repositoryRoot,
      'evals',
      'schemas',
      'eval.schema.json'
    );
    const outsidePath = path.join(repositoryRoot, 'outside.schema.json');
    await fs.move(schemaPath, outsidePath);
    await fs.symlink(
      path.relative(path.dirname(schemaPath), outsidePath),
      schemaPath
    );

    await assert.rejects(
      validatePinnedWazaSchemas(repositoryRoot),
      /eval schema must be a regular file, not a symbolic link/
    );
  });
});
