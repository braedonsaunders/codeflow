// Unit tests for server/lib/config.js (MOO-67 Commits 5-6).
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { loadConfig, ConfigError } from '../server/lib/config.js';

// Minimal env satisfying every Commit 6 requirement, so tests that aren't
// specifically about auth/github/allowlist validation don't need to
// repeat it.
const VALID_ENV = {
  AUTH_TOKEN: 'test-auth-token',
  GITHUB_TOKEN: 'test-github-token',
  ALLOWED_OWNERS: 'octocat',
};

async function withBuiltRepo(fn) {
  const repoRoot = await mkdtemp(join(tmpdir(), 'codeflow-config-'));
  try {
    await mkdir(join(repoRoot, 'dist'), { recursive: true });
    await writeFile(join(repoRoot, 'dist', 'index.html'), '<html></html>');
    await fn(repoRoot);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
}

test('loadConfig throws an actionable ConfigError when dist/index.html is missing', async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), 'codeflow-config-'));
  try {
    assert.throws(
      () => loadConfig({ repoRoot, env: VALID_ENV }),
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

test('loadConfig succeeds and applies defaults when all required config is present', async () => {
  await withBuiltRepo((repoRoot) => {
    const config = loadConfig({ repoRoot, env: VALID_ENV });
    assert.equal(config.port, 3000);
    assert.equal(config.repoRoot, repoRoot);
    assert.equal(config.distDir, join(repoRoot, 'dist'));
    assert.equal(config.nodeEnv, 'development');
    assert.ok(config.workspaceRoot);
    assert.equal(config.authToken, 'test-auth-token');
    assert.equal(config.githubToken, 'test-github-token');
    assert.deepEqual(config.allowedOwners, ['octocat']);
    assert.equal(config.rateLimitPerMinute, 30);
    assert.equal(config.maxRequestBodyBytes, 16 * 1024);
    assert.equal(config.maxRepoFiles, 500);
    assert.equal(config.maxFileBytes, 1 * 1024 * 1024);
    assert.equal(config.maxRepoBytes, 25 * 1024 * 1024);
  });
});

test('loadConfig rejects an invalid MAX_FILE_BYTES or MAX_REPO_BYTES', async () => {
  await withBuiltRepo((repoRoot) => {
    assert.throws(
      () => loadConfig({ repoRoot, env: { ...VALID_ENV, MAX_FILE_BYTES: '0' } }),
      /MAX_FILE_BYTES must be a positive integer/
    );
    assert.throws(
      () => loadConfig({ repoRoot, env: { ...VALID_ENV, MAX_REPO_BYTES: 'nope' } }),
      /MAX_REPO_BYTES must be a positive integer/
    );
  });
});

test('loadConfig respects MAX_FILE_BYTES/MAX_REPO_BYTES overrides', async () => {
  await withBuiltRepo((repoRoot) => {
    const config = loadConfig({ repoRoot, env: { ...VALID_ENV, MAX_FILE_BYTES: '2048', MAX_REPO_BYTES: '4096' } });
    assert.equal(config.maxFileBytes, 2048);
    assert.equal(config.maxRepoBytes, 4096);
  });
});

test('loadConfig rejects an invalid PORT with an actionable error', async () => {
  await withBuiltRepo((repoRoot) => {
    assert.throws(
      () => loadConfig({ repoRoot, env: { ...VALID_ENV, PORT: 'not-a-number' } }),
      /PORT must be an integer/
    );
    assert.throws(
      () => loadConfig({ repoRoot, env: { ...VALID_ENV, PORT: '99999' } }),
      /PORT must be an integer/
    );
  });
});

test('loadConfig respects WORKSPACE_ROOT and NODE_ENV overrides', async () => {
  await withBuiltRepo((repoRoot) => {
    const customWorkspace = join(repoRoot, 'custom-workspace');
    const config = loadConfig({
      repoRoot,
      env: { ...VALID_ENV, WORKSPACE_ROOT: customWorkspace, NODE_ENV: 'production' },
    });
    assert.equal(config.workspaceRoot, customWorkspace);
    assert.equal(config.nodeEnv, 'production');
  });
});

test('loadConfig requires AUTH_TOKEN', async () => {
  await withBuiltRepo((repoRoot) => {
    const env = { ...VALID_ENV };
    delete env.AUTH_TOKEN;
    assert.throws(() => loadConfig({ repoRoot, env }), /AUTH_TOKEN is required/);
  });
});

test('loadConfig requires GITHUB_TOKEN', async () => {
  await withBuiltRepo((repoRoot) => {
    const env = { ...VALID_ENV };
    delete env.GITHUB_TOKEN;
    assert.throws(() => loadConfig({ repoRoot, env }), /GITHUB_TOKEN is required/);
  });
});

test('loadConfig requires at least one of ALLOWED_REPOS/ALLOWED_OWNERS', async () => {
  await withBuiltRepo((repoRoot) => {
    const env = { ...VALID_ENV };
    delete env.ALLOWED_OWNERS;
    assert.throws(() => loadConfig({ repoRoot, env }), /ALLOWED_REPOS.*ALLOWED_OWNERS.*required/);
  });
});

test('loadConfig parses comma-separated ALLOWED_REPOS/ALLOWED_OWNERS, trimmed and lowercased', async () => {
  await withBuiltRepo((repoRoot) => {
    const config = loadConfig({
      repoRoot,
      env: { ...VALID_ENV, ALLOWED_REPOS: 'Octocat/Hello-World, Foo/Bar ', ALLOWED_OWNERS: 'SomeOrg' },
    });
    assert.deepEqual(config.allowedRepos, ['octocat/hello-world', 'foo/bar']);
    assert.deepEqual(config.allowedOwners, ['someorg']);
  });
});

test('loadConfig rejects an invalid RATE_LIMIT_PER_MINUTE', async () => {
  await withBuiltRepo((repoRoot) => {
    assert.throws(
      () => loadConfig({ repoRoot, env: { ...VALID_ENV, RATE_LIMIT_PER_MINUTE: '0' } }),
      /RATE_LIMIT_PER_MINUTE must be a positive integer/
    );
    assert.throws(
      () => loadConfig({ repoRoot, env: { ...VALID_ENV, RATE_LIMIT_PER_MINUTE: 'nope' } }),
      /RATE_LIMIT_PER_MINUTE must be a positive integer/
    );
  });
});

test('loadConfig reports every missing required field in a single error, not just the first', async () => {
  await withBuiltRepo((repoRoot) => {
    assert.throws(() => loadConfig({ repoRoot, env: {} }), (err) => {
      assert.ok(err instanceof ConfigError);
      assert.equal(err.errors.length, 3);
      return true;
    });
  });
});
