// Unit tests for src/graph-ir/adapterResult.js (MOO-68 Commit 4).
import assert from 'node:assert/strict';
import test from 'node:test';

const {
  AdapterError,
  ERROR_CATEGORIES,
  sanitizeDiagnostic,
  buildAdapterResult,
  AdapterResultError,
} = await import('../src/graph-ir/adapterResult.js');
const { makeGraphIR } = await import('../src/graph-ir/graphIR.js');
const { normalizeContext } = await import('../src/graph-ir/githubContext.js');

const SHA = 'a'.repeat(40);
const CONTEXT = normalizeContext({ owner: 'octocat', repo: 'Hello-World', resolvedSha: SHA });

function graphInput(overrides) {
  return {
    layer: 'repository',
    context: CONTEXT,
    analyzer: { name: 'pyan3', version: '1.0.0' },
    confidence: 1,
    nodes: [],
    edges: [],
    ...overrides,
  };
}

function provenance() {
  return { analyzerName: 'pyan3', analyzerVersion: '1.0.0' };
}

function timing() {
  return { startedAt: new Date().toISOString(), durationMs: 42 };
}

test('every declared ErrorCategory constructs a valid AdapterError', () => {
  for (const category of ERROR_CATEGORIES) {
    const err = new AdapterError(category, `${category} happened`);
    assert.equal(err.category, category);
    assert.equal(err.name, 'AdapterError');
  }
});

test('AdapterError rejects an unknown category', () => {
  assert.throws(() => new AdapterError('not_a_real_category', 'oops'), TypeError);
});

test('sanitizeDiagnostic redacts secret-shaped keys at any depth and drops stack traces', () => {
  const sanitized = sanitizeDiagnostic({
    message: 'GitHub request failed',
    stack: 'Error: ...\n at fetchTree',
    details: { authorization: 'Bearer abc123', nested: { apiKey: 'xyz', owner: 'octocat' } },
  });
  assert.equal(sanitized.stack, undefined);
  assert.equal(sanitized.details.authorization, '[redacted]');
  assert.equal(sanitized.details.nested.apiKey, '[redacted]');
  assert.equal(sanitized.details.nested.owner, 'octocat');
});

test('sanitizeDiagnostic accepts an AdapterError instance directly', () => {
  const err = new AdapterError('github_access', 'rate limited', { details: { token: 'secret-value' } });
  const sanitized = sanitizeDiagnostic(err);
  assert.equal(sanitized.category, 'github_access');
  assert.equal(sanitized.details.token, '[redacted]');
  assert.equal('stack' in sanitized, false);
});

test('a non-partial result requires a schema-valid graph', () => {
  assert.throws(
    () => buildAdapterResult({ graph: null, partial: false, warnings: [], provenance: provenance(), timing: timing() }),
    AdapterResultError
  );
});

test('a full-success result with a valid graph builds cleanly', () => {
  const graph = makeGraphIR(graphInput());
  const result = buildAdapterResult({ graph, warnings: [], provenance: provenance(), timing: timing() });
  assert.equal(result.partial, false);
  assert.equal(result.graph, graph);
});

test('partial-success: a schema-valid but degraded graph plus warnings remains valid', () => {
  const graph = makeGraphIR(graphInput({ confidence: 0.4 }));
  const result = buildAdapterResult({
    graph,
    partial: true,
    warnings: ['3 files could not be parsed'],
    diagnostics: [{ message: 'parse error', details: {} }],
    provenance: provenance(),
    timing: timing(),
  });
  assert.equal(result.partial, true);
  assert.equal(result.graph.confidence, 0.4);
});

test('partial-success: total failure (no graph at all) is allowed only when partial is true', () => {
  const result = buildAdapterResult({
    graph: null,
    partial: true,
    warnings: [],
    diagnostics: [new AdapterError('subprocess_failure', 'pyan3 crashed')],
    provenance: provenance(),
    timing: timing(),
  });
  assert.equal(result.graph, null);
  assert.equal(result.diagnostics[0].category, 'subprocess_failure');
});

test('rejects an invalid graph even when partial is true', () => {
  assert.throws(
    () =>
      buildAdapterResult({
        graph: { schemaVersion: 1, layer: 'bogus-layer' },
        partial: true,
        warnings: [],
        provenance: provenance(),
        timing: timing(),
      }),
    AdapterResultError
  );
});

test('diagnostics are sanitized even when the caller forgot to', () => {
  const result = buildAdapterResult({
    graph: null,
    partial: true,
    warnings: [],
    diagnostics: [{ message: 'oops', details: { password: 'hunter2' } }],
    provenance: provenance(),
    timing: timing(),
  });
  assert.equal(result.diagnostics[0].details.password, '[redacted]');
});
