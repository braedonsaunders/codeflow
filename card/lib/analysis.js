// Shared side-effect-free analysis pipeline used by the Action and headless CLI.

'use strict';

const fs = require('fs');
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

function validateRepoRoot(repoRoot) {
  let stats;
  try {
    stats = fs.statSync(repoRoot);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      throw new Error('Analysis path does not exist: ' + repoRoot);
    }
    throw new Error(
      'Analysis path is not accessible: ' + repoRoot +
        (error && error.code ? ' (' + error.code + ')' : '')
    );
  }
  if (!stats.isDirectory()) {
    throw new Error('Analysis path is not a directory: ' + repoRoot);
  }
  try {
    fs.accessSync(repoRoot, fs.constants.R_OK | fs.constants.X_OK);
  } catch (error) {
    throw new Error(
      'Analysis path is not readable: ' + repoRoot +
        (error && error.code ? ' (' + error.code + ')' : '')
    );
  }
}

async function analyze(options) {
  const opts = options || {};
  const repoRoot = path.resolve(opts.repoRoot || process.cwd());
  validateRepoRoot(repoRoot);
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

module.exports = { analyze, HEADLESS_SCHEMA_VERSION, normalizeExcludeInput, validateRepoRoot };
