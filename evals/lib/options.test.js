import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseWazaOptions } from './options.js';

describe('parseWazaOptions', () => {
  it('accepts explicit offline mode for the Waza runner', () => {
    const options = parseWazaOptions(
      ['run', '--mode', 'offline', '--waza', '/tmp/waza'],
      { repositoryRoot: '/repo' }
    );

    assert.equal(options.command, 'run');
    assert.equal(options.mode, 'offline');
    assert.equal(options.waza, '/tmp/waza');
    assert.equal(options.outputDir, '/repo/evals/results');
  });

  it('rejects execution modes outside model and offline', () => {
    assert.throws(
      () =>
        parseWazaOptions(['run', '--mode', 'remote'], {
          repositoryRoot: '/repo',
        }),
      /--mode must be "model" or "offline"/
    );
  });

  it('defaults to offline mode', () => {
    const options = parseWazaOptions(['run'], {
      repositoryRoot: '/repo',
    });

    assert.equal(options.mode, 'offline');
  });

  it('accepts the conventional bare argument separator', () => {
    const options = parseWazaOptions(
      ['run', '--', '--mode', 'offline', '--waza', '/tmp/waza'],
      { repositoryRoot: '/repo' }
    );

    assert.equal(options.mode, 'offline');
    assert.equal(options.waza, '/tmp/waza');
  });

  it('requires positive integer concurrency and task-worker values', () => {
    const invalidOptions = [
      ['--concurrency', '0'],
      ['--concurrency', '1.5'],
      ['--task-workers', '0'],
      ['--task-workers', 'many'],
    ];

    for (const [option, value] of invalidOptions) {
      assert.throws(
        () =>
          parseWazaOptions(['run', option, value], {
            repositoryRoot: '/repo',
          }),
        new RegExp(`${option} must be a positive integer`)
      );
    }
  });

  it('requires an explicit acknowledgement for model-backed execution', () => {
    assert.throws(
      () =>
        parseWazaOptions(['run', '--mode', 'model'], {
          repositoryRoot: '/repo',
        }),
      /requires --acknowledge-model-transmission/
    );

    const options = parseWazaOptions(
      [
        'run',
        '--mode',
        'model',
        '--acknowledge-model-transmission',
        '--waza',
        '/tmp/waza',
      ],
      { repositoryRoot: '/repo' }
    );
    assert.equal(options.mode, 'model');
    assert.equal(options.modelTransmissionAcknowledged, true);
  });

  it('rejects a transmission acknowledgement in offline mode', () => {
    assert.throws(
      () =>
        parseWazaOptions(
          ['run', '--mode', 'offline', '--acknowledge-model-transmission'],
          { repositoryRoot: '/repo' }
        ),
      /only valid with --mode model/
    );
  });

  it('rejects options whose values are missing', () => {
    const valuedOptions = [
      '--waza',
      '--mode',
      '--output-dir',
      '--concurrency',
      '--task-workers',
    ];

    for (const option of valuedOptions) {
      assert.throws(
        () =>
          parseWazaOptions(['run', option], {
            repositoryRoot: '/repo',
          }),
        new RegExp(`${option} requires a value`)
      );
    }

    assert.throws(
      () =>
        parseWazaOptions(['run', '--waza', '--mode', 'offline'], {
          repositoryRoot: '/repo',
        }),
      /--waza requires a value/
    );
  });
});
