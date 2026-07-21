// Unit tests for src/graph-ir/navigation.js (MOO-68 Commit 5).
import assert from 'node:assert/strict';
import test from 'node:test';

const {
  classifyPointerInteraction,
  isDrillDownEligible,
  createSelectionEvent,
  createDrillDownEvent,
  createOpenSourceEvent,
  makeBreadcrumbEntry,
  NavigationHistory,
  NavigationError,
} = await import('../src/graph-ir/navigation.js');
const { makeCoordinate } = await import('../src/graph-ir/sourceCoordinate.js');

const REPO = { host: 'github.com', owner: 'octocat', name: 'Hello-World' };
const SHA = 'a'.repeat(40);

function coord(overrides) {
  return makeCoordinate({ repository: REPO, revision: SHA, path: 'src/app.py', symbolKind: 'module', ...overrides });
}

test('classifyPointerInteraction distinguishes single-click, double-click, and treats detail:2 click as drillDown too', () => {
  assert.equal(classifyPointerInteraction({ type: 'click', detail: 1 }), 'select');
  assert.equal(classifyPointerInteraction({ type: 'dblclick' }), 'drillDown');
  assert.equal(classifyPointerInteraction({ type: 'click', detail: 2 }), 'drillDown');
});

test('createSelectionEvent emits selection/focus only', () => {
  const evt = createSelectionEvent('node-1', coord());
  assert.equal(evt.type, 'select');
  assert.equal(evt.nodeId, 'node-1');
});

test('createSelectionEvent requires a nodeId', () => {
  assert.throws(() => createSelectionEvent(null, coord()), NavigationError);
});

test('repository -> file drill-down succeeds for a resolved coordinate with a path', () => {
  const evt = createDrillDownEvent(coord(), 'repository');
  assert.equal(evt.type, 'drillDown');
  assert.equal(evt.targetLayer, 'file');
});

test('file -> function drill-down requires a resolved function/method symbolPath', () => {
  const fnCoord = coord({ symbolPath: ['Service', 'run'], symbolKind: 'method' });
  const evt = createDrillDownEvent(fnCoord, 'file');
  assert.equal(evt.targetLayer, 'function');
});

test('function layer has no further drill-down target', () => {
  assert.throws(() => createDrillDownEvent(coord(), 'function'), NavigationError);
});

test('an ambiguous coordinate never triggers drill-down (unresolved-target behavior)', () => {
  const ambiguous = coord({ symbolPath: ['maybe_this'], symbolKind: 'function', ambiguous: true });
  assert.equal(isDrillDownEligible(ambiguous, 'file'), false);
  assert.throws(() => createDrillDownEvent(ambiguous, 'repository'), NavigationError);
});

test('a module-level coordinate (no function scope) is not eligible for a function drill-down', () => {
  const moduleCoord = coord({ symbolKind: 'module' });
  assert.equal(isDrillDownEligible(moduleCoord, 'function'), false);
  assert.throws(() => createDrillDownEvent(moduleCoord, 'file'), NavigationError);
});

test('createOpenSourceEvent allows an ambiguous coordinate as long as it has a path', () => {
  const ambiguous = coord({ symbolPath: ['maybe_this'], ambiguous: true });
  const evt = createOpenSourceEvent(ambiguous);
  assert.equal(evt.type, 'openSource');
});

test('createOpenSourceEvent requires a path', () => {
  assert.throws(() => createOpenSourceEvent(null), NavigationError);
});

test('NavigationHistory restores prior graph (via cache key), selection, and coordinate on back/forward', () => {
  const repoEntry = makeBreadcrumbEntry('repository', null, { graphCacheKey: 'k-repo', selectedNodeId: 'n1' });
  const fileEntry = makeBreadcrumbEntry('file', coord(), { graphCacheKey: 'k-file', selectedNodeId: 'n2' });
  const history = new NavigationHistory(repoEntry);
  history.push(fileEntry);

  assert.equal(history.current(), fileEntry);
  assert.equal(history.canGoBack, true);
  assert.equal(history.canGoForward, false);

  const restored = history.back();
  assert.equal(restored.graphCacheKey, 'k-repo');
  assert.equal(restored.selectedNodeId, 'n1');
  assert.equal(history.canGoForward, true);

  const forwardAgain = history.forward();
  assert.equal(forwardAgain.graphCacheKey, 'k-file');
  assert.deepEqual(forwardAgain.coordinate, coord());
});

test('NavigationHistory push after going back truncates the discarded forward branch', () => {
  const a = makeBreadcrumbEntry('repository', null, { graphCacheKey: 'a' });
  const b = makeBreadcrumbEntry('file', null, { graphCacheKey: 'b' });
  const c = makeBreadcrumbEntry('function', null, { graphCacheKey: 'c' });
  const history = new NavigationHistory(a);
  history.push(b);
  history.back();
  history.push(c);
  assert.equal(history.canGoForward, false);
  assert.deepEqual(history.trail().map((e) => e.graphCacheKey), ['a', 'c']);
});

test('NavigationHistory.back/forward throw at the boundaries', () => {
  const history = new NavigationHistory(makeBreadcrumbEntry('repository', null, {}));
  assert.throws(() => history.back(), NavigationError);
  assert.throws(() => history.forward(), NavigationError);
});
