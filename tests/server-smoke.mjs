// Server integration smoke test — MOO-67 Commits 5-6.
//
// Not part of the zero-setup `node --test tests/*.test.mjs` suite (same
// reason as codeflow-repo-smoke.mjs and tests/ui-smoke.mjs — this needs
// dist/ already built). Spawns the real server process (not a mock) on an
// isolated port + workspace root, and exercises exactly what Commits 5-6's
// checklists check: static serving, health/readiness, the local-path and
// GitHub-backed analyze endpoints, auth rejection, allowlist rejection,
// input validation, rate limiting, and workspace cleanup.
//
// Requires a real GitHub credential to verify the GitHub-backed path
// end-to-end (not just "didn't crash with a fake token" — GitHub 401s an
// invalid token even for public data) — uses whatever `gh auth token`
// already has authenticated in this environment, same PAT decided on for
// the server's own GITHUB_TOKEN.
//
// Usage: node tests/server-smoke.mjs (run `npm run build` first, and be
// signed in via `gh auth login`)
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const port = 3999;
const baseUrl = `http://localhost:${port}`;
const AUTH_TOKEN = 'smoke-test-secret';

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

function authed(headers = {}) {
  return { Authorization: `Bearer ${AUTH_TOKEN}`, ...headers };
}

let githubToken;
try {
  githubToken = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
} catch (err) {
  console.error(
    'Could not get a GitHub token via `gh auth token` — required to verify the ' +
      'GitHub-backed /api/analyze-repo path end-to-end. Run `gh auth login` first.'
  );
  process.exit(1);
}

