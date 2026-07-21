// Unit tests for server/lib/config.js (MOO-67 Commit 5).
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { loadConfig, ConfigError } from '../server/lib/config.js';

test('loadConfig throws an actionable ConfigError when dist/index.html is missing', async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), 'codeflow-config-'));
  try {
    assert.throws(
      () => loadConfig({ repoRoot, env: {} }),
      (err) => {
        assert.ok(err instanceof ConfigError);
        assert.match(err.message, /Build output not found/);
        assert.match(err.message, /npm run build/);
        return true;
      }
    );
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test('loadConfig succeeds and applies defaults when dist/index.html exists', async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), 'codeflow-config-'));
  try {
    await mkdir(join(repoRoot, 'dist'), { recursive: true });
    await writeFile(join(repoRoot, 'dist', 'index.html'), '<html></html>');
    const config = loadConfig({ repoRoot, env: {} });
    assert.equal(config.port, 3000);
    assert.equal(config.repoRoot, repoRoot);
    assert.equal(config.distDir, join(repoRoot, 'dist'));
    assert.equal(config.nodeEnv, 'development');
    assert.ok(config.workspaceRoot);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test('loadConfig rejects an invalid PORT with an actionable error', async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), 'codeflow-config-'));
  try {
    await mkdir(join(repoRoot, 'dist'), { recursive: true });
    await writeFile(join(repoRoot, 'dist', 'index.html'), '<html></html>');
    assert.throws(
      () => loadConfig({ repoRoot, env: { PORT: 'not-a-number' } }),
      /PORT must be an integer/
    );
    assert.throws(
      () => loadConfig({ repoRoot, env: { PORT: '99999' } }),
      /PORT must be an integer/
    );
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test('loadConfig respects WORKSPACE_ROOT and NODE_ENV overrides', async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), 'codeflow-config-'));
  try {
    await mkdir(join(repoRoot, 'dist'), { recursive: true });
    await writeFile(join(repoRoot, 'dist', 'index.html'), '<html></html>');
    const customWorkspace = join(repoRoot, 'custom-workspace');
    const config = loadConfig({ repoRoot, env: { WORKSPACE_ROOT: customWorkspace, NODE_ENV: 'production' } });
    assert.equal(config.workspaceRoot, customWorkspace);
    assert.equal(config.nodeEnv, 'production');
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});
