import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSkillInventory } from './inventory.js';
import { globSync } from 'glob';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(__dirname, '../..');

describe('loadSkillInventory', () => {
  it('discovers all exact SKILL.md entries using frontmatter only', async () => {
    const skills = await loadSkillInventory(REPOSITORY_ROOT);

    assert.deepEqual(skills.map((skill) => skill.relativePath), globSync('packages/*/skills/*/SKILL.md', { cwd: REPOSITORY_ROOT, nodir: true }).sort());
    assert.ok(skills.length > 0);
    assert.equal(new Set(skills.map((skill) => skill.name)).size, skills.length);

    for (const skill of skills) {
      assert.ok(skill.packageName);
      assert.ok(skill.directoryName);
      assert.ok(skill.name);
      assert.ok(skill.description);
      assert.match(skill.relativePath, /\/SKILL\.md$/);
      assert.ok(!Object.hasOwn(skill, 'body'));
    }
  });
});
