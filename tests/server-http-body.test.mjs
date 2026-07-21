// Unit tests for server/lib/http-body.js (MOO-67 Commit 6 -- PR review
// fixup: /api/analyze had no body-size limit while /api/analyze-repo did;
// extracted one shared, bounded reader both routes now use).
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import { readJsonBody, BodyTooLargeError } from '../server/lib/http-body.js';

function fakeRequest(bodyString) {
  return Readable.from([Buffer.from(bodyString, 'utf8')]);
}

test('readJsonBody parses a well-formed JSON body', async () => {
  const body = await readJsonBody(fakeRequest('{"a":1}'), 1024);
  assert.deepEqual(body, { a: 1 });
});

test('readJsonBody returns {} for an empty body', async () => {
  const body = await readJsonBody(fakeRequest(''), 1024);
  assert.deepEqual(body, {});
});

test('readJsonBody throws a plain SyntaxError for malformed JSON', async () => {
  await assert.rejects(() => readJsonBody(fakeRequest('{not json'), 1024), SyntaxError);
});

test('readJsonBody throws BodyTooLargeError once the byte limit is exceeded', async () => {
  const big = JSON.stringify({ a: 'x'.repeat(1000) });
  await assert.rejects(() => readJsonBody(fakeRequest(big), 10), BodyTooLargeError);
});

test('readJsonBody accepts a body exactly at the byte limit', async () => {
  const exact = '{"a":1}'; // 7 bytes
  const body = await readJsonBody(fakeRequest(exact), Buffer.byteLength(exact));
  assert.deepEqual(body, { a: 1 });
});
