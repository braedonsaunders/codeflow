// Unit tests for server/lib/auth.js, allowlist.js, rate-limit.js, and
// validate-repo-request.js (MOO-67 Commit 6).
import assert from 'node:assert/strict';
import test from 'node:test';

import { isAuthorized, extractBearerToken } from '../server/lib/auth.js';
import { isRepoAllowed } from '../server/lib/allowlist.js';
import { RateLimiter } from '../server/lib/rate-limit.js';
import { validateRepoRequest, ValidationError } from '../server/lib/validate-repo-request.js';

test('extractBearerToken reads a well-formed Authorization header', () => {
  const req = { headers: { authorization: 'Bearer abc123' } };
  assert.equal(extractBearerToken(req), 'abc123');
});

test('extractBearerToken returns null when the header is missing or malformed', () => {
  assert.equal(extractBearerToken({ headers: {} }), null);
  assert.equal(extractBearerToken({ headers: { authorization: 'Basic abc123' } }), null);
  assert.equal(extractBearerToken({ headers: { authorization: '' } }), null);
});

test('isAuthorized accepts the exact configured token and rejects anything else', () => {
  const config = { authToken: 'correct-token' };
  assert.equal(isAuthorized({ headers: { authorization: 'Bearer correct-token' } }, config), true);
  assert.equal(isAuthorized({ headers: { authorization: 'Bearer wrong-token' } }, config), false);
  assert.equal(isAuthorized({ headers: {} }, config), false);
  assert.equal(isAuthorized({ headers: { authorization: 'Bearer correct-tokenX' } }, config), false);
});

test('isRepoAllowed matches an explicit owner/repo entry', () => {
  const config = { allowedRepos: ['octocat/hello-world'], allowedOwners: [] };
  assert.equal(isRepoAllowed('octocat', 'Hello-World', config), true);
  assert.equal(isRepoAllowed('octocat', 'other-repo', config), false);
});

test('isRepoAllowed matches any repo under an allowed owner', () => {
  const config = { allowedRepos: [], allowedOwners: ['octocat'] };
  assert.equal(isRepoAllowed('octocat', 'anything', config), true);
  assert.equal(isRepoAllowed('someone-else', 'anything', config), false);
});

test('RateLimiter allows up to the configured limit within a window, then rejects', () => {
  const limiter = new RateLimiter(3);
  assert.equal(limiter.check('client-a').allowed, true);
  assert.equal(limiter.check('client-a').allowed, true);
  assert.equal(limiter.check('client-a').allowed, true);
  assert.equal(limiter.check('client-a').allowed, false);
});

test('RateLimiter tracks separate keys independently', () => {
  const limiter = new RateLimiter(1);
  assert.equal(limiter.check('client-a').allowed, true);
  assert.equal(limiter.check('client-b').allowed, true);
  assert.equal(limiter.check('client-a').allowed, false);
  assert.equal(limiter.check('client-b').allowed, false);
});

test('validateRepoRequest accepts a well-formed owner/repo with no ref/pr', () => {
  const result = validateRepoRequest({ owner: 'octocat', repo: 'Hello-World' });
  assert.deepEqual(result, { owner: 'octocat', repo: 'Hello-World', ref: null, pr: null });
});

test('validateRepoRequest accepts a well-formed ref (branch or commit SHA)', () => {
  assert.equal(validateRepoRequest({ owner: 'octocat', repo: 'Hello-World', ref: 'main' }).ref, 'main');
  assert.equal(
    validateRepoRequest({ owner: 'octocat', repo: 'Hello-World', ref: 'feature/x' }).ref,
    'feature/x'
  );
  assert.equal(
    validateRepoRequest({ owner: 'octocat', repo: 'Hello-World', ref: 'a1b2c3d4' }).ref,
    'a1b2c3d4'
  );
});

test('validateRepoRequest accepts a well-formed positive integer pr', () => {
  assert.equal(validateRepoRequest({ owner: 'octocat', repo: 'Hello-World', pr: 42 }).pr, 42);
});

test('validateRepoRequest rejects a malformed owner', () => {
  assert.throws(() => validateRepoRequest({ owner: '-bad', repo: 'x' }), ValidationError);
  assert.throws(() => validateRepoRequest({ owner: 'has space', repo: 'x' }), ValidationError);
  assert.throws(() => validateRepoRequest({ owner: '', repo: 'x' }), ValidationError);
});

test('validateRepoRequest rejects a malformed repo', () => {
  assert.throws(() => validateRepoRequest({ owner: 'octocat', repo: '..' }), ValidationError);
  assert.throws(() => validateRepoRequest({ owner: 'octocat', repo: 'has space' }), ValidationError);
});

test('validateRepoRequest rejects a ref containing ".." or a leading slash/dash', () => {
  assert.throws(() => validateRepoRequest({ owner: 'octocat', repo: 'x', ref: '../escape' }), ValidationError);
  assert.throws(() => validateRepoRequest({ owner: 'octocat', repo: 'x', ref: '/abs' }), ValidationError);
  assert.throws(() => validateRepoRequest({ owner: 'octocat', repo: 'x', ref: '-flag' }), ValidationError);
});

test('validateRepoRequest rejects a non-positive or non-integer pr', () => {
  assert.throws(() => validateRepoRequest({ owner: 'octocat', repo: 'x', pr: 0 }), ValidationError);
  assert.throws(() => validateRepoRequest({ owner: 'octocat', repo: 'x', pr: -1 }), ValidationError);
  assert.throws(() => validateRepoRequest({ owner: 'octocat', repo: 'x', pr: 1.5 }), ValidationError);
});

test('validateRepoRequest rejects specifying both ref and pr', () => {
  assert.throws(
    () => validateRepoRequest({ owner: 'octocat', repo: 'x', ref: 'main', pr: 1 }),
    ValidationError
  );
});

test('validateRepoRequest rejects a missing/non-object body', () => {
  assert.throws(() => validateRepoRequest(null), ValidationError);
  assert.throws(() => validateRepoRequest(undefined), ValidationError);
  assert.throws(() => validateRepoRequest('not an object'), ValidationError);
});
