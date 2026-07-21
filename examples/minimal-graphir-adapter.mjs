// Minimal example adapter — MOO-68 Commit 7.
//
// Demonstrates that a GraphIR-producing adapter needs nothing from this
// application beyond the contract itself: every import below resolves to
// src/graph-ir/*, never src/analyzer.js, server/*, or any UI code. A real
// adapter (MOO-70's pyan3 bridge, MOO-71's CodeVisualizer bridge) will
// additionally run an external tool and translate its output into these
// same shapes; this one fabricates a tiny synthetic "analyzer output" in
// its place so the example stays runnable with no external dependency.
//
// Run directly: `node examples/minimal-graphir-adapter.mjs`
import { pathToFileURL } from 'node:url';
import {
  makeCoordinate,
  normalizeContext,
  makeGraphIR,
  buildAdapterResult,
  buildCacheKey,
  buildProvenanceSummary,
  createDrillDownEvent,
  createSelectionEvent,
} from '../src/graph-ir/index.js';

const REPOSITORY = { host: 'github.com', owner: 'octocat', name: 'Hello-World' };
const RESOLVED_SHA = 'deadbeef00deadbeef00deadbeef00deadbeef0';

// Stand-in for whatever a real external analyzer would hand back.
const fakeAnalyzerOutput = {
  files: ['src/app.py', 'src/service.py'],
  functions: [
    { file: 'src/service.py', scope: ['Service', 'run'], startLine: 10, endLine: 18 },
    { file: 'src/app.py', scope: ['main'], startLine: 1, endLine: 6 },
  ],
  calls: [{ from: ['main'], to: ['Service', 'run'] }],
};

function produce() {
  const startedAt = new Date().toISOString();
  const context = normalizeContext({ owner: REPOSITORY.owner, repo: REPOSITORY.name, resolvedSha: RESOLVED_SHA });

  const nodesByScopeKey = new Map();
  const nodes = fakeAnalyzerOutput.functions.map((fn, index) => {
    const coordinate = makeCoordinate({
      repository: REPOSITORY,
      revision: RESOLVED_SHA,
      path: fn.file,
      symbolPath: fn.scope,
      symbolKind: fn.scope.length > 1 ? 'method' : 'function',
      range: { startLine: fn.startLine, startColumn: 0, endLine: fn.endLine, endColumn: 0 },
      ambiguous: false,
    });
    const node = {
      id: `fn${index}`,
      layer: 'file',
      kind: 'function',
      label: fn.scope[fn.scope.length - 1],
      coordinate,
      groupId: null,
      hints: { shape: 'rect', colorRole: index === 0 ? 'entryPoint' : 'default' },
    };
    nodesByScopeKey.set(fn.scope.join('.'), node);
    return node;
  });

  const edges = fakeAnalyzerOutput.calls.map((call, index) => ({
    id: `call${index}`,
    layer: 'file',
    kind: 'calls',
    source: nodesByScopeKey.get(call.from.join('.')).id,
    target: nodesByScopeKey.get(call.to.join('.')).id,
  }));

  const graph = makeGraphIR({
    layer: 'file',
    context,
    rootCoordinate: makeCoordinate({ repository: REPOSITORY, revision: RESOLVED_SHA, path: 'src/service.py', symbolKind: 'module' }),
    analyzer: { name: 'example-adapter', version: '0.0.1' },
    confidence: 1,
    nodes,
    edges,
    warnings: [],
  });

  return buildAdapterResult({
    graph,
    warnings: [],
    provenance: { analyzerName: 'example-adapter', analyzerVersion: '0.0.1' },
    timing: { startedAt, durationMs: Date.now() - Date.parse(startedAt) },
    cache: {
      key: buildCacheKey({ context, analyzerName: 'example-adapter', analyzerVersion: '0.0.1', graphSchemaVersion: graph.schemaVersion }),
      hit: false,
    },
  });
}

function consume(result) {
  const summary = buildProvenanceSummary(result.graph);
  const entryNode = result.graph.nodes.find((n) => n.hints && n.hints.colorRole === 'entryPoint');
  const selection = createSelectionEvent(entryNode.id, entryNode.coordinate);
  const drillDown = createDrillDownEvent(entryNode.coordinate, 'file');
  return { summary, selection, drillDown };
}

function main() {
  const result = produce();
  const consumed = consume(result);
  console.log(JSON.stringify({ nodeCount: result.graph.nodes.length, ...consumed }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

export { produce, consume };
