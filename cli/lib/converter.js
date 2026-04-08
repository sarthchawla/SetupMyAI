/**
 * Convert Claude .md rule content to Cursor .mdc format.
 * Wraps content in mdc frontmatter block.
 */
export function mdToMdc(mdContent, metadata = {}) {
  const description = metadata.description || extractDescription(mdContent);
  const globs = metadata.globs || '';
  const alwaysApply = metadata.alwaysApply !== undefined ? metadata.alwaysApply : true;

  const frontmatter = [
    '---',
    `description: ${description}`,
    `globs: ${globs}`,
    `alwaysApply: ${alwaysApply}`,
    '---',
  ].join('\n');

  return `${frontmatter}\n${mdContent}`;
}

/**
 * Convert Cursor .mdc content back to plain .md by stripping frontmatter.
 */
export function mdcToMd(mdcContent) {
  const fmRegex = /^---\n[\s\S]*?\n---\n?/;
  return mdcContent.replace(fmRegex, '').trimStart();
}

/**
 * Extract a description from the first heading or first line of md content.
 */
function extractDescription(mdContent) {
  const headingMatch = mdContent.match(/^#\s+(.+)$/m);
  if (headingMatch) return headingMatch[1].trim();

  const firstLine = mdContent.split('\n').find((l) => l.trim().length > 0);
  return firstLine ? firstLine.trim().slice(0, 80) : 'Imported rule';
}

/**
 * Convert filename: rule-name.md -> rule-name.mdc and vice versa.
 */
export function mdFilenameToMdc(filename) {
  return filename.replace(/\.md$/, '.mdc');
}

export function mdcFilenameToMd(filename) {
  return filename.replace(/\.mdc$/, '.md');
}
