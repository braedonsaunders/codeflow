// Server configuration — MOO-67 Commit 5.
//
// Reads config from environment variables, validating fail-fast at
// startup rather than lazily on first request. No GitHub credential/auth
// config here yet — that's Commit 6's job.
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

  if (errors.length > 0) {
    throw new ConfigError(errors);
  }

  return { port, repoRoot, distDir, workspaceRoot, nodeEnv };
}
