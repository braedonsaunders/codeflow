// POST /api/analyze -- MOO-67 Commit 5.
//
// Scope, deliberately bounded: takes a path already present on the
// server's own filesystem (relative to the repo root -- e.g. one of the
// checked-in tests/fixtures/*), copies it into a request-scoped workspace,
// runs the existing analyzer, and cleans up. This exists to prove the
// server-side pipeline works end-to-end (workspace lifecycle + structured
// logging + the analyzer itself) using local paths only.
//
// Fetching from GitHub and validating who's allowed to ask for what are
// Commit 6's job -- this endpoint has no GitHub credential and no auth
// gate yet, so it intentionally can't reach outside the repo's own
// checked-in fixtures.
import { cp } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { analyzeDirectory } from '../lib/analyzer-bridge.js';
import { createRequestLogger } from '../lib/logger.js';

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  return JSON.parse(raw);
}

/** Reject any path that resolves outside repoRoot (symlinks, `..`, absolute overrides). */
function resolveWithinRepo(repoRoot, requestedPath) {
  const target = resolve(repoRoot, requestedPath);
  const rel = relative(repoRoot, target);
  if (rel === '' || rel.startsWith('..' + sep) || rel === '..' || resolve(repoRoot, rel) !== target) {
    return null;
  }
  return target;
}

/** @param {{config: object, workspaceManager: import('../lib/workspace.js').WorkspaceManager}} deps */
export function createAnalyzeHandler({ config, workspaceManager }) {
  return async function handleAnalyze(req, res, requestId) {
    const log = createRequestLogger(requestId);
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      return sendJson(res, 400, { error: 'Request body must be valid JSON' });
    }

    const requestedPath = body && body.path;
    if (typeof requestedPath !== 'string' || !requestedPath) {
      return sendJson(res, 400, { error: 'Request body must include a "path" string' });
    }

    const targetAbs = resolveWithinRepo(config.repoRoot, requestedPath);
    if (!targetAbs) {
      log.warn('rejected analyze request: path resolves outside the repository', { requestedPath });
      return sendJson(res, 400, { error: 'path must resolve within the repository' });
    }

    let workspace;
    try {
      workspace = await workspaceManager.createRequestWorkspace(requestId);
      log.info('workspace created', { dir: workspace.dir, requestedPath });
      await cp(targetAbs, workspace.dir, { recursive: true });
      const result = await analyzeDirectory(workspace.dir);
      log.info('analysis complete', { files: result.stats.files, functions: result.stats.functions });
      sendJson(res, 200, result);
    } catch (err) {
      log.error('analysis failed', { message: err && err.message });
      sendJson(res, 500, { error: 'Analysis failed', requestId });
    } finally {
      if (workspace) {
        await workspace.cleanup().catch((err) => {
          log.error('workspace cleanup failed', { message: err && err.message });
        });
      }
    }
  };
}
