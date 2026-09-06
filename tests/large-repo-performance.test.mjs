import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const { loadAnalyzer } = require(join(__dirname, '..', 'card', 'lib', 'analyzer.js'));

test('bounded duplicate similarity keeps near-copies distinct from unrelated code', () => {
  const { Parser } = loadAnalyzer(join(__dirname, '..', 'index.html'));
  const first = 'function processAlpha(items) { const out = []; for (const item of items) { if (item.ok) out.push(item.id); } return out; }';
  const renamed = 'function processBeta(rows) { const result = []; for (const row of rows) { if (row.ok) result.push(row.id); } return result; }';
  const unrelated = 'async function fetchUser(id) { const response = await fetch(`/users/${id}`); return response.json(); }';

  assert.ok(Parser.codeSimilarity(first, renamed) > 0.7);
  assert.ok(Parser.codeSimilarity(first, unrelated) < 0.5);
});

test('large mixed repositories index paths once and never call-scan non-code assets', async () => {
  const { Parser, buildAnalysisData } = loadAnalyzer(join(__dirname, '..', 'index.html'));
  const repeatedData = '{"snapshot":"targetCall()"}\n'.repeat(150);
  const analyzed = Array.from({ length: 3000 }, (_, index) => ({
    path: `artifacts/snapshot-${index}.json`,
    name: `snapshot-${index}.json`,
    folder: 'artifacts',
    content: repeatedData,
    functions: [],
    lines: 150,
    layer: 'data',
    churn: 0,
    isCode: false,
  }));

  const targetFn = {
    name: 'targetCall',
    file: 'src/target.js',
    folder: 'src',
    layer: 'utils',
    line: 1,
    code: 'export function targetCall() {}',
    isTopLevel: true,
    isExported: true,
    type: 'function',
  };
  analyzed.push(
    {
      path: 'src/target.js',
      name: 'target.js',
      folder: 'src',
      content: targetFn.code,
      functions: [targetFn],
      lines: 1,
      layer: 'utils',
      churn: 0,
      isCode: true,
    },
    {
      path: 'src/caller.js',
      name: 'caller.js',
      folder: 'src',
      content: "import { targetCall } from './target.js';\ntargetCall();",
      functions: [],
      lines: 2,
      layer: 'services',
      churn: 0,
      isCode: true,
    }
  );

  let pathIndexBuilds = 0;
  let callScans = 0;
  const originalBuildPathIndex = Parser.buildCallGraphPathIndex;
  const originalFindCalls = Parser.findCalls;
  Parser.buildCallGraphPathIndex = function(files) {
    pathIndexBuilds += 1;
    return originalBuildPathIndex.call(Parser, files);
  };
  Parser.findCalls = function(...args) {
    callScans += 1;
    return originalFindCalls.apply(Parser, args);
  };

  const started = Date.now();
  const data = await buildAnalysisData({
    analyzed,
    allFns: [targetFn],
    progress() {},
    yieldFn: async () => {},
  });
  const durationMs = Date.now() - started;

  assert.equal(pathIndexBuilds, 1, 'the repository path map should be built once');
  assert.equal(callScans, 2, 'only actual code files should enter call analysis');
  assert.equal(
    data.connections.some((connection) =>
      connection.source === 'src/target.js' && connection.target === 'src/caller.js'
    ),
    true,
    'indexed import resolution should preserve dependency edges'
  );
  // Wall-clock guard only: CI runners can spike ~2s on this 3k-file fixture.
  // The path-index and call-scan counts above catch a real analysis regression.
  assert.ok(durationMs < 4000, `synthetic 3k-file analysis took ${durationMs}ms`);
});
