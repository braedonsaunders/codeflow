import assert from 'node:assert/strict';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Parser's methods reference these as ambient globals only when actually
// invoked (mirroring the browser's real CDN-provided globals) — see
// docs/baseline.md.
if (!('TreeSitter' in globalThis)) globalThis.TreeSitter = undefined;
if (!('Babel' in globalThis)) globalThis.Babel = undefined;
if (!('acorn' in globalThis)) globalThis.acorn = undefined;

const { Parser, buildAnalysisData } = await import('../src/analyzer.js');

function makeAnalyzedFile(path, content) {
  const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : 'root';
  const functions = Parser.extract(content, path);
  return {
    path,
    name: basename(path),
    folder,
    content,
    functions,
    lines: content.split('\n').length,
    layer: Parser.detectLayer(path),
    churn: 0,
    isCode: true,
  };
}

async function analyze(files) {
  const analyzed = files.map((file) => makeAnalyzedFile(file.path, file.content));
  const allFns = [];
  analyzed.forEach((file) => {
    file.functions.forEach((fn) => {
      allFns.push(Object.assign({}, fn, { folder: file.folder, layer: file.layer }));
    });
  });
  return buildAnalysisData({
    analyzed,
    allFns,
    excludePatterns: [],
    progress() {},
    yieldFn: async () => {},
  });
}

test('same-name functions in unrelated files do not create cross-file graph edges', async () => {
  const data = await analyze([
    {
      path: 'src/a.js',
      content: 'export function Keys() {\n  return "a";\n}\n',
    },
    {
      path: 'src/b.js',
      content: 'export function Keys() {\n  return "b";\n}\n\nexport function useB() {\n  return Keys();\n}\n',
    },
  ]);

  assert.equal(data.connections.some((conn) => conn.fn === 'Keys'), false);

  const stats = Object.values(data.fnStats).filter((stat) => stat.name === 'Keys');
  assert.equal(stats.length, 2);
  assert.equal(stats.find((stat) => stat.file === 'src/a.js').external, 0);
  assert.equal(stats.find((stat) => stat.file === 'src/b.js').internal > 0, true);
});

test('same-name cross-file calls resolve to the explicitly imported definition', async () => {
  const data = await analyze([
    {
      path: 'src/a.js',
      content: 'export function Keys() {\n  return "a";\n}\n',
    },
    {
      path: 'src/b.js',
      content: 'export function Keys() {\n  return "b";\n}\n',
    },
    {
      path: 'src/c.js',
      content: 'import { Keys } from "./a.js";\n\nexport function useImported() {\n  return Keys();\n}\n',
    },
  ]);

  assert.equal(data.connections.some((conn) => conn.source === 'src/a.js' && conn.target === 'src/c.js' && conn.fn === 'Keys'), true);
  assert.equal(data.connections.some((conn) => conn.source === 'src/b.js' && conn.target === 'src/c.js' && conn.fn === 'Keys'), false);

  const importedStat = Object.values(data.fnStats).find((stat) => stat.name === 'Keys' && stat.file === 'src/a.js');
  const unrelatedStat = Object.values(data.fnStats).find((stat) => stat.name === 'Keys' && stat.file === 'src/b.js');
  assert.equal(importedStat.external > 0, true);
  assert.equal(unrelatedStat.external, 0);
});
