import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'fs-extra';
import { globSync } from 'glob';
import YAML from 'yaml';
import Ajv from 'ajv';

const SCHEMA_PATTERNS = {
  eval: ['evals/*/*/eval.yaml', 'evals/*/*/mock.eval.yaml'],
  task: ['evals/*/*/tasks/*.yaml', 'evals/*/*/mock-tasks/*.yaml'],
};

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function formatErrors(filePath, errors) {
  return errors.map(
    (error) =>
      `${filePath}${error.instancePath || '/'} ${error.message || 'is invalid'}`
  );
}

export async function validatePinnedWazaSchemas(
  repositoryRoot,
  { fetchImpl = globalThis.fetch } = {}
) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('A Fetch-compatible implementation is required');
  }

  const lock = YAML.parse(
    await fs.readFile(
      path.join(repositoryRoot, 'evals', 'waza.lock.yaml'),
      'utf8'
    )
  );
  const failures = [];
  const counts = {};

  for (const [schemaName, patterns] of Object.entries(SCHEMA_PATTERNS)) {
    const pin = lock.schemas?.[schemaName];
    if (!pin?.url || !pin?.sha256) {
      throw new Error(`waza.lock.yaml is missing the ${schemaName} schema pin`);
    }

    const response = await fetchImpl(pin.url);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch ${schemaName} schema: HTTP ${response.status}`
      );
    }
    const schemaText = await response.text();
    const actualHash = sha256(schemaText);
    if (actualHash !== pin.sha256) {
      throw new Error(
        `${schemaName} schema checksum mismatch: expected ${pin.sha256}, ` +
          `received ${actualHash}`
      );
    }

    const validate = new Ajv({
      allErrors: true,
      strict: false,
    }).compile(JSON.parse(schemaText));
    const relativePaths = patterns
      .flatMap((pattern) =>
        globSync(pattern, {
          cwd: repositoryRoot,
          nodir: true,
        })
      )
      .sort();
    counts[schemaName] = relativePaths.length;

    for (const relativePath of relativePaths) {
      const document = YAML.parse(
        await fs.readFile(path.join(repositoryRoot, relativePath), 'utf8')
      );
      if (!validate(document)) {
        failures.push(...formatErrors(relativePath, validate.errors || []));
      }
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `Waza ${lock.version} schema validation failed:\n` +
        failures.map((failure) => `- ${failure}`).join('\n')
    );
  }

  return {
    version: lock.version,
    evalFiles: counts.eval,
    taskFiles: counts.task,
  };
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] === currentFile) {
  const repositoryRoot = path.resolve(path.dirname(currentFile), '../..');
  const result = await validatePinnedWazaSchemas(repositoryRoot);
  console.log(
    `Waza ${result.version} schema: ${result.evalFiles} eval files and ` +
      `${result.taskFiles} task files passed.`
  );
}
