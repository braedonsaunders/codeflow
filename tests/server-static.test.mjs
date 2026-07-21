// Unit tests for server/lib/static.js's resolveRequestedFile (fixup for
// GitHub code scanning: CodeQL js/path-injection, high severity x2, on the
// original `resolved.startsWith(distDir + sep)` check).
import assert from 'node:assert/strict';
import { join, sep } from 'node:path';
import test from 'node:test';

import { resolveRequestedFile } from '../server/lib/static.js';

const distDir = sep === '\\' ? 'C:\\dist' : '/dist';

test('resolveRequestedFile serves index.html for the root path', () => {
  assert.equal(resolveRequestedFile(distDir, '/'), join(distDir, 'index.html'));
});

test('resolveRequestedFile resolves an ordinary asset path within distDir', () => {
  assert.equal(resolveRequestedFile(distDir, '/assets/index-abc123.js'), join(distDir, 'assets', 'index-abc123.js'));
});

test('resolveRequestedFile strips a query string before resolving', () => {
  assert.equal(resolveRequestedFile(distDir, '/assets/app.css?v=2'), join(distDir, 'assets', 'app.css'));
});

test('resolveRequestedFile rejects lexical ".." traversal', () => {
  assert.equal(resolveRequestedFile(distDir, '/../../../../etc/passwd'), null);
  assert.equal(resolveRequestedFile(distDir, '/assets/../../secret.txt'), null);
});

test('resolveRequestedFile rejects a percent-encoded traversal attempt', () => {
  assert.equal(resolveRequestedFile(distDir, '/%2e%2e/%2e%2e/etc/passwd'), null);
});

test('resolveRequestedFile returns a lexical path for a legitimately-missing asset (SPA fallback relies on this)', () => {
  // Deliberately does not require the file to exist on disk -- an
  // unmatched client-side route path is a normal case the caller falls
  // back to index.html for, not something this function should reject.
  const resolved = resolveRequestedFile(distDir, '/some/client-side/route');
  assert.equal(resolved, join(distDir, 'some', 'client-side', 'route'));
});
