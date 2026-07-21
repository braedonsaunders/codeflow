// Health and readiness endpoints — MOO-67 Commit 5.
//
// /healthz: liveness -- is the process up at all.
// /readyz: readiness -- can it actually serve real requests right now
// (build output present, workspace root writable). Distinguishing the two
// matters once this runs on Railway: a liveness-check failure means
// "restart the container," a readiness-check failure means "stop routing
// traffic here, but don't necessarily restart" (e.g. mid-deploy, or a
// transient filesystem issue).
import { access, constants } from 'node:fs/promises';
import { join } from 'node:path';

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(payload);
}

/** @param {{config: object}} deps */
export function createHealthHandler({ config }) {
  return async function handleHealth(req, res) {
    sendJson(res, 200, {
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      nodeVersion: process.version,
      env: config.nodeEnv,
    });
  };
}

/** @param {{config: object}} deps */
export function createReadinessHandler({ config }) {
  return async function handleReadiness(req, res) {
    const checks = {};

    checks.buildOutput = await access(join(config.distDir, 'index.html'), constants.F_OK)
      .then(() => ({ ok: true }))
      .catch((err) => ({ ok: false, error: err.code || err.message }));

    checks.workspaceRoot = await access(config.workspaceRoot, constants.W_OK)
      .then(() => ({ ok: true }))
      .catch((err) => ({ ok: false, error: err.code || err.message }));

    const ready = Object.values(checks).every((c) => c.ok);
    sendJson(res, ready ? 200 : 503, { status: ready ? 'ready' : 'not_ready', checks });
  };
}
