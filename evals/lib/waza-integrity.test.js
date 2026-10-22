import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import {
  resolveWazaAsset,
  verifyWazaBinaryChecksum,
} from './waza-integrity.js';

const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.remove(root)));
});

describe('Waza binary integrity', () => {
  it('maps supported Node platforms and architectures to release assets', () => {
    assert.equal(resolveWazaAsset('darwin', 'arm64'), 'waza-darwin-arm64');
    assert.equal(resolveWazaAsset('linux', 'x64'), 'waza-linux-amd64');
    assert.equal(
      resolveWazaAsset('win32', 'arm64'),
      'waza-windows-arm64.exe'
    );
    assert.throws(
      () => resolveWazaAsset('freebsd', 'x64'),
      /Unsupported Waza platform/
    );
    assert.throws(
      () => resolveWazaAsset('linux', 'riscv64'),
      /Unsupported Waza architecture/
    );
  });

  it('accepts only the platform asset checksum pinned by the lockfile', async () => {
    const temporaryRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'setupmyai-waza-integrity-')
    );
    temporaryRoots.push(temporaryRoot);
    const binaryPath = path.join(temporaryRoot, 'waza-linux-amd64');
    const lockPath = path.join(temporaryRoot, 'waza.lock.yaml');
    const binary = Buffer.from('known Waza test binary');
    const checksum = crypto.createHash('sha256').update(binary).digest('hex');

    await fs.writeFile(binaryPath, binary);
    await fs.writeFile(
      lockPath,
      [
        'version: "0.38.3"',
        'checksums:',
        `  waza-linux-amd64: "${checksum}"`,
        '',
      ].join('\n')
    );

    const verified = await verifyWazaBinaryChecksum(binaryPath, lockPath, {
      platform: 'linux',
      arch: 'x64',
    });

    assert.deepEqual(verified, {
      version: '0.38.3',
      asset: 'waza-linux-amd64',
      checksum,
    });

    await fs.writeFile(binaryPath, 'tampered');
    await assert.rejects(
      verifyWazaBinaryChecksum(binaryPath, lockPath, {
        platform: 'linux',
        arch: 'x64',
      }),
      /checksum mismatch/
    );
  });
});
