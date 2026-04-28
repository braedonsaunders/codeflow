// Extract the codeflow analyzer block from index.html and run it in a Node vm
// context. Mirrors what tests/codeflow-golden.test.mjs does — the analyzer is
// the single source of truth, lives in one file, never drifts.

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const START_MARKER = '// ===== CODEFLOW_ANALYZER_START =====';
const END_MARKER = '// ===== CODEFLOW_ANALYZER_END =====';
const METRICS_START = '// ===== CODEFLOW_METRICS_START =====';
const METRICS_END = '// ===== CODEFLOW_METRICS_END =====';

function sliceBlock(html, startMarker, endMarker, label) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start);
  if (start < 0 || end < 0) {
    throw new Error(
      'Could not locate ' + label + ' block. Expected ' + startMarker + ' / ' + endMarker + '.'
    );
  }
  return html.slice(start, end);
}

function loadAnalyzer(htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const analyzerSource = sliceBlock(html, START_MARKER, END_MARKER, 'analyzer');
  const metricsSource = sliceBlock(html, METRICS_START, METRICS_END, 'metrics');

  const context = {
    console,
    TreeSitter: undefined,
    Babel: undefined,
    acorn: undefined,
    getSecurityScanContent(file) {
      return file && file.content ? file.content : '';
    },
    isSanitizedPreviewRenderer() {
      return false;
    },
  };
  vm.createContext(context);
  const exposeExports =
    '\nthis.Parser = Parser;' +
    '\nthis.buildAnalysisData = buildAnalysisData;' +
    '\nthis.calcBlast = calcBlast;' +
    '\nthis.calcHealth = calcHealth;';
  vm.runInContext(analyzerSource + '\n' + metricsSource + exposeExports, context, {
    filename: 'codeflow-analyzer.js',
  });

  return {
    Parser: context.Parser,
    buildAnalysisData: context.buildAnalysisData,
    calcBlast: context.calcBlast,
    calcHealth: context.calcHealth,
  };
}

function locateIndexHtml(actionDir, repoRoot) {
  // 1) Adjacent to the Action (same repo as codeflow itself):
  const adjacent = path.join(actionDir, '..', 'index.html');
  if (fs.existsSync(adjacent)) return adjacent;
  // 2) Repo root (when the Action is run from inside codeflow's checkout):
  const local = path.join(repoRoot, 'index.html');
  if (fs.existsSync(local)) return local;
  throw new Error(
    'Could not find index.html. Tried ' + adjacent + ' and ' + local + '.'
  );
}

module.exports = { loadAnalyzer, locateIndexHtml, START_MARKER, END_MARKER };
