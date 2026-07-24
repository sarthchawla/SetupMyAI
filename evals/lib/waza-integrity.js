import crypto from 'node:crypto';
import fs from 'node:fs';
import YAML from 'yaml';

const PLATFORM_NAMES = {
  darwin: 'darwin',
  linux: 'linux',
  win32: 'windows',
};

const ARCHITECTURE_NAMES = {
  arm64: 'arm64',
  x64: 'amd64',
};

export function resolveWazaAsset(platform, arch) {
  const platformName = PLATFORM_NAMES[platform];
  if (!platformName) {
    throw new Error(`Unsupported Waza platform: ${platform}`);
  }

  const architectureName = ARCHITECTURE_NAMES[arch];
  if (!architectureName) {
    throw new Error(`Unsupported Waza architecture: ${arch}`);
  }

  const extension = platform === 'win32' ? '.exe' : '';
  return `waza-${platformName}-${architectureName}${extension}`;
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const input = fs.createReadStream(filePath);

    input.on('data', (chunk) => hash.update(chunk));
    input.once('error', reject);
    input.once('end', () => resolve(hash.digest('hex')));
  });
}

export async function verifyWazaBinaryChecksum(
  binaryPath,
  lockPath,
  {
    platform = process.platform,
    arch = process.arch,
  } = {}
) {
  const lock = YAML.parse(await fs.promises.readFile(lockPath, 'utf8'));
  const asset = resolveWazaAsset(platform, arch);
  const expectedChecksum = lock?.checksums?.[asset];

  if (typeof lock?.version !== 'string') {
    throw new Error('waza.lock.yaml is missing a pinned version');
  }
  if (typeof expectedChecksum !== 'string') {
    throw new Error(`waza.lock.yaml is missing the ${asset} checksum`);
  }

  const checksum = await sha256File(binaryPath);
  if (checksum !== expectedChecksum) {
    throw new Error(
      `Waza binary checksum mismatch for ${asset}: ` +
        `expected ${expectedChecksum}, received ${checksum}`
    );
  }

  return {
    version: lock.version,
    asset,
    checksum,
  };
}
