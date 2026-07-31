// Shared side-effect-free analysis pipeline used by the Action and headless CLI.

'use strict';

const path = require('path');

const { loadAnalyzer, locateIndexHtml } = require('./analyzer.js');
const { buildAnalyzed } = require('./collect.js');
const { compileExcludePatterns } = require('./exclude.js');
const { snapshotFromAnalysis } = require('./state.js');

const HEADLESS_SCHEMA_VERSION = 1;

function normalizeExcludeInput(exclude) {
  if (Array.isArray(exclude)) return exclude.join(',');
  return exclude == null ? '' : String(exclude);
}

async function analyze(options) {
  const opts = options || {};
  const repoRoot = path.resolve(opts.repoRoot || process.cwd());
  const actionDir = path.resolve(opts.actionDir || path.join(__dirname, '..'));
  const progress = typeof opts.progress === 'function' ? opts.progress : () => {};
  const indexHtmlPath = opts.indexHtmlPath || locateIndexHtml(actionDir, repoRoot);

  progress('analyzer source: ' + indexHtmlPath);
  const { Parser, buildAnalysisData, calcBlast, calcHealth } = loadAnalyzer(indexHtmlPath);
  const excludePatterns = compileExcludePatterns(normalizeExcludeInput(opts.exclude));
  if (excludePatterns.length > 0) {
    progress('exclude patterns: ' + excludePatterns.map((pattern) => pattern.raw).join(', '));
  }

  const { analyzed, allFns } = await buildAnalyzed(repoRoot, Parser, excludePatterns);
  progress('collected ' + analyzed.length + ' files (' + allFns.length + ' functions)');

  const data = await buildAnalysisData({
    analyzed,
    allFns,
    excludePatterns: excludePatterns.map((pattern) => pattern.raw),
    progress: (message) => progress(message),
    yieldFn: async () => {},
  });
  progress(
    'analysis: files=' + data.stats.files +
      ' fns=' + data.stats.functions +
      ' loc=' + data.stats.loc
  );

  const snapshot = snapshotFromAnalysis(
    data,
    { calcBlast, calcHealth },
    opts.context || {}
  );
  progress(
    'grade=' + (snapshot.grade || '?') +
      ' score=' + (snapshot.score == null ? '?' : snapshot.score)
  );

  return { schemaVersion: HEADLESS_SCHEMA_VERSION, data, snapshot };
}

module.exports = { analyze, HEADLESS_SCHEMA_VERSION, normalizeExcludeInput };
