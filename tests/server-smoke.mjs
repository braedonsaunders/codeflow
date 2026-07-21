// Server integration smoke test — MOO-67 Commit 5.
//
// Not part of the zero-setup `node --test tests/*.test.mjs` suite (same
// reason as codeflow-repo-smoke.mjs and tests/ui-smoke.mjs — this needs
// dist/ already built). Spawns the real server process (not a mock) on an
// isolated port + workspace root, and exercises exactly what Commit 5's
// checklist checks: the server serves the app, health/readiness report
// correctly, /api/analyze produces the same result as the existing
// analyzer pipeline, path-traversal/missing-path requests are rejected,
// and workspace cleanup leaves the configured root empty afterward.
//
// Usage: node tests/server-smoke.mjs (run `npm run build` first)
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const port = 3999;
const baseUrl = `http://localhost:${port}`;

function assert(condition, message) {
  if (!condition) throw new Error('Assertion failed: ' + message);
}

const failures = [];
async function step(name, fn) {
  try {
    await fn();
    console.log('ok   - ' + name);
  } catch (err) {
    failures.push({ name, error: err });
    console.log('FAIL - ' + name + ': ' + err.message);
  }
}

async function waitForReady(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(baseUrl + '/readyz');
      if (res.ok) return;
    } catch {
      // server not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not become ready in time');
}

const workspaceRoot = await mkdtemp(join(tmpdir(), 'codeflow-server-smoke-'));
const child = spawn(process.execPath, [join(repoRoot, 'server', 'index.js')], {
  cwd: repoRoot,
  env: { ...process.env, PORT: String(port), WORKSPACE_ROOT: workspaceRoot },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const serverLogs = [];
child.stdout.on('data', (d) => serverLogs.push(d.toString()));
child.stderr.on('data', (d) => serverLogs.push(d.toString()));

try {
  await waitForReady(10000);

  await step('serves the built application', async () => {
    const res = await fetch(baseUrl + '/');
    assert(res.status === 200, `expected 200, got ${res.status}`);
    const body = await res.text();
    assert(body.includes('<div id="root">'), 'expected the app shell markup');
  });

  await step('/healthz reports ok with runtime info', async () => {
    const res = await fetch(baseUrl + '/healthz');
    assert(res.status === 200, `expected 200, got ${res.status}`);
    const json = await res.json();
    assert(json.status === 'ok', 'expected status ok');
    assert(typeof json.nodeVersion === 'string', 'expected nodeVersion');
  });

  await step('/readyz reports ready with passing checks', async () => {
    const res = await fetch(baseUrl + '/readyz');
    assert(res.status === 200, `expected 200, got ${res.status}`);
    const json = await res.json();
    assert(json.status === 'ready', 'expected status ready');
    assert(json.checks.buildOutput.ok === true, 'expected buildOutput check to pass');
    assert(json.checks.workspaceRoot.ok === true, 'expected workspaceRoot check to pass');
  });

  await step('/api/analyze matches the known golden-world baseline', async () => {
    const res = await fetch(baseUrl + '/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'tests/fixtures/golden-world' }),
    });
    assert(res.status === 200, `expected 200, got ${res.status}`);
    const json = await res.json();
    assert(json.stats.files === 6, `expected 6 files, got ${json.stats.files}`);
    assert(json.stats.functions === 7, `expected 7 functions, got ${json.stats.functions}`);
    assert(json.stats.connections === 6, `expected 6 connections, got ${json.stats.connections}`);
  });

  await step('/api/analyze rejects a path outside the repository', async () => {
    const res = await fetch(baseUrl + '/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '../../../../etc' }),
    });
    assert(res.status === 400, `expected 400, got ${res.status}`);
  });

  await step('/api/analyze rejects a request with no path', async () => {
    const res = await fetch(baseUrl + '/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert(res.status === 400, `expected 400, got ${res.status}`);
  });

  await step('workspace root is empty after all requests (cleanup ran)', async () => {
    const entries = await readdir(workspaceRoot);
    assert(entries.length === 0, `expected an empty workspace root, found: ${entries.join(', ')}`);
  });
} finally {
  child.kill();
  await rm(workspaceRoot, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.log(`\n${failures.length} step(s) failed:`);
  for (const f of failures) console.log(' - ' + f.name + ': ' + f.error.message);
  console.log('\n--- server logs ---');
  console.log(serverLogs.join(''));
  process.exit(1);
}
console.log('\nServer smoke suite passed.');
