#!/usr/bin/env node

import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { generateWazaSuites } from '../evals/lib/generate.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);

await generateWazaSuites(repositoryRoot);

const { stdout } = await execFileAsync(
  'git',
  [
    'status',
    '--short',
    '--untracked-files=all',
    '--',
    'evals',
  ],
  { cwd: repositoryRoot }
);

if (stdout.trim()) {
  throw new Error(
    'Generated Waza artifacts are stale. Run pnpm eval:generate and commit:\n' +
      stdout.trim()
  );
}
