// Unit tests for server/lib/github-analyzer-bridge.js's pure tree-selection
// logic (MOO-67 Commit 6 -- PR review fixup: byte limits). No network --
// operates directly on synthetic Git tree entries, same shape the GitHub
// Trees API returns.
import assert from 'node:assert/strict';
import test from 'node:test';

import { selectAnalyzableFiles, GithubFetchError } from '../server/lib/github-analyzer-bridge.js';

const LIMITS = { maxRepoFiles: 500, maxFileBytes: 1024, maxRepoBytes: 4096 };

function blob(path, size, sha = 'sha-' + path) {
  return { type: 'blob', path, sha, size };
}

test('selectAnalyzableFiles accepts files within both the per-file and aggregate byte limits', () => {
  const { files, skippedOversizedFiles } = selectAnalyzableFiles(
    [blob('a.js', 100), blob('b.js', 200)],
    LIMITS
  );
  assert.equal(files.length, 2);
  assert.equal(skippedOversizedFiles, 0);
});

test('selectAnalyzableFiles skips (does not fail the request for) a single oversized file', () => {
  // .bin isn't a recognized code file type at all, so it would be
  // excluded before ever reaching the size check -- use an otherwise
  // includable extension (.js) to isolate the size-based skip specifically.
  const { files, skippedOversizedFiles } = selectAnalyzableFiles(
    [blob('huge.js', 2048), blob('small.js', 100)],
    LIMITS
  );
  assert.equal(files.length, 1);
  assert.equal(files[0].path, 'small.js');
  assert.equal(skippedOversizedFiles, 1);
});

test('selectAnalyzableFiles rejects the whole request when the aggregate size is exceeded', () => {
  // Each file is under the 1024-byte per-file cap individually, but five of
  // them sum past the 4096-byte aggregate cap.
  const underPerFileCapButNotAggregate = [
    blob('a.js', 1000), blob('b.js', 1000), blob('c.js', 1000), blob('d.js', 1000), blob('e.js', 1000),
  ];
  assert.throws(
    () => selectAnalyzableFiles(underPerFileCapButNotAggregate, LIMITS),
    (err) => {
      assert.ok(err instanceof GithubFetchError);
      assert.match(err.message, /aggregate size limit/);
      return true;
    }
  );
});

test('selectAnalyzableFiles rejects the whole request when the file-count limit is exceeded', () => {
  const entries = Array.from({ length: 5 }, (_, i) => blob(`file-${i}.js`, 10));
  assert.throws(
    () => selectAnalyzableFiles(entries, { ...LIMITS, maxRepoFiles: 3 }),
    (err) => {
      assert.ok(err instanceof GithubFetchError);
      assert.match(err.message, /analyzable files, over the configured limit/);
      return true;
    }
  );
});

test('selectAnalyzableFiles ignores non-blob tree entries (directories, submodules)', () => {
  const { files } = selectAnalyzableFiles(
    [
      { type: 'tree', path: 'src', sha: 'sha-src' },
      { type: 'commit', path: 'vendor/submodule', sha: 'sha-sub' },
      blob('src/index.js', 50),
    ],
    LIMITS
  );
  assert.equal(files.length, 1);
  assert.equal(files[0].path, 'src/index.js');
});

test('selectAnalyzableFiles treats a missing size as zero rather than throwing', () => {
  const { files } = selectAnalyzableFiles([{ type: 'blob', path: 'a.js', sha: 'sha-a' }], LIMITS);
  assert.equal(files.length, 1);
  assert.equal(files[0].size, 0);
});

test('selectAnalyzableFiles still applies ignored-directory and excluded-file rules', () => {
  const { files } = selectAnalyzableFiles(
    [blob('node_modules/pkg/index.js', 10), blob('a.exe', 10), blob('src/app.js', 10)],
    LIMITS
  );
  assert.deepEqual(files.map((f) => f.path), ['src/app.js']);
});
