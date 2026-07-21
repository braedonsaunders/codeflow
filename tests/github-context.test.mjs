// Unit tests for src/graph-ir/githubContext.js (MOO-68 Commit 2).
import assert from 'node:assert/strict';
import test from 'node:test';

const {
  normalizeContext,
  sameRevision,
  assertContextPropagation,
  contextIdentityKey,
  AnalysisContextError,
} = await import('../src/graph-ir/githubContext.js');

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

test('repository-mode fixture normalizes correctly', () => {
  const ctx = normalizeContext({ owner: 'octocat', repo: 'Hello-World', resolvedSha: SHA_A });
  assert.equal(ctx.mode, 'commit');
  assert.equal(ctx.ref, null);
  assert.equal(ctx.resolvedSha, SHA_A);
});

test('branch-mode fixture normalizes correctly', () => {
  const ctx = normalizeContext({ owner: 'octocat', repo: 'Hello-World', ref: 'main', resolvedSha: SHA_A });
  assert.equal(ctx.mode, 'branch');
  assert.equal(ctx.ref, 'main');
});

test('commit-mode fixture normalizes correctly', () => {
  const ctx = normalizeContext({ owner: 'octocat', repo: 'Hello-World', mode: 'commit', resolvedSha: SHA_A });
  assert.equal(ctx.mode, 'commit');
  assert.equal(ctx.ref, null);
  assert.equal(ctx.prNumber, null);
});

test('PR-mode fixture normalizes correctly, including base/head', () => {
  const ctx = normalizeContext({
    owner: 'octocat',
    repo: 'Hello-World',
    prNumber: 42,
    resolvedSha: SHA_A,
    baseSha: SHA_B,
    headSha: SHA_A,
  });
  assert.equal(ctx.mode, 'pr');
  assert.equal(ctx.prNumber, 42);
  assert.equal(ctx.baseSha, SHA_B);
  assert.equal(ctx.headSha, SHA_A);
});

test('rejects a non-SHA resolvedSha (this module never resolves refs itself)', () => {
  assert.throws(() => normalizeContext({ owner: 'octocat', repo: 'Hello-World', ref: 'main', resolvedSha: 'main' }), AnalysisContextError);
});

test('rejects mixed/contradictory revision fields: prNumber outside pr mode', () => {
  assert.throws(
    () => normalizeContext({ owner: 'octocat', repo: 'Hello-World', mode: 'branch', ref: 'main', resolvedSha: SHA_A, prNumber: 1 }),
    AnalysisContextError
  );
});

test('rejects mixed/contradictory revision fields: ref outside branch mode', () => {
  assert.throws(
    () => normalizeContext({ owner: 'octocat', repo: 'Hello-World', mode: 'commit', ref: 'main', resolvedSha: SHA_A }),
    AnalysisContextError
  );
});

test('rejects baseSha/headSha outside pr mode', () => {
  assert.throws(
    () => normalizeContext({ owner: 'octocat', repo: 'Hello-World', mode: 'commit', resolvedSha: SHA_A, baseSha: SHA_B }),
    AnalysisContextError
  );
});

test('rejects pr mode missing prNumber', () => {
  assert.throws(() => normalizeContext({ owner: 'octocat', repo: 'Hello-World', mode: 'pr', resolvedSha: SHA_A }), AnalysisContextError);
});

test('sameRevision is case-insensitive on owner/repo, exact on resolvedSha', () => {
  const a = normalizeContext({ owner: 'octocat', repo: 'Hello-World', resolvedSha: SHA_A });
  const b = normalizeContext({ owner: 'OctoCat', repo: 'hello-world', resolvedSha: SHA_A });
  const c = normalizeContext({ owner: 'octocat', repo: 'Hello-World', resolvedSha: SHA_B });
  assert.equal(sameRevision(a, b), true);
  assert.equal(sameRevision(a, c), false);
});

test('a file/function request cannot silently use a different revision from its parent graph', () => {
  const parent = normalizeContext({ owner: 'octocat', repo: 'Hello-World', ref: 'main', resolvedSha: SHA_A });
  const sameRevChild = normalizeContext({ owner: 'octocat', repo: 'Hello-World', resolvedSha: SHA_A });
  const driftedChild = normalizeContext({ owner: 'octocat', repo: 'Hello-World', resolvedSha: SHA_B });
  assert.doesNotThrow(() => assertContextPropagation(parent, sameRevChild));
  assert.throws(() => assertContextPropagation(parent, driftedChild), AnalysisContextError);
});

test('assertContextPropagation rejects a mismatched repository even with the same SHA', () => {
  const parent = normalizeContext({ owner: 'octocat', repo: 'Hello-World', resolvedSha: SHA_A });
  const other = normalizeContext({ owner: 'octocat', repo: 'Spoon-Knife', resolvedSha: SHA_A });
  assert.throws(() => assertContextPropagation(parent, other), AnalysisContextError);
});

test('contextIdentityKey is stable for equivalent normalized contexts and distinct across revisions/PRs', () => {
  const a1 = normalizeContext({ owner: 'octocat', repo: 'Hello-World', resolvedSha: SHA_A });
  const a2 = normalizeContext({ owner: 'OctoCat', repo: 'Hello-World', mode: 'commit', resolvedSha: SHA_A.toUpperCase() });
  const b = normalizeContext({ owner: 'octocat', repo: 'Hello-World', resolvedSha: SHA_B });
  const pr = normalizeContext({ owner: 'octocat', repo: 'Hello-World', prNumber: 7, resolvedSha: SHA_A });
  assert.equal(contextIdentityKey(a1), contextIdentityKey(a2));
  assert.notEqual(contextIdentityKey(a1), contextIdentityKey(b));
  assert.notEqual(contextIdentityKey(a1), contextIdentityKey(pr));
});
