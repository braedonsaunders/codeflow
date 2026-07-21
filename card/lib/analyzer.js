// Load the codeflow analyzer module. src/analyzer.js is the single source of
// truth (see docs/baseline.md) — this used to VM-extract a marker-delimited
// block from index.html's inline script; since MOO-67 Commit 3 the analyzer
// is a real ES module and Node 22.12+'s synchronous `require(esm)` support
// loads it directly, same as tests/*.test.mjs do via `import`.

'use strict';

const fs = require('fs');
const path = require('path');

function loadAnalyzer(htmlPath) {
  // htmlPath is index.html's location (see locateIndexHtml below); the
  // analyzer module is always its sibling src/analyzer.js — resolving
  // relative to htmlPath (not the consuming repo) preserves the security
  // property tests/card-analyzer-security.test.mjs guards: the action
  // always loads its own analyzer, never one from the repo being analyzed.
  const analyzerPath = path.resolve(path.dirname(htmlPath), 'src', 'analyzer.js');

  // Parser's methods reference these as ambient globals when actually
  // invoked (not at module-evaluation time) — stub them to `undefined` so a
  // reference doesn't throw, mirroring the browser's real CDN-provided
  // globals and tests/*.test.mjs's equivalent setup.
  if (!('TreeSitter' in globalThis)) globalThis.TreeSitter = undefined;
  if (!('Babel' in globalThis)) globalThis.Babel = undefined;
  if (!('acorn' in globalThis)) globalThis.acorn = undefined;

  const analyzerModule = require(analyzerPath);

  return {
    Parser: analyzerModule.Parser,
    buildAnalysisData: analyzerModule.buildAnalysisData,
    calcBlast: analyzerModule.calcBlast,
    calcHealth: analyzerModule.calcHealth,
  };
}

function locateIndexHtml(actionDir) {
  // Always load the analyzer from the action package, not the repository being analyzed.
  const adjacent = path.resolve(actionDir, '..', 'index.html');
  if (fs.existsSync(adjacent)) return adjacent;
  throw new Error(
    'Could not find CodeFlow analyzer source at ' + adjacent + '.'
  );
}

module.exports = { loadAnalyzer, locateIndexHtml };
