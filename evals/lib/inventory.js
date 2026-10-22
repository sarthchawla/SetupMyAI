import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { globSync } from 'glob';
import YAML from 'yaml';

async function readFrontmatter(filePath) {
  const input = fs.createReadStream(filePath, { encoding: 'utf8' });
  const lines = readline.createInterface({
    input,
    crlfDelay: Infinity,
  });
  const frontmatter = [];
  let opened = false;
  let closed = false;

  try {
    for await (const line of lines) {
      if (!opened) {
        if (line !== '---') {
          throw new Error(`${filePath}: expected YAML frontmatter`);
        }
        opened = true;
        continue;
      }

      if (line === '---') {
        closed = true;
        break;
      }

      frontmatter.push(line);
    }
  } finally {
    lines.close();
    input.destroy();
  }

  if (!closed) {
    throw new Error(`${filePath}: unterminated YAML frontmatter`);
  }

  return YAML.parse(frontmatter.join('\n'));
}

export async function loadSkillInventory(repositoryRoot) {
  const relativePaths = globSync('packages/*/skills/*/SKILL.md', {
    cwd: repositoryRoot,
    nodir: true,
  }).sort();
  const skills = [];

  for (const relativePath of relativePaths) {
    const metadata = await readFrontmatter(
      path.join(repositoryRoot, relativePath)
    );
    const [, packageName, , directoryName] = relativePath.split('/');

    if (
      typeof metadata?.name !== 'string' ||
      typeof metadata?.description !== 'string'
    ) {
      throw new Error(
        `${relativePath}: frontmatter requires string name and description`
      );
    }

    skills.push({
      packageName,
      directoryName,
      name: metadata.name,
      description: metadata.description,
      relativePath,
    });
  }

  const names = new Set(skills.map((skill) => skill.name));
  if (names.size !== skills.length) {
    throw new Error('Skill frontmatter names must be unique');
  }

  return skills;
}