const workspaceRoot = await mkdtemp(join(tmpdir(), 'codeflow-server-smoke-'));
const child = spawn(process.execPath, [join(repoRoot, 'server', 'index.js')], {
  cwd: repoRoot,
  env: {
    ...process.env,
    PORT: String(port),
    WORKSPACE_ROOT: workspaceRoot,
    AUTH_TOKEN,
    GITHUB_TOKEN: githubToken,
    ALLOWED_OWNERS: 'octocat',
    // The rate limiter is keyed per client IP, shared across every request
    // this whole test makes (they all originate from localhost) -- high
    // enough that the ~7 budget-consuming functional requests above don't
    // trip it prematurely, low enough that the dedicated rate-limit test
    // (which fires well past the remainder) still exceeds it quickly.
    RATE_LIMIT_PER_MINUTE: '15',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const serverLogs = [];
child.stdout.on('data', (d) => serverLogs.push(d.toString()));
child.stderr.on('data', (d) => serverLogs.push(d.toString()));

try {
  await waitForReady(10000);

  await step('serves the built application (no auth required)', async () => {
    const res = await fetch(baseUrl + '/');
    assert(res.status === 200, `expected 200, got ${res.status}`);
    const body = await res.text();
    assert(body.includes('<div id="root">'), 'expected the app shell markup');
  });

  await step('/healthz reports ok with runtime info (no auth required)', async () => {
    const res = await fetch(baseUrl + '/healthz');
    assert(res.status === 200, `expected 200, got ${res.status}`);
    const json = await res.json();
    assert(json.status === 'ok', 'expected status ok');
    assert(typeof json.nodeVersion === 'string', 'expected nodeVersion');
  });

  await step('/readyz reports ready with passing checks (no auth required)', async () => {
    const res = await fetch(baseUrl + '/readyz');
    assert(res.status === 200, `expected 200, got ${res.status}`);
    const json = await res.json();
    assert(json.status === 'ready', 'expected status ready');
    assert(json.checks.buildOutput.ok === true, 'expected buildOutput check to pass');
    assert(json.checks.workspaceRoot.ok === true, 'expected workspaceRoot check to pass');
  });

  await step('/api/analyze rejects an anonymous (no Authorization header) request', async () => {
    const res = await fetch(baseUrl + '/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'tests/fixtures/golden-world' }),
    });
    assert(res.status === 401, `expected 401, got ${res.status}`);
  });

  await step('/api/analyze rejects a request with the wrong token', async () => {
    const res = await fetch(baseUrl + '/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wrong-token' },
      body: JSON.stringify({ path: 'tests/fixtures/golden-world' }),
    });
    assert(res.status === 401, `expected 401, got ${res.status}`);
  });

  await step('/api/analyze (authenticated) matches the known golden-world baseline', async () => {
    const res = await fetch(baseUrl + '/api/analyze', {
      method: 'POST',
      headers: authed({ 'Content-Type': 'application/json' }),
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
      headers: authed({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ path: '../../../../etc' }),
    });
    assert(res.status === 400, `expected 400, got ${res.status}`);
  });

  await step('/api/analyze rejects a request with no path', async () => {
    const res = await fetch(baseUrl + '/api/analyze', {
      method: 'POST',
      headers: authed({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({}),
    });
    assert(res.status === 400, `expected 400, got ${res.status}`);
  });

  await step('/api/analyze-repo (real GitHub, allowlisted owner) analyzes octocat/Hello-World', async () => {
    const res = await fetch(baseUrl + '/api/analyze-repo', {
      method: 'POST',
      headers: authed({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ owner: 'octocat', repo: 'Hello-World' }),
    });
    const json = await res.json();
    assert(res.status === 200, `expected 200, got ${res.status}: ${JSON.stringify(json)}`);
    assert(json.stats.files >= 1, `expected at least 1 file, got ${json.stats.files}`);
    assert(typeof json.resolvedRef === 'string' && json.resolvedRef.length > 0, 'expected a resolved ref');
  });

  await step('/api/analyze-repo respects an explicit ref (named branch), not just the default branch', async () => {
    // Regression check: fetchTree/fetchAllContents must use the requested
    // ref, not silently the repo's default branch (GitHub.scanTree, which
    // this deliberately does NOT reuse, has exactly that bug).
    const res = await fetch(baseUrl + '/api/analyze-repo', {
      method: 'POST',
      headers: authed({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ owner: 'octocat', repo: 'Hello-World', ref: 'test' }),
    });
    const json = await res.json();
    assert(res.status === 200, `expected 200, got ${res.status}: ${JSON.stringify(json)}`);
    assert(json.resolvedRef === 'test', `expected resolvedRef "test", got ${json.resolvedRef}`);
  });

  await step('/api/analyze-repo resolves a PR to its fork\'s tree, not the base repo\'s', async () => {
    // Regression check: a PR's head commit usually lives in a fork
    // (head.repo != the base owner/repo) -- confirmed the hard way while
    // building this endpoint, fetching the base repo's tree for a fork's
    // SHA 404s. PR #10587 against octocat/Hello-World is from
    // XiaoPangDaiMa/Hello-World; if this specific PR/fork ever disappears,
    // this check may need a new example PR, same as any test pinned to
    // real external repo state.
    const res = await fetch(baseUrl + '/api/analyze-repo', {
      method: 'POST',
      headers: authed({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ owner: 'octocat', repo: 'Hello-World', pr: 10587 }),
    });
    const json = await res.json();
    assert(res.status === 200, `expected 200, got ${res.status}: ${JSON.stringify(json)}`);
    assert(json.resolvedRef === '736d73334223554b9a9501d7a004b9f770ee41ec', `expected the PR's head SHA, got ${json.resolvedRef}`);
  });

  await step('/api/analyze-repo returns a clean 502 (not a generic 500) when a ref genuinely cannot be found', async () => {
    // Regression check: GitHub.request()'s errorMap-driven errors are
    // plain Errors, not GithubFetchError -- without apiRequest() wrapping
    // them, this fell through to a generic 500 "Analysis failed" instead
    // of GitHub's own "not found" message.
    const res = await fetch(baseUrl + '/api/analyze-repo', {
      method: 'POST',
      headers: authed({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ owner: 'octocat', repo: 'Hello-World', ref: 'no-such-branch-xyz' }),
    });
    const json = await res.json();
    assert(res.status === 502, `expected 502, got ${res.status}`);
    assert(/not found/i.test(json.error), `expected a "not found" message, got: ${json.error}`);
  });

  await step('/api/analyze-repo rejects a repository not on the allowlist, before fetching it', async () => {
    const res = await fetch(baseUrl + '/api/analyze-repo', {
      method: 'POST',
      headers: authed({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ owner: 'torvalds', repo: 'linux' }),
    });
    assert(res.status === 403, `expected 403, got ${res.status}`);
  });

  await step('/api/analyze-repo rejects a malformed owner before any allowlist/fetch step', async () => {
    const res = await fetch(baseUrl + '/api/analyze-repo', {
      method: 'POST',
      headers: authed({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ owner: 'in valid!', repo: 'Hello-World' }),
    });
    assert(res.status === 400, `expected 400, got ${res.status}`);
  });

  await step('/api/analyze-repo rejects specifying both ref and pr', async () => {
    const res = await fetch(baseUrl + '/api/analyze-repo', {
      method: 'POST',
      headers: authed({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ owner: 'octocat', repo: 'Hello-World', ref: 'master', pr: 1 }),
    });
    assert(res.status === 400, `expected 400, got ${res.status}`);
  });

  await step('rate limiting returns 429 once the per-minute budget (configured to 15) is exceeded', async () => {
    // 7 budget-consuming requests already happened above; fire well past
    // the remainder regardless of exact prior count.
    const results = [];
    for (let i = 0; i < 12; i++) {
      const res = await fetch(baseUrl + '/api/analyze', {
        method: 'POST',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ path: 'tests/fixtures/golden-world' }),
      });
      results.push(res.status);
    }
    assert(results.some((s) => s === 429), `expected at least one 429 among ${results.join(',')}`);
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
