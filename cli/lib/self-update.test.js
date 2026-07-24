import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  compareVersions,
  getCliUpdateStatus,
  getLatestCliVersion,
} from './self-update.js';

describe('self-update', () => {
  it('compares dotted versions', () => {
    assert.equal(compareVersions('1.0.1', '1.0.0'), 1);
    assert.equal(compareVersions('1.0.0', '1.0.1'), -1);
    assert.equal(compareVersions('1.0.0', '1.0'), 0);
  });

  it('reads latest version from npm registry payload', async () => {
    const latest = await getLatestCliVersion(async () => ({
      ok: true,
      json: async () => ({ 'dist-tags': { latest: '9.9.9' } }),
    }));

    assert.equal(latest, '9.9.9');
  });

  it('reports update availability with a mocked registry response', async () => {
    const status = await getCliUpdateStatus(async () => ({
      ok: true,
      json: async () => ({ 'dist-tags': { latest: '999.0.0' } }),
    }));

    assert.equal(status.latest, '999.0.0');
    assert.equal(status.updateAvailable, true);
  });
});
