// Analysis pipeline for the /api/analyze endpoint — MOO-67 Commit 5.
//
// Reuses existing code rather than writing a fourth copy of "collect files
// from a directory + run Parser.extract" (codeflow-repo-smoke.mjs,
// card/lib/collect.js, and tests/codeflow-golden.test.mjs's fixture
// harness already each have a version of this): card/lib/collect.js's
// buildAnalyzed() for file collection, src/analyzer.js for the actual
// analyzer, same as card/lib/analyzer.js and every Node test.
import { buildAnalyzed } from '../../card/lib/collect.js';

// Parser's methods reference these as ambient globals only when actually
// invoked (mirroring the browser's real CDN-provided globals) — see
// docs/baseline.md.
if (!('TreeSitter' in globalThis)) globalThis.TreeSitter = undefined;
if (!('Babel' in globalThis)) globalThis.Babel = undefined;
if (!('acorn' in globalThis)) globalThis.acorn = undefined;

const { Parser, buildAnalysisData } = await import('../../src/analyzer.js');

/** @param {string} dir - absolute path to a directory to analyze */
export async function analyzeDirectory(dir) {
  const { analyzed, allFns } = await buildAnalyzed(dir, Parser, []);
  return buildAnalysisData({
    analyzed,
    allFns,
    excludePatterns: [],
    progress() {},
    yieldFn: async () => {},
  });
}
