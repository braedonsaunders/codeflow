import assert from 'node:assert/strict';
import test from 'node:test';

// Parser's methods reference these as ambient globals only when actually
// invoked (mirroring the browser's real CDN-provided globals) — see
// docs/baseline.md.
if (!('TreeSitter' in globalThis)) globalThis.TreeSitter = undefined;
if (!('Babel' in globalThis)) globalThis.Babel = undefined;
if (!('acorn' in globalThis)) globalThis.acorn = undefined;

const { Parser, buildAnalysisData } = await import('../src/analyzer.js');

// Regression for issues #54 and #52: a numeric object-literal key like
// `{ 42: function () {} }` made the JS AST walker push a number into
// `fn.name`. Downstream `buildFunctionNameIndex` then called
// `fn.indexOf('.')` and threw "fn.indexOf is not a function", aborting the
// entire analysis ("Analysis failed: fn.indexOf is not a function" /
// "Failed to analyze ZIP archive: fn.indexOf is not a function").
test('buildFunctionNameIndex tolerates non-string entries', () => {
  const index = Parser.buildFunctionNameIndex([42, null, undefined, '', 'foo', 'Bar.baz']);
  assert.ok(index.exact.has('foo'));
  assert.ok(index.exact.has('Bar.baz'));
  assert.ok(!index.exact.has(42));
  assert.ok(!index.exact.has(''));
  assert.equal(index.byBase.baz.length, 1);
  assert.equal(index.byBase.baz[0], 'Bar.baz');
});

test('buildAnalysisData survives a function entry with a numeric name', async () => {
  const analyzed = [{
    path: 'src/file.js',
    name: 'file.js',
    folder: 'src',
    layer: 'utils',
    content: 'export const obj = { 42: function () { return 1; } };',
    functions: [],
    lines: 1,
    churn: 0,
    isCode: true,
  }];
  const allFns = [
    { name: 42, file: 'src/file.js', folder: 'src', layer: 'utils', line: 1, code: '42: function () { return 1; }', isTopLevel: false, type: 'method' },
    { name: 'helper', file: 'src/file.js', folder: 'src', layer: 'utils', line: 1, code: '', isTopLevel: true, type: 'function' },
  ];
  const data = await buildAnalysisData({
    analyzed,
    allFns,
    excludePatterns: [],
    progress() {},
    yieldFn: async () => {},
  });
  assert.equal(data.stats.files, 1);
  assert.ok(data.functions.some((fn) => fn.name === 'helper'));
});
