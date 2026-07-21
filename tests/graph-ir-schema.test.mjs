// Unit tests for src/graph-ir/graphIR.js (MOO-68 Commit 3).
import assert from 'node:assert/strict';
import test from 'node:test';

const { makeGraphIR, validateGraphIR, GraphIRError, GRAPH_IR_SCHEMA_VERSION } = await import('../src/graph-ir/graphIR.js');
const { makeCoordinate } = await import('../src/graph-ir/sourceCoordinate.js');
const { normalizeContext } = await import('../src/graph-ir/githubContext.js');

const SHA = 'a'.repeat(40);
const CONTEXT = normalizeContext({ owner: 'octocat', repo: 'Hello-World', resolvedSha: SHA });
const REPOSITORY = { host: 'github.com', owner: 'octocat', name: 'Hello-World' };

function coord(overrides) {
  return makeCoordinate({ repository: REPOSITORY, revision: SHA, path: 'src/app.py', symbolKind: 'module', ...overrides });
}

function baseGraphInput(layer, overrides) {
  return {
    layer,
    context: CONTEXT,
    analyzer: { name: 'pyan3', version: '1.2.3' },
    confidence: 1,
    nodes: [],
    edges: [],
    ...overrides,
  };
}

test('a minimal repository-layer graph validates', () => {
  const graph = makeGraphIR(
    baseGraphInput('repository', {
      nodes: [{ id: 'n1', layer: 'repository', kind: 'directory', label: 'src', coordinate: null, groupId: null }],
    })
  );
  assert.equal(validateGraphIR(graph).valid, true);
  assert.equal(graph.schemaVersion, GRAPH_IR_SCHEMA_VERSION);
});

test('a minimal file-layer (pyan-style) graph validates', () => {
  const graph = makeGraphIR(
    baseGraphInput('file', {
      rootCoordinate: coord(),
      nodes: [
        { id: 'fn1', layer: 'file', kind: 'function', label: 'run', coordinate: coord({ symbolPath: ['run'], symbolKind: 'function' }), groupId: null },
      ],
    })
  );
  assert.equal(validateGraphIR(graph).valid, true);
});

test('a minimal function-layer (CodeVisualizer-style) graph validates', () => {
  const graph = makeGraphIR(
    baseGraphInput('function', {
      rootCoordinate: coord({ symbolPath: ['run'], symbolKind: 'function' }),
      nodes: [
        { id: 'entry', layer: 'function', kind: 'entry', label: 'entry', coordinate: null, groupId: null, hints: { isEntry: true } },
        { id: 'exit', layer: 'function', kind: 'exit', label: 'exit', coordinate: null, groupId: null, hints: { isExit: true } },
      ],
      edges: [{ id: 'e1', layer: 'function', kind: 'flow', source: 'entry', target: 'exit' }],
    })
  );
  assert.equal(validateGraphIR(graph).valid, true);
});

test('unknown/extra fields anywhere in the tree are safely ignored, not rejected', () => {
  const graph = makeGraphIR(
    baseGraphInput('repository', {
      nodes: [{ id: 'n1', layer: 'repository', kind: 'file', label: 'a.py', coordinate: null, groupId: null, metadata: { futureField: 42 } }],
      futureTopLevelField: 'anything',
    })
  );
  assert.equal(validateGraphIR(graph).valid, true);
});

test('rejects a wrong schemaVersion', () => {
  const result = validateGraphIR({ ...baseGraphInput('repository'), schemaVersion: 999, generatedAt: new Date().toISOString(), groups: [], rootCoordinate: null, warnings: [] });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('schemaVersion')));
});

test('rejects an edge referencing a node id not present in this graph (invalid cross-layer/dangling edge)', () => {
  assert.throws(
    () =>
      makeGraphIR(
        baseGraphInput('function', {
          nodes: [{ id: 'a', layer: 'function', kind: 'entry', label: 'a', coordinate: null, groupId: null }],
          edges: [{ id: 'e1', layer: 'function', kind: 'flow', source: 'a', target: 'does-not-exist' }],
        })
      ),
    (err) => err instanceof GraphIRError && err.errors.some((e) => e.includes('unknown target node'))
  );
});

test('rejects a node whose layer does not match the graph layer', () => {
  assert.throws(
    () =>
      makeGraphIR(
        baseGraphInput('file', {
          nodes: [{ id: 'a', layer: 'repository', kind: 'file', label: 'a', coordinate: null, groupId: null }],
        })
      ),
    (err) => err instanceof GraphIRError && err.errors.some((e) => e.includes('invalid cross-layer node'))
  );
});

test('rejects duplicate node ids', () => {
  assert.throws(
    () =>
      makeGraphIR(
        baseGraphInput('repository', {
          nodes: [
            { id: 'dup', layer: 'repository', kind: 'file', label: 'a', coordinate: null, groupId: null },
            { id: 'dup', layer: 'repository', kind: 'file', label: 'b', coordinate: null, groupId: null },
          ],
        })
      ),
    GraphIRError
  );
});

test('rejects a group referencing an unknown parentGroupId', () => {
  assert.throws(
    () =>
      makeGraphIR(
        baseGraphInput('repository', {
          groups: [{ id: 'g1', layer: 'repository', label: 'src', parentGroupId: 'missing' }],
        })
      ),
    GraphIRError
  );
});

test('layers genuinely retain distinct hint vocabularies (renderer freedom) while sharing the same envelope', () => {
  const repoGraph = makeGraphIR(
    baseGraphInput('repository', {
      nodes: [{ id: 'n1', layer: 'repository', kind: 'directory', label: 'src', coordinate: null, groupId: null, hints: { layoutPreference: 'treemap' } }],
    })
  );
  const fnGraph = makeGraphIR(
    baseGraphInput('function', {
      nodes: [{ id: 'n1', layer: 'function', kind: 'entry', label: 'entry', coordinate: null, groupId: null, hints: { layoutPreference: 'hierarchical', isEntry: true } }],
    })
  );
  assert.notEqual(repoGraph.nodes[0].hints.layoutPreference, fnGraph.nodes[0].hints.layoutPreference);
});
