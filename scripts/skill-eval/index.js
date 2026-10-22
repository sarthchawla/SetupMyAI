#!/usr/bin/env node
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runEvaluation } from './lib.js';

export async function main(args = process.argv.slice(2)) {
  const options = {};
  const required = ['--cases', '--baseline-skill', '--candidate-skill', '--adapter', '--output'];
  const allowed = new Set([...required, '--guidance-manifest', '--judge-adapter', '--policy']);
  for (let index = 0; index < args.length; index += 2) {
    if (!allowed.has(args[index]) || !args[index + 1] || args[index + 1].startsWith('--') || options[args[index]]) throw new Error('Usage: pnpm exec node scripts/skill-eval/index.js --cases cases.json --baseline-skill skill-directory --candidate-skill skill-directory --adapter adapter.json --output report.json [--guidance-manifest manifest.json] [--judge-adapter judge.json] [--policy thresholds.json]');
    options[args[index]] = args[index + 1];
  }
  if (!required.every((key) => options[key])) throw new Error('All five options are required: --cases --baseline-skill --candidate-skill --adapter --output');
  const output = path.resolve(options['--output']);
  const report = await runEvaluation({ casesPath: options['--cases'], baselineSkill: options['--baseline-skill'], candidateSkill: options['--candidate-skill'], adapterPath: options['--adapter'], guidanceManifestPath: options['--guidance-manifest'], judgeAdapterPath: options['--judge-adapter'], thresholds: options['--policy'] ? JSON.parse(await readFile(options['--policy'], 'utf8')) : {} });
  await mkdir(path.dirname(output), { recursive: true });
  const temporary = `${output}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  await rename(temporary, output);
  console.log(JSON.stringify({ status: report.status, behavioralExecuted: report.behavioralExecuted, eligible: report.promotion.eligible, reasons: report.promotion.reasons, output }));
  // A completed synthetic smoke run succeeds as a harness check, but never as a promotion gate.
  return report.status === 'complete' ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().then((code) => { process.exitCode = code; }).catch((error) => { console.error(error.message); process.exitCode = 1; });
