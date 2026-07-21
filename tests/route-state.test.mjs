// Unit tests for src/state/route.js (MOO-67 Commit 4D).
// buildRepoUrl/readRouteRepo accept explicit baseHref/search so they're
// testable here without a DOM, unlike the other src/state or src/render
// modules, which are inherently React/DOM-coupled.
import assert from 'node:assert/strict';
import test from 'node:test';

const { buildRepoUrl, readRouteRepo } = await import('../src/state/route.js');

test('buildRepoUrl sets repo and drops any prior query state', () => {
  const url = buildRepoUrl('octocat/Hello-World', false, 'https://example.com/app?old=1');
  assert.equal(url, 'https://example.com/app?repo=octocat%2FHello-World');
});

test('buildRepoUrl adds run=1 only when autoRun and repo are both present', () => {
  assert.match(buildRepoUrl('octocat/Hello-World', true, 'https://example.com/app'), /run=1/);
  assert.doesNotMatch(buildRepoUrl(null, true, 'https://example.com/app'), /run=1/);
  assert.doesNotMatch(buildRepoUrl('octocat/Hello-World', false, 'https://example.com/app'), /run=1/);
});

test('readRouteRepo accepts a well-formed owner/repo', () => {
  assert.deepEqual(readRouteRepo('?repo=octocat%2FHello-World'), { repo: 'octocat/Hello-World', autoRun: false });
});

test('readRouteRepo reports autoRun only when run=1 is present', () => {
  assert.deepEqual(readRouteRepo('?repo=octocat/Hello-World&run=1'), { repo: 'octocat/Hello-World', autoRun: true });
  assert.deepEqual(readRouteRepo('?repo=octocat/Hello-World&run=0'), { repo: 'octocat/Hello-World', autoRun: false });
});

test('readRouteRepo returns null when there is no repo param', () => {
  assert.equal(readRouteRepo('?run=1'), null);
  assert.equal(readRouteRepo(''), null);
});

test('readRouteRepo rejects a repo value containing a brace (injection guard)', () => {
  assert.equal(readRouteRepo('?repo=' + encodeURIComponent('{"a":1}')), null);
});

test('readRouteRepo rejects a repo value with disallowed characters', () => {
  assert.equal(readRouteRepo('?repo=' + encodeURIComponent('owner/repo<script>')), null);
});

test('readRouteRepo rejects a repo value at/above the 200-character cap', () => {
  const long = 'a/' + 'b'.repeat(199);
  assert.equal(readRouteRepo('?repo=' + encodeURIComponent(long)), null);
});
