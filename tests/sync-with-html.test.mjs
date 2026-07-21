// Enforces that `Parser.extractMarkdownLinks` / `Parser.resolveMarkdownLink`
// in src/analyzer.js produce identical output to the source-of-truth
// implementation in tests/md-extractors.mjs. This prevents silent drift
// across the two copies that the "Keep in sync" comments rely on.
//
// This used to read index.html; that source moved to src/analyzer.js in
// MOO-67 Commit 3 (see docs/baseline.md) — only the read target changed,
// the method-body slicing below is source-agnostic.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import {
  extractMarkdownLinks as refExtract,
  resolveMarkdownLink as refResolve,
} from './md-extractors.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'src', 'analyzer.js'), 'utf8');

// Pull the two method bodies from src/analyzer.js. They live as
// `extractMarkdownLinks:function(...)` entries inside the Parser object,
// separated by a comma before the next method.
function sliceMethod(source, name) {
  const needle = `${name}:function`;
  const start = source.indexOf(needle);
  if (start < 0) throw new Error(`couldn't find ${name} in src/analyzer.js`);
  // Find the opening brace of the function body.
  const openParen = source.indexOf('(', start);
  const closeParen = source.indexOf(')', openParen);
  const openBrace = source.indexOf('{', closeParen);
  // Walk braces to find the matching close.
  let depth = 0;
  let i = openBrace;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return source.slice(start, i);
}

const extractSrc = sliceMethod(html, 'extractMarkdownLinks');
const resolveSrc = sliceMethod(html, 'resolveMarkdownLink');

// Wrap the two methods as a standalone object we can invoke.
const script = new vm.Script(`
(function(){
  var Parser = { ${extractSrc}, ${resolveSrc} };
  return Parser;
})()
`);
const htmlParser = script.runInNewContext({});

const vaultPaths = ['target-note.md', 'note.md', 'deep/nested/target-note.md', 'docs/intro.md', 'docs/guide.markdown', 'docs/readme.md'];
const cases = [
  { content: 'See [[target-note]] and [[foo|bar]] and [[baz#h]].' },
  { content: 'Link: [click](./target-note.md) and image ![x](./y.png) and [g](https://g.com).' },
  { content: 'Nested: [foo [bar] baz](./target-note.md).' },
  { content: 'Fences:\n```\n[[skip-a]]\n```\n~~~\n[[skip-b]]\n~~~\n`[[skip-c]]` Real: [[keep]].' },
];

const J = (v) => JSON.parse(JSON.stringify(v));

test('index.html extractMarkdownLinks matches tests/md-extractors.mjs', () => {
  for (const c of cases) {
    assert.deepStrictEqual(J(htmlParser.extractMarkdownLinks(c.content)), J(refExtract(c.content)));
  }
});

const resolveCases = [
  ['target-note', 'note.md', 'wikilink'],
  ['./target-note.md', 'note.md', 'mdlink'],
  ['target-note.md', 'note.md', 'mdlink'],
  ['/docs/intro.md', 'note.md', 'mdlink'],
  ['does-not-exist', 'note.md', 'wikilink'],
  ['../nested/target-note.md', 'deep/other.md', 'mdlink'],
  ['guide', 'readme.md', 'wikilink'],
  ['./guide', 'docs/readme.md', 'mdlink'],
];
test('index.html resolveMarkdownLink matches tests/md-extractors.mjs', () => {
  for (const [t, f, k] of resolveCases) {
    assert.equal(htmlParser.resolveMarkdownLink(t, f, vaultPaths, k), refResolve(t, f, vaultPaths, k));
  }
});
