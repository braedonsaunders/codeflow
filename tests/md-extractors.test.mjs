import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { extractMarkdownLinks, resolveMarkdownLink } from './md-extractors.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VAULT = join(__dirname, 'fixtures', 'vault');
const read = (name) => readFileSync(join(VAULT, name), 'utf8');

// All fixture paths as the scanner would see them (relative, forward slashes).
const ALL_PATHS = readdirSync(VAULT).filter(n => n.endsWith('.md')).sort();

test('extractMarkdownLinks finds a wikilink', () => {
  const links = extractMarkdownLinks(read('note-with-wikilink.md'));
  const wikilinks = links.filter(l => l.kind === 'wikilink');
  assert.ok(wikilinks.length >= 1, 'expected at least one wikilink');
  assert.equal(wikilinks[0].target, 'target-note');
});

test('extractMarkdownLinks strips |alias and #heading from wikilinks', () => {
  const links = extractMarkdownLinks(read('note-with-wikilink.md'));
  const targets = links.filter(l => l.kind === 'wikilink').map(l => l.target);
  // All three forms ([[X]], [[X|alias]], [[X#heading]]) resolve to bare "target-note"
  assert.deepEqual([...new Set(targets)], ['target-note']);
  assert.equal(targets.length, 3);
});

test('extractMarkdownLinks finds a markdown link', () => {
  const links = extractMarkdownLinks(read('note-with-mdlink.md'));
  const mdlinks = links.filter(l => l.kind === 'mdlink');
  assert.ok(mdlinks.length >= 1, 'expected at least one mdlink');
  // Both ./target-note.md and target-note.md should appear
  const targets = mdlinks.map(l => l.target);
  assert.ok(targets.includes('./target-note.md'));
  assert.ok(targets.includes('target-note.md'));
});

test('extractMarkdownLinks finds both kinds in one note', () => {
  const links = extractMarkdownLinks(read('note-with-both.md'));
  assert.equal(links.filter(l => l.kind === 'wikilink').length, 1);
  assert.equal(links.filter(l => l.kind === 'mdlink').length, 1);
});

test('extractMarkdownLinks ignores links inside fenced code blocks and inline code', () => {
  const links = extractMarkdownLinks(read('note-with-code-fence.md'));
  // Only the real [[target-note]] should match
  assert.equal(links.length, 1);
  assert.equal(links[0].kind, 'wikilink');
  assert.equal(links[0].target, 'target-note');
});

test('extractMarkdownLinks ignores external http(s), mailto, anchor-only, and image links', () => {
  const links = extractMarkdownLinks(read('note-with-external.md'));
  // Only the real [click](./target-note.md) - not Google, not mailto, not #heading, not ![pic]
  assert.equal(links.length, 1);
  assert.equal(links[0].kind, 'mdlink');
  assert.equal(links[0].target, './target-note.md');
});

test('resolveMarkdownLink resolves a wikilink to the basename match', () => {
  const resolved = resolveMarkdownLink('target-note', 'note-with-wikilink.md', ALL_PATHS, 'wikilink');
  assert.equal(resolved, 'target-note.md');
});

test('resolveMarkdownLink resolves a relative md-link', () => {
  const resolved = resolveMarkdownLink('./target-note.md', 'note-with-mdlink.md', ALL_PATHS, 'mdlink');
  assert.equal(resolved, 'target-note.md');
});

test('resolveMarkdownLink resolves a bare md-link without leading ./', () => {
  const resolved = resolveMarkdownLink('target-note.md', 'note-with-mdlink.md', ALL_PATHS, 'mdlink');
  assert.equal(resolved, 'target-note.md');
});

test('resolveMarkdownLink returns null for a dead wikilink', () => {
  const resolved = resolveMarkdownLink('does-not-exist', 'note-with-dead-link.md', ALL_PATHS, 'wikilink');
  assert.equal(resolved, null);
});

test('resolveMarkdownLink returns null for a dead md-link', () => {
  const resolved = resolveMarkdownLink('./also-missing.md', 'note-with-dead-link.md', ALL_PATHS, 'mdlink');
  assert.equal(resolved, null);
});

test('resolveMarkdownLink handles nested subdirectory md-link with ../', () => {
  const paths = ['notes/a/foo.md', 'notes/b/bar.md'];
  const resolved = resolveMarkdownLink('../b/bar.md', 'notes/a/foo.md', paths, 'mdlink');
  assert.equal(resolved, 'notes/b/bar.md');
});

test('resolveMarkdownLink falls back to basename when relative path misses', () => {
  const paths = ['deep/nested/target-note.md', 'other.md'];
  const resolved = resolveMarkdownLink('target-note', 'other.md', paths, 'wikilink');
  assert.equal(resolved, 'deep/nested/target-note.md');
});

test('extractMarkdownLinks handles nested brackets in mdlink text', () => {
  // Obsidian renders [foo [bar] baz](./target-note.md) as one link.
  const links = extractMarkdownLinks('Ref: [foo [bar] baz](./target-note.md).');
  const mdlinks = links.filter(l => l.kind === 'mdlink');
  assert.equal(mdlinks.length, 1);
  assert.equal(mdlinks[0].target, './target-note.md');
});

test('extractMarkdownLinks strips tilde-fenced code blocks', () => {
  const content = 'Keep: [[real]].\n~~~\n[[skip-tilde]]\n~~~\n';
  const links = extractMarkdownLinks(content);
  assert.equal(links.length, 1);
  assert.equal(links[0].target, 'real');
});

test('resolveMarkdownLink handles absolute path mdlinks', () => {
  const paths = ['docs/intro.md', 'readme.md'];
  const resolved = resolveMarkdownLink('/docs/intro.md', 'readme.md', paths, 'mdlink');
  assert.equal(resolved, 'docs/intro.md');
});

test('resolveMarkdownLink resolves extensionless targets to .markdown files', () => {
  const paths = ['docs/guide.markdown', 'readme.md'];
  assert.equal(resolveMarkdownLink('guide', 'readme.md', paths, 'wikilink'), 'docs/guide.markdown');
  assert.equal(resolveMarkdownLink('./guide', 'docs/readme.md', paths, 'mdlink'), 'docs/guide.markdown');
});
