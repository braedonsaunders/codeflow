// Unit tests for server/lib/workspace.js (MOO-67 Commit 5).
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { WorkspaceManager } from '../server/lib/workspace.js';

test('ensureRoot creates the configured root and confirms it is writable', async () => {
  const root = join(await mkdtemp(join(tmpdir(), 'codeflow-ws-')), 'nested', 'root');
  try {
    const manager = new WorkspaceManager(root);
    await manager.ensureRoot();
    const info = await stat(root);
    assert.ok(info.isDirectory());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('createRequestWorkspace creates a subdirectory scoped to the root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codeflow-ws-'));
  try {
    const manager = new WorkspaceManager(root);
    const ws = await manager.createRequestWorkspace('req-123');
    assert.equal(ws.dir, join(root, 'req-123'));
    const info = await stat(ws.dir);
    assert.ok(info.isDirectory());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('createRequestWorkspace rejects a requestId with unsafe characters', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codeflow-ws-'));
  try {
    const manager = new WorkspaceManager(root);
    await assert.rejects(() => manager.createRequestWorkspace('../escape'));
    await assert.rejects(() => manager.createRequestWorkspace(''));
    await assert.rejects(() => manager.createRequestWorkspace('has/slash'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('workspace.resolve() stays within the workspace and rejects escapes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codeflow-ws-'));
  try {
    const manager = new WorkspaceManager(root);
    const ws = await manager.createRequestWorkspace('req-456');
    assert.equal(ws.resolve('file.txt'), join(ws.dir, 'file.txt'));
    assert.throws(() => ws.resolve('../../etc/passwd'), /escapes workspace root/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('cleanup() removes the request workspace but leaves the root intact', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codeflow-ws-'));
  try {
    const manager = new WorkspaceManager(root);
    const ws = await manager.createRequestWorkspace('req-789');
    await ws.cleanup();
    await assert.rejects(() => stat(ws.dir));
    const rootInfo = await stat(root);
    assert.ok(rootInfo.isDirectory());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
