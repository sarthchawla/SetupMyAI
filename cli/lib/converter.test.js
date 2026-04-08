import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mdToMdc, mdcToMd, mdFilenameToMdc, mdcFilenameToMd } from './converter.js';

describe('converter', () => {
  describe('mdToMdc', () => {
    it('adds frontmatter with --- delimiters', () => {
      const result = mdToMdc('Hello world');
      assert.ok(result.startsWith('---\n'));
      assert.ok(result.includes('\n---\n'));
    });

    it('extracts heading as description', () => {
      const result = mdToMdc('# My Heading\nSome content');
      assert.ok(result.includes('description: My Heading'));
    });

    it('uses custom description from metadata', () => {
      const result = mdToMdc('# My Heading', { description: 'Custom desc' });
      assert.ok(result.includes('description: Custom desc'));
      assert.ok(!result.includes('description: My Heading'));
    });

    it('preserves original content after frontmatter', () => {
      const content = '# Title\nParagraph text\n- item';
      const result = mdToMdc(content);
      assert.ok(result.endsWith(content));
    });

    it('defaults alwaysApply to true', () => {
      const result = mdToMdc('content');
      assert.ok(result.includes('alwaysApply: true'));
    });

    it('respects alwaysApply: false in metadata', () => {
      const result = mdToMdc('content', { alwaysApply: false });
      assert.ok(result.includes('alwaysApply: false'));
    });

    it('uses custom globs from metadata', () => {
      const result = mdToMdc('content', { globs: '**/*.ts' });
      assert.ok(result.includes('globs: **/*.ts'));
    });

    it('uses empty string for globs by default', () => {
      const result = mdToMdc('content');
      assert.ok(result.includes('globs: \n') || result.includes('globs: \n'));
    });

    it('uses "Imported rule" description for empty content', () => {
      const result = mdToMdc('');
      assert.ok(result.includes('description: Imported rule'));
    });
  });

  describe('mdcToMd', () => {
    it('strips frontmatter completely', () => {
      const mdc = '---\ndescription: Test\nglobs: \nalwaysApply: true\n---\nActual content';
      const result = mdcToMd(mdc);
      assert.equal(result, 'Actual content');
    });

    it('handles content without frontmatter', () => {
      const result = mdcToMd('Just plain content');
      assert.equal(result, 'Just plain content');
    });

    it('returns clean content without leading whitespace', () => {
      const mdc = '---\ndescription: Test\n---\n  \n  Content here';
      const result = mdcToMd(mdc);
      assert.ok(!result.startsWith(' '));
      assert.ok(!result.startsWith('\n'));
    });
  });

  describe('roundtrip', () => {
    it('mdcToMd(mdToMdc(content)) returns original content', () => {
      const original = '# My Rule\nDo the thing\n- step 1\n- step 2';
      const roundtripped = mdcToMd(mdToMdc(original));
      assert.equal(roundtripped, original);
    });
  });

  describe('filename conversions', () => {
    it('mdFilenameToMdc converts .md to .mdc', () => {
      assert.equal(mdFilenameToMdc('rules.md'), 'rules.mdc');
    });

    it('mdcFilenameToMd converts .mdc to .md', () => {
      assert.equal(mdcFilenameToMd('rules.mdc'), 'rules.md');
    });

    it('handles filenames with multiple dots', () => {
      assert.equal(mdFilenameToMdc('my.rule.file.md'), 'my.rule.file.mdc');
      assert.equal(mdcFilenameToMd('my.rule.file.mdc'), 'my.rule.file.md');
    });
  });
});
