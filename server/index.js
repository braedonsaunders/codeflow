// Server entry point — MOO-67 Commit 5.
//
// Establishes the durable application shell: config validated at startup
// (fail fast, not on first request), health/readiness endpoints, a
// namespaced /api/analyze endpoint, structured per-request logging, and
// the request-scoped workspace abstraction later analyzers (MOO-70/71)
// will build on. GitHub credentials, an auth gate, and request validation
// beyond "does this path exist in the repo" are Commit 6's job — nothing
// here can reach outside the repo's own checked-in files.
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { loadConfig, ConfigError } from './lib/config.js';
import { log, generateRequestId } from './lib/logger.js';
import { WorkspaceManager } from './lib/workspace.js';
import { createStaticHandler } from './lib/static.js';
import { createHealthHandler, createReadinessHandler } from './lib/health.js';
import { createAnalyzeHandler } from './routes/analyze.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');

async function main() {
  let config;
  try {
    config = loadConfig({ repoRoot });
  } catch (err) {
    if (err instanceof ConfigError) {
      // Actionable, not a stack trace: this is meant to be read by whoever
      // just ran `npm start`/deployed to Railway.
      process.stderr.write('[codeflow-server] ' + err.message + '\n');
      process.exit(1);
    }
    throw err;
  }

  const workspaceManager = new WorkspaceManager(config.workspaceRoot);
  try {
    await workspaceManager.ensureRoot();
  } catch (err) {
    process.stderr.write(
      `[codeflow-server] Workspace root ${config.workspaceRoot} is not writable: ${err.message}\n`
    );
    process.exit(1);
  }

  const handleStatic = createStaticHandler(config.distDir);
  const handleHealth = createHealthHandler({ config });
  const handleReadiness = createReadinessHandler({ config });
  const handleAnalyze = createAnalyzeHandler({ config, workspaceManager });

  const server = createServer(async (req, res) => {
    const requestId = generateRequestId();
    const start = Date.now();
    res.setHeader('X-Request-Id', requestId);

    const url = new URL(req.url || '/', 'http://localhost');
    try {
      if (url.pathname === '/healthz') {
        await handleHealth(req, res);
      } else if (url.pathname === '/readyz') {
        await handleReadiness(req, res);
      } else if (url.pathname === '/api/analyze' && req.method === 'POST') {
        await handleAnalyze(req, res, requestId);
      } else {
        await handleStatic(req, res);
      }
    } catch (err) {
      log('error', 'unhandled request error', { requestId, message: err && err.message });
      if (!res.headersSent) res.writeHead(500);
      res.end('Internal server error');
    } finally {
      log('info', 'request', {
        requestId,
        method: req.method,
        path: url.pathname,
        status: res.statusCode,
        durationMs: Date.now() - start,
      });
    }
  });

  server.listen(config.port, () => {
    log('info', 'server started', {
      port: config.port,
      distDir: config.distDir,
      workspaceRoot: config.workspaceRoot,
      nodeEnv: config.nodeEnv,
      nodeVersion: process.version,
    });
  });
}

main().catch((err) => {
  process.stderr.write('[codeflow-server] fatal startup error: ' + (err.stack || err.message) + '\n');
  process.exit(1);
});
