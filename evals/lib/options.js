import path from 'node:path';

const VALUE_OPTIONS = new Set([
  '--waza',
  '--mode',
  '--output-dir',
  '--concurrency',
  '--task-workers',
]);
const BOOLEAN_OPTIONS = new Set(['--acknowledge-model-transmission']);

export function parseWazaOptions(args, { repositoryRoot }) {
  const options = {
    command: args[0] || 'run',
    mode: 'offline',
    modelTransmissionAcknowledged: false,
    concurrency: 2,
    taskWorkers: 4,
    outputDir: path.join(repositoryRoot, 'evals', 'results'),
  };

  for (let index = 1; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--') {
      continue;
    }
    if (BOOLEAN_OPTIONS.has(arg)) {
      options.modelTransmissionAcknowledged = true;
      continue;
    }
    const value = args[index + 1];

    if (!VALUE_OPTIONS.has(arg)) {
      throw new Error(`Unknown option: ${arg}`);
    }
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${arg} requires a value`);
    }

    if (arg === '--waza') options.waza = value;
    else if (arg === '--mode') options.mode = value;
    else if (arg === '--output-dir') options.outputDir = path.resolve(value);
    else if (arg === '--concurrency') options.concurrency = Number(value);
    else if (arg === '--task-workers') options.taskWorkers = Number(value);

    index++;
  }

  if (options.mode !== 'model' && options.mode !== 'offline') {
    throw new Error('--mode must be "model" or "offline"');
  }
  if (options.mode === 'model' && !options.modelTransmissionAcknowledged) {
    throw new Error(
      'Model-backed execution requires --acknowledge-model-transmission'
    );
  }
  if (options.mode === 'offline' && options.modelTransmissionAcknowledged) {
    throw new Error(
      '--acknowledge-model-transmission is only valid with --mode model'
    );
  }
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1) {
    throw new Error('--concurrency must be a positive integer');
  }
  if (!Number.isInteger(options.taskWorkers) || options.taskWorkers < 1) {
    throw new Error('--task-workers must be a positive integer');
  }

  return options;
}
