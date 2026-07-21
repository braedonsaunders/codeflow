// Unit tests for src/graph-ir/cacheKey.js (MOO-68 Commit 6).
import assert from 'node:assert/strict';
import test from 'node:test';

const { buildCacheKey, isCacheStale, buildProvenanceSummary } = await import('../src/graph-ir/cacheKey.js');
const { normalizeContext } = await import('../src/graph-ir/githubContext.js');
const { makeGraphIR } = await import('../src/graph-ir/graphIR.js');
const { makeCoordinate } = await import('../src/graph-ir/sourceCoordinate.js');

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const REPO = { host: 'github.com', owner: 'octocat', name: 'Hello-World' };

function ctx(sha) {
  return normalizeContext({ owner: 'octocat', repo: 'Hello-World', resolvedSha: sha });
}

function baseInput(overrides) {
  return { context: ctx(SHA_A), analyzerName: 'pyan3', analyzerVersion: '1.0.0', graphSchemaVersion: 1, ...overrides };
}

test('equivalent normalized requests produce the same key', () => {
  const a = buildCacheKey(baseInput({ options: { reduceDepth: 2, includeTests: true } }));
  const b = buildCacheKey(baseInput({ options: { includeTests: true, reduceDepth: 2 } }));
  assert.equal(a, b);
});

test('different revisions never collide', () => {
  const a = buildCacheKey(baseInput({ context: ctx(SHA_A) }));
  const b = buildCacheKey(baseInput({ context: ctx(SHA_B) }));
  assert.notEqual(a, b);
});

test('different analyzer versions never collide', () => {
  const a = buildCacheKey(baseInput({ analyzerVersion: '1.0.0' }));
  const b = buildCacheKey(baseInput({ analyzerVersion: '1.0.1' }));
  assert.notEqual(a, b);
});

test('different depth choices never collide', () => {
  const a = buildCacheKey(baseInput({ depth: 1 }));
  const b = buildCacheKey(baseInput({ depth: 2 }));
  assert.notEqual(a, b);
});

test('different schema versions never collide, and the key is prefixed with the schema version', () => {
  const a = buildCacheKey(baseInput({ graphSchemaVersion: 1 }));
  const b = buildCacheKey(baseInput({ graphSchemaVersion: 2 }));
  assert.notEqual(a, b);
  assert.match(a, /^graphir:v1:/);
});

test('a requested coordinate participates in the key (file/function requests differ from a whole-repository one)', () => {
  const coord = makeCoordinate({ repository: REPO, revision: SHA_A, path: 'src/app.py', symbolKind: 'module' });
  const whole = buildCacheKey(baseInput({ coordinate: null }));
  const scoped = buildCacheKey(baseInput({ coordinate: coord }));
  assert.notEqual(whole, scoped);
});

test('buildCacheKey requires context/analyzer identity/schema version', () => {
  assert.throws(() => buildCacheKey({ analyzerName: 'x', analyzerVersion: '1', graphSchemaVersion: 1 }), TypeError);
  assert.throws(() => buildCacheKey({ context: ctx(SHA_A), graphSchemaVersion: 1 }), TypeError);
});

test('isCacheStale: a schema-version mismatch is always stale regardless of age', () => {
  const entry = { cachedSchemaVersion: 1, cachedAt: new Date().toISOString() };
  assert.equal(isCacheStale(entry, { currentSchemaVersion: 2 }), true);
  assert.equal(isCacheStale(entry, { currentSchemaVersion: 1 }), false);
});

test('isCacheStale: TTL expiry when provided', () => {
  const cachedAt = new Date(Date.now() - 10_000).toISOString();
  const entry = { cachedSchemaVersion: 1, cachedAt };
  assert.equal(isCacheStale(entry, { currentSchemaVersion: 1, ttlMs: 5_000 }), true);
  assert.equal(isCacheStale(entry, { currentSchemaVersion: 1, ttlMs: 60_000 }), false);
});

test('isCacheStale: no TTL and matching schema version means never stale on time alone', () => {
  const entry = { cachedSchemaVersion: 1, cachedAt: new Date(0).toISOString() };
  assert.equal(isCacheStale(entry, { currentSchemaVersion: 1 }), false);
});

test('buildProvenanceSummary reports resolved/unresolved adapter-match counts', () => {
  const resolved = makeCoordinate({ repository: REPO, revision: SHA_A, path: 'src/app.py', symbolPath: ['run'], symbolKind: 'function' });
  const unresolved = makeCoordinate({ repository: REPO, revision: SHA_A, path: 'src/app.py', symbolPath: ['mystery'], symbolKind: 'function', ambiguous: true });
  const graph = makeGraphIR({
    layer: 'file',
    context: ctx(SHA_A),
    analyzer: { name: 'pyan3', version: '2.1.0' },
    confidence: 0.8,
    nodes: [
      { id: 'n1', layer: 'file', kind: 'function', label: 'run', coordinate: resolved, groupId: null },
      { id: 'n2', layer: 'file', kind: 'function', label: 'mystery', coordinate: unresolved, groupId: null },
      { id: 'n3', layer: 'file', kind: 'function', label: 'no-coord', coordinate: null, groupId: null },
    ],
    edges: [],
  });
  const summary = buildProvenanceSummary(graph);
  assert.equal(summary.analyzerName, 'pyan3');
  assert.equal(summary.analyzerVersion, '2.1.0');
  assert.equal(summary.resolvedSymbolCount, 1);
  assert.equal(summary.unresolvedSymbolCount, 2);
});
