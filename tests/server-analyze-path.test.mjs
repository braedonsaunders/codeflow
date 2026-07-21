// Unit tests for server/routes/analyze.js's resolveWithinRepo (MOO-67
// Commit 5 -- PR review fixup: the lexical-only check didn't actually
// reject symlinks despite what its comment claimed).
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { resolveWithinRepo } from '../server/routes/analyze.js';

async function withTempRepo(fn) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'codeflow-analyze-path-')));
  try {
    await mkdir(join(root, 'inside'), { recursive: true });
    await writeFile(join(root, 'inside', 'file.txt'), 'hello');
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => {});
  }
}

test('resolveWithinRepo accepts a plain path inside the repo root', async () => {
  await withTempRepo(async (root) => {
    const resolved = await resolveWithinRepo(root, 'inside');
    assert.equal(resolved, join(root, 'inside'));
  });
});

test('resolveWithinRepo rejects lexical ".." traversal', async () => {
  await withTempRepo(async (root) => {
    assert.equal(await resolveWithinRepo(root, '../../../../etc'), null);
  });
});

test('resolveWithinRepo rejects a nonexistent path instead of throwing', async () => {
  await withTempRepo(async (root) => {
    assert.equal(await resolveWithinRepo(root, 'does-not-exist'), null);
  });
});

test('resolveWithinRepo rejects a symlink that sits lexically inside the repo but points outside it', async () => {
  await withTempRepo(async (root) => {
    const outsideDir = await realpath(await mkdtemp(join(tmpdir(), 'codeflow-outside-')));
    try {
      await writeFile(join(outsideDir, 'secret.txt'), 'should not be reachable');
      const linkPath = join(root, 'escape-link');
      await symlink(outsideDir, linkPath, 'junction');

      const resolved = await resolveWithinRepo(root, 'escape-link');
      assert.equal(resolved, null, 'a symlink escaping the repo root must be rejected, not silently followed');
    } finally {
      await rm(outsideDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});

test('resolveWithinRepo accepts a symlink that points to another location still inside the repo root', async () => {
  await withTempRepo(async (root) => {
    await mkdir(join(root, 'real-target'), { recursive: true });
    await writeFile(join(root, 'real-target', 'f.txt'), 'ok');
    const linkPath = join(root, 'inside-link');
    await symlink(join(root, 'real-target'), linkPath, 'junction');

    const resolved = await resolveWithinRepo(root, 'inside-link');
    assert.equal(resolved, join(root, 'real-target'));
  });
});
