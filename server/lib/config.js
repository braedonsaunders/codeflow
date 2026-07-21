// Server configuration — MOO-67 Commits 5-6.
//
// Reads config from environment variables, validating fail-fast at
// startup rather than lazily on first request.
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export class ConfigError extends Error {
  constructor(errors) {
    super('Invalid server configuration:\n' + errors.map((e) => ' - ' + e).join('\n'));
    this.name = 'ConfigError';
    this.errors = errors;
  }
}

function parseList(raw) {
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * @param {object} [options]
 * @param {string} options.repoRoot - absolute path to the repo root (dist/, card/, src/ live under this)
 * @param {NodeJS.ProcessEnv} [options.env]
 */
export function loadConfig({ repoRoot, env = process.env }) {
  const errors = [];

  const portRaw = env.PORT;
  const port = portRaw ? Number(portRaw) : 3000;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    errors.push(`PORT must be an integer between 1 and 65535, got: ${JSON.stringify(portRaw)}`);
  }

  const distDir = join(repoRoot, 'dist');
  if (!existsSync(join(distDir, 'index.html'))) {
    errors.push(`Build output not found at ${join(distDir, 'index.html')} — run \`npm run build\` first.`);
  }

  const workspaceRoot = env.WORKSPACE_ROOT
    ? join(env.WORKSPACE_ROOT)
    : join(tmpdir(), 'codeflow-workspaces');

  const nodeEnv = env.NODE_ENV || 'development';

  // MOO-67 Commit 6: private-use auth gate + server-held GitHub credential
  // + repository allowlist. All required, always -- no environment-based
  // bypass, so a missing NODE_ENV=production can't silently ship an
  // unprotected instance. Set these explicitly for local development too.
  const authToken = env.AUTH_TOKEN || '';
  if (!authToken) {
    errors.push('AUTH_TOKEN is required — this is the shared secret private clients must send as `Authorization: Bearer <token>`.');
  }

  const githubToken = env.GITHUB_TOKEN || '';
  if (!githubToken) {
    errors.push('GITHUB_TOKEN is required — a GitHub personal access token the server uses to fetch repository content.');
  }

  const allowedRepos = parseList(env.ALLOWED_REPOS).map((s) => s.toLowerCase());
  const allowedOwners = parseList(env.ALLOWED_OWNERS).map((s) => s.toLowerCase());
  if (allowedRepos.length === 0 && allowedOwners.length === 0) {
    errors.push(
      'At least one of ALLOWED_REPOS (comma-separated owner/repo) or ALLOWED_OWNERS (comma-separated owner/org names) is required.'
    );
  }

  const rateLimitPerMinute = env.RATE_LIMIT_PER_MINUTE ? Number(env.RATE_LIMIT_PER_MINUTE) : 30;
  if (!Number.isInteger(rateLimitPerMinute) || rateLimitPerMinute <= 0) {
    errors.push(`RATE_LIMIT_PER_MINUTE must be a positive integer, got: ${JSON.stringify(env.RATE_LIMIT_PER_MINUTE)}`);
  }

  const maxRequestBodyBytes = env.MAX_REQUEST_BODY_BYTES ? Number(env.MAX_REQUEST_BODY_BYTES) : 16 * 1024;
  if (!Number.isInteger(maxRequestBodyBytes) || maxRequestBodyBytes <= 0) {
    errors.push(`MAX_REQUEST_BODY_BYTES must be a positive integer, got: ${JSON.stringify(env.MAX_REQUEST_BODY_BYTES)}`);
  }

  const maxRepoFiles = env.MAX_REPO_FILES ? Number(env.MAX_REPO_FILES) : 500;
  if (!Number.isInteger(maxRepoFiles) || maxRepoFiles <= 0) {
    errors.push(`MAX_REPO_FILES must be a positive integer, got: ${JSON.stringify(env.MAX_REPO_FILES)}`);
  }

  if (errors.length > 0) {
    throw new ConfigError(errors);
  }

  return {
    port,
    repoRoot,
    distDir,
    workspaceRoot,
    nodeEnv,
    authToken,
    githubToken,
    allowedRepos,
    allowedOwners,
    rateLimitPerMinute,
    maxRequestBodyBytes,
    maxRepoFiles,
  };
}
