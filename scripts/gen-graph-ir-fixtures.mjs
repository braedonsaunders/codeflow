// One-off generator for tests/fixtures/graph-ir/*.json (MOO-68 Commit 7).
// Not part of the test suite itself — run manually with
// `node scripts/gen-graph-ir-fixtures.mjs` after an intentional schema
// change, the same "regenerate, then commit" convention
// docs/baseline.md documents for tests/fixtures/baseline-snapshots/*.json.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeCoordinate, normalizeContext, makeGraphIR } from '../src/graph-ir/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'tests', 'fixtures', 'graph-ir');

const REPOSITORY = { host: 'github.com', owner: 'octocat', name: 'Hello-World' };
const SHA = 'deadbeef00deadbeef00deadbeef00deadbeef0';
const GENERATED_AT = '2026-07-21T00:00:00.000Z';
const context = normalizeContext({ owner: REPOSITORY.owner, repo: REPOSITORY.name, ref: 'main', resolvedSha: SHA });

function coord(overrides) {
  return makeCoordinate({ repository: REPOSITORY, revision: SHA, path: '', symbolKind: 'module', ...overrides });
}

// --- Repository layer: directories/files, coarse-grained import edges ---
const repositoryGraph = makeGraphIR({
  layer: 'repository',
  context,
  generatedAt: GENERATED_AT,
  rootCoordinate: null,
  analyzer: { name: 'codeflow-repository-adapter', version: '1.0.0' },
  confidence: 1,
  groups: [{ id: 'grp-src', layer: 'repository', label: 'src', parentGroupId: null }],
  nodes: [
    { id: 'dir-src', layer: 'repository', kind: 'directory', label: 'src', coordinate: coord({ path: 'src' }), groupId: null, hints: { shape: 'rect', layoutPreference: 'force' } },
    { id: 'file-app', layer: 'repository', kind: 'file', label: 'app.py', coordinate: coord({ path: 'src/app.py' }), groupId: 'grp-src', hints: { shape: 'circle', colorRole: 'entryPoint', isEntry: true } },
    { id: 'file-service', layer: 'repository', kind: 'file', label: 'service.py', coordinate: coord({ path: 'src/service.py' }), groupId: 'grp-src', hints: { shape: 'circle', colorRole: 'default' } },
  ],
  edges: [
    { id: 'imports-1', layer: 'repository', kind: 'imports', source: 'file-app', target: 'file-service', hints: { colorRole: 'default' } },
  ],
  warnings: [],
});

// --- File layer (pyan-style): functions/classes within one file, call edges ---
const fileGraph = makeGraphIR({
  layer: 'file',
  context,
  generatedAt: GENERATED_AT,
  rootCoordinate: coord({ path: 'src/service.py' }),
  analyzer: { name: 'pyan3', version: '1.2.3' },
  confidence: 0.92,
  groups: [{ id: 'grp-service-class', layer: 'file', label: 'Service', parentGroupId: null }],
  nodes: [
    {
      id: 'fn-main',
      layer: 'file',
      kind: 'function',
      label: 'main',
      coordinate: coord({ path: 'src/app.py', symbolPath: ['main'], symbolKind: 'function', range: { startLine: 1, startColumn: 0, endLine: 6, endColumn: 0 } }),
      groupId: null,
      hints: { shape: 'rect', colorRole: 'entryPoint', isEntry: true },
    },
    {
      id: 'fn-service-run',
      layer: 'file',
      kind: 'method',
      label: 'run',
      coordinate: coord({ path: 'src/service.py', symbolPath: ['Service', 'run'], symbolKind: 'method', range: { startLine: 10, startColumn: 4, endLine: 18, endColumn: 0 } }),
      groupId: 'grp-service-class',
      hints: { shape: 'rect', colorRole: 'default' },
    },
    {
      id: 'fn-unresolved-import',
      layer: 'file',
      kind: 'function',
      label: 'helper (unresolved import target)',
      coordinate: coord({ path: 'src/service.py', symbolPath: ['helper'], symbolKind: 'function', range: null, ambiguous: true }),
      groupId: null,
      hints: { shape: 'rect', colorRole: 'warning' },
    },
  ],
  edges: [
    { id: 'call-1', layer: 'file', kind: 'calls', source: 'fn-main', target: 'fn-service-run' },
    { id: 'call-2', layer: 'file', kind: 'calls', source: 'fn-service-run', target: 'fn-unresolved-import' },
  ],
  warnings: ['1 call target could not be resolved to a definite symbol'],
});

// --- Function layer (CodeVisualizer-style): control-flow graph for one function ---
const functionGraph = makeGraphIR({
  layer: 'function',
  context,
  generatedAt: GENERATED_AT,
  rootCoordinate: coord({ path: 'src/service.py', symbolPath: ['Service', 'run'], symbolKind: 'method', range: { startLine: 10, startColumn: 4, endLine: 18, endColumn: 0 } }),
  analyzer: { name: 'codevisualizer', version: '0.9.0' },
  confidence: 1,
  nodes: [
    { id: 'entry', layer: 'function', kind: 'entry', label: 'entry', coordinate: null, groupId: null, hints: { shape: 'circle', isEntry: true, layoutPreference: 'hierarchical' } },
    {
      id: 'stmt-check',
      layer: 'function',
      kind: 'branch',
      label: 'if self.ready',
      coordinate: coord({ path: 'src/service.py', symbolPath: ['Service', 'run'], symbolKind: 'method', range: { startLine: 12, startColumn: 8, endLine: 12, endColumn: 24 } }),
      groupId: null,
      hints: { shape: 'diamond', colorRole: 'default' },
    },
    {
      id: 'stmt-call',
      layer: 'function',
      kind: 'call',
      label: 'self.execute()',
      coordinate: coord({ path: 'src/service.py', symbolPath: ['Service', 'run'], symbolKind: 'method', range: { startLine: 13, startColumn: 12, endLine: 13, endColumn: 27 } }),
      groupId: null,
      hints: { shape: 'rect', colorRole: 'default' },
    },
    { id: 'exit', layer: 'function', kind: 'exit', label: 'exit', coordinate: null, groupId: null, hints: { shape: 'circle', isExit: true } },
  ],
  edges: [
    { id: 'flow-1', layer: 'function', kind: 'flow', source: 'entry', target: 'stmt-check' },
    { id: 'flow-2', layer: 'function', kind: 'flow-true', source: 'stmt-check', target: 'stmt-call' },
    { id: 'flow-3', layer: 'function', kind: 'flow-false', source: 'stmt-check', target: 'exit' },
    { id: 'flow-4', layer: 'function', kind: 'flow', source: 'stmt-call', target: 'exit' },
  ],
  warnings: [],
});

writeFileSync(join(outDir, 'repository.json'), JSON.stringify(repositoryGraph, null, 2) + '\n');
writeFileSync(join(outDir, 'file-pyan.json'), JSON.stringify(fileGraph, null, 2) + '\n');
writeFileSync(join(outDir, 'function-codevisualizer.json'), JSON.stringify(functionGraph, null, 2) + '\n');
console.log('Wrote repository.json, file-pyan.json, function-codevisualizer.json');
