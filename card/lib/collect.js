// Walk a repo and collect file content + parsed functions, mirroring the shape
// the analyzer expects (see tests/codeflow-golden.test.mjs analyzeFixture).

'use strict';

const fs = require('fs');
const path = require('path');

const { matchesExcludePattern } = require('./exclude.js');

const DEFAULT_IGNORES = new Set([
  '.git',
  'node_modules',
  'vendor',
  '.next',
  '.nuxt',
  'dist',
  'build',
  'out',
  'coverage',
  '.cache',
  '.parcel-cache',
  '.turbo',
  '.vercel',
  '.idea',
  '.vscode',
  '__pycache__',
  '.venv',
  'venv',
  'target',
  'bin',
  'obj',
]);

function walk(root, current, files, Parser, excludePatterns) {
  let entries;
  try {
    entries = fs.readdirSync(current, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.git')) continue;
    if (DEFAULT_IGNORES.has(entry.name)) continue;
    const full = path.join(current, entry.name);
    const repoPath = path.relative(root, full).split(path.sep).join('/');
    // Prune excluded paths during the walk — exclusion must happen before
    // Parser.extract/buildAnalysisData ever see the files, or huge vendored
    // trees (minified bundles, absorbed third-party code) blow the analysis
    // phase up from seconds to hours.
    if (matchesExcludePattern(excludePatterns, repoPath, entry.name)) continue;
    if (entry.isDirectory()) {
      walk(root, full, files, Parser, excludePatterns);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!Parser.isIncluded(entry.name)) continue;
    files.push({
      fullPath: full,
      path: repoPath,
      name: path.basename(repoPath),
      folder: repoPath.includes('/') ? repoPath.slice(0, repoPath.lastIndexOf('/')) : 'root',
      isCode: Parser.isCode(entry.name),
    });
  }
}

async function buildAnalyzed(repoRoot, Parser, excludePatterns) {
  const files = [];
  walk(repoRoot, repoRoot, files, Parser, excludePatterns || []);
  files.sort((a, b) => a.path.localeCompare(b.path));

  const analyzed = [];
  const allFns = [];
  for (const file of files) {
    let content;
    try {
      content = fs.readFileSync(file.fullPath, 'utf8');
    } catch {
      continue;
    }
    const layer = Parser.detectLayer(file.path);
    const isContainer = Parser.isScriptContainer(file.path);
    const actualIsCode =
      file.isCode !== false && (!isContainer || Parser.hasEmbeddedCode(content, file.path));
    const functions = actualIsCode ? Parser.extract(content, file.path) : [];
    analyzed.push({
      path: file.path,
      name: file.name,
      folder: file.folder,
      content,
      functions,
      lines: content ? content.split('\n').length : 0,
      layer,
      churn: 0,
      isCode: actualIsCode,
    });
    if (actualIsCode) {
      for (const fn of functions) {
        allFns.push(Object.assign({}, fn, { folder: file.folder, layer }));
      }
    }
  }
  return { analyzed, allFns };
}

module.exports = { buildAnalyzed };
