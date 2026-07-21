// Unit tests for src/graph-ir/sourceCoordinate.js (MOO-68 Commit 1).
import assert from 'node:assert/strict';
import test from 'node:test';

const {
  makeCoordinate,
  serializeCoordinate,
  parseCoordinate,
  encodeCoordinateToken,
  decodeCoordinateToken,
  coordinatesEqual,
  describeCoordinate,
  normalizePath,
  SourceCoordinateError,
} = await import('../src/graph-ir/sourceCoordinate.js');

const REPO = { host: 'github.com', owner: 'octocat', name: 'Hello-World' };
const REVISION = 'abc123def456abc123def456abc123def456abc';

function base(overrides) {
  return makeCoordinate({
    repository: REPO,
    revision: REVISION,
    path: 'src/service.py',
    symbolPath: [],
    symbolKind: 'module',
    range: null,
    ambiguous: false,
    ...overrides,
  });
}

test('normalizePath converts backslashes and strips leading/trailing slashes', () => {
  assert.equal(normalizePath('src\\app\\service.py'), 'src/app/service.py');
  assert.equal(normalizePath('./src/app.py'), 'src/app.py');
  assert.equal(normalizePath('/src/app.py/'), 'src/app.py');
  assert.equal(normalizePath('src//app.py'), 'src/app.py');
});

test('makeCoordinate rejects a missing required field', () => {
  assert.throws(() => makeCoordinate({ revision: REVISION, path: 'a.py', symbolKind: 'module' }), SourceCoordinateError);
});

test('makeCoordinate rejects an invalid symbolKind', () => {
  assert.throws(
    () => makeCoordinate({ repository: REPO, revision: REVISION, path: 'a.py', symbolKind: 'bogus' }),
    SourceCoordinateError
  );
});

test('round-trip: module scope', () => {
  const coord = base();
  const parsed = parseCoordinate(serializeCoordinate(coord));
  assert.deepEqual(parsed, coord);
});

test('round-trip: nested class and function (repeated short names distinguished by scope chain)', () => {
  const a = base({
    symbolPath: ['Outer', 'Inner', 'run'],
    symbolKind: 'method',
    range: { startLine: 10, startColumn: 4, endLine: 15, endColumn: 0 },
  });
  const b = base({
    symbolPath: ['Other', 'run'],
    symbolKind: 'method',
    range: { startLine: 20, startColumn: 4, endLine: 22, endColumn: 0 },
  });
  assert.equal(coordinatesEqual(a, b), false);
  assert.deepEqual(parseCoordinate(serializeCoordinate(a)), a);
  assert.deepEqual(parseCoordinate(serializeCoordinate(b)), b);
});

test('round-trip: decorated function (range covers full decorated definition, no special-casing needed)', () => {
  const coord = base({
    path: 'src/app.py',
    symbolPath: ['handler'],
    symbolKind: 'function',
    range: { startLine: 5, startColumn: 0, endLine: 9, endColumn: 0 },
  });
  assert.deepEqual(parseCoordinate(serializeCoordinate(coord)), coord);
});

test('round-trip: missing range (unresolved position)', () => {
  const coord = base({ symbolPath: ['mystery'], symbolKind: 'function', range: null, ambiguous: true });
  assert.deepEqual(parseCoordinate(serializeCoordinate(coord)), coord);
  assert.equal(coord.ambiguous, true);
});

test('cross-platform path fixtures normalize identically', () => {
  const posix = base({ path: 'src/nested/module.py' });
  const windows = base({ path: 'src\\nested\\module.py' });
  assert.equal(coordinatesEqual(posix, windows), true);
});

test('coordinate token round-trips through encode/decode', () => {
  const coord = base({ symbolPath: ['Service', 'run'], symbolKind: 'method' });
  const token = encodeCoordinateToken(coord);
  assert.equal(/^[A-Za-z0-9_-]+$/.test(token), true, 'token must be URL-safe with no delimiter ambiguity');
  assert.deepEqual(decodeCoordinateToken(token), coord);
});

test('serialization is key-order stable for cache-key/route use', () => {
  const a = base();
  const b = base();
  assert.equal(serializeCoordinate(a), serializeCoordinate(b));
});

test('describeCoordinate produces a readable label including scope chain', () => {
  const coord = base({ symbolPath: ['Service', 'run'], symbolKind: 'method' });
  const label = describeCoordinate(coord);
  assert.match(label, /octocat\/Hello-World@/);
  assert.match(label, /src\/service\.py#Service\.run$/);
});

test('parseCoordinate throws SourceCoordinateError on invalid JSON', () => {
  assert.throws(() => parseCoordinate('not json'), SourceCoordinateError);
});
