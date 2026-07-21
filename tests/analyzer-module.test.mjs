// Regression test for a gap found while building MOO-67 Commit 6:
// GitHub.scan/scanRecursive call shouldExcludeFile/shouldIgnoreDirectory,
// which were left behind in index.html during the Commit 3 extraction and
// only "worked" in the browser by accident (window-fallthrough). This
// doesn't hit the network -- it just proves the functions GitHub.scan
// depends on are real, callable exports of src/analyzer.js, not ambient
// globals that happen to exist only in a browser.
import assert from 'node:assert/strict';
import test from 'node:test';

if (!('TreeSitter' in globalThis)) globalThis.TreeSitter = undefined;
if (!('Babel' in globalThis)) globalThis.Babel = undefined;
if (!('acorn' in globalThis)) globalThis.acorn = undefined;

const { GitHub, shouldExcludeFile, shouldIgnoreDirectory, matchesExcludePattern, normalizeExcludePath } =
  await import('../src/analyzer.js');

test('src/analyzer.js exports the exclude-matching helpers GitHub.scan depends on', () => {
  assert.equal(typeof shouldExcludeFile, 'function');
  assert.equal(typeof shouldIgnoreDirectory, 'function');
  assert.equal(typeof matchesExcludePattern, 'function');
  assert.equal(typeof normalizeExcludePath, 'function');
});

test('shouldIgnoreDirectory recognizes well-known vendored/build directories', () => {
  assert.equal(shouldIgnoreDirectory('node_modules', 'node_modules', []), true);
  assert.equal(shouldIgnoreDirectory('src', 'src', []), false);
});

test('shouldExcludeFile respects Parser.isIncluded and compiled exclude patterns', () => {
  assert.equal(shouldExcludeFile('README.md', 'README.md', []), false);
  assert.equal(shouldExcludeFile('a.exe', 'a.exe', []), true);
});

test("GitHub object exposes scan/getFile — the methods a server-side caller (server/lib/analyzer-bridge or a future one) needs, and doesn't throw evaluating its own dependencies", () => {
  assert.equal(typeof GitHub.scan, 'function');
  assert.equal(typeof GitHub.getFile, 'function');
});
