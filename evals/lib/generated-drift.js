import { createHash } from 'node:crypto';
import path from 'node:path';
import fs from 'fs-extra';
import { generateWazaSuites } from './generate.js';

function portablePath(filePath) {
  return filePath.split(path.sep).join('/');
}

async function snapshotDirectory(directoryPath) {
  const snapshot = new Map();

  let rootStats;
  try {
    rootStats = await fs.lstat(directoryPath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return snapshot;
    }
    throw error;
  }

  if (rootStats.isSymbolicLink()) {
    throw new Error(`cannot snapshot a symbolic link: ${directoryPath}`);
  }
  if (!rootStats.isDirectory()) {
    throw new Error(`cannot snapshot a non-directory: ${directoryPath}`);
  }

  async function visit(currentDirectory) {
    const entries = await fs.readdir(currentDirectory, {
      withFileTypes: true,
    });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const absolutePath = path.join(currentDirectory, entry.name);
      const relativePath = portablePath(
        path.relative(directoryPath, absolutePath)
      );

      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (entry.isFile()) {
        const digest = createHash('sha256')
          .update(await fs.readFile(absolutePath))
          .digest('hex');
        snapshot.set(relativePath, `file:${digest}`);
      } else if (entry.isSymbolicLink()) {
        snapshot.set(
          relativePath,
          `symlink:${await fs.readlink(absolutePath)}`
        );
      } else {
        const stats = await fs.lstat(absolutePath);
        snapshot.set(relativePath, `other:${stats.mode}`);
      }
    }
  }

  await visit(directoryPath);
  return snapshot;
}

function compareSnapshots(before, after) {
  const relativePaths = [...new Set([...before.keys(), ...after.keys()])].sort();

  return relativePaths.flatMap((relativePath) => {
    if (!before.has(relativePath)) {
      return [`?? evals/${relativePath}`];
    }
    if (!after.has(relativePath)) {
      return [`D evals/${relativePath}`];
    }
    if (before.get(relativePath) !== after.get(relativePath)) {
      return [`M evals/${relativePath}`];
    }
    return [];
  });
}

export async function verifyGeneratedWazaSuites(repositoryRoot) {
  const evalsDirectory = path.join(repositoryRoot, 'evals');
  const before = await snapshotDirectory(evalsDirectory);

  await generateWazaSuites(repositoryRoot);

  const after = await snapshotDirectory(evalsDirectory);
  const changes = compareSnapshots(before, after);

  if (changes.length > 0) {
    throw new Error(
      'Generated Waza artifacts are stale. Run pnpm eval:generate and commit:\n' +
        changes.join('\n')
    );
  }
}
