#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyGeneratedWazaSuites } from '../evals/lib/generated-drift.js';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);

await verifyGeneratedWazaSuites(repositoryRoot);
