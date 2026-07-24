#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import path from 'node:path';

const tarball = process.argv[2];

if (!tarball) {
  console.error('Usage: node scripts/verify-pack.js <package.tgz>');
  process.exit(1);
}

const entries = execFileSync('tar', ['-tf', tarball], { encoding: 'utf-8' })
  .split('\n')
  .filter(Boolean);

const requiredPrefixes = [
  'package/cli/',
  'package/packages/',
];
const requiredFiles = [
  'package/apm.yml',
  'package/README.md',
  'package/package.json',
];
const forbiddenPatterns = [
  /^package\/\.codex\//,
  /^package\/\.claude\//,
  /^package\/\.cursor\//,
  /^package\/\.agents\//,
  /^package\/node_modules\//,
  /^package\/\.npmrc$/,
  /^package\/SetupMyAi-public\//,
  /^package\/SetupMyAi\//,
];

const missing = [
  ...requiredPrefixes.filter((prefix) => !entries.some((entry) => entry.startsWith(prefix))),
  ...requiredFiles.filter((file) => !entries.includes(file)),
];
const forbidden = entries.filter((entry) => forbiddenPatterns.some((pattern) => pattern.test(entry)));

if (missing.length > 0 || forbidden.length > 0) {
  if (missing.length > 0) {
    console.error('Missing required package entries:');
    for (const entry of missing) console.error(`  - ${entry}`);
  }
  if (forbidden.length > 0) {
    console.error('Forbidden package entries:');
    for (const entry of forbidden) console.error(`  - ${entry}`);
  }
  process.exit(1);
}

console.log(`Verified ${path.basename(tarball)} (${entries.length} entries)`);
