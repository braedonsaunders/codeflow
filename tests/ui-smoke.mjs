// Focused browser smoke coverage for MOO-67 Commit 4A.
//
// Not part of the zero-setup `node --test tests/*.test.mjs` suite (like
// codeflow-repo-smoke.mjs and html-inline-script-analysis.smoke.mjs, this
// needs a running server first — see docs/baseline.md). Covers exactly the
// behaviors Commit 4A's checklist calls out, using deterministic DOM/
// interaction assertions rather than screenshots:
//   - a repository (here: a local folder, to avoid a GitHub network
//     dependency) loads and the primary graph appears;
//   - selecting a graph node updates the existing detail-panel state;
//   - visualization switching still works;
//   - route/hash restoration (via ?repo=owner/name, no ?run=1 — this only
//     pre-fills the input field, it does not trigger a network call) does
//     not crash;
//   - browser back/forward does not corrupt the view or throw;
//   - no real console errors are emitted throughout.
//
// Usage: node tests/ui-smoke.mjs [url]
// Requires the target URL to already be serving the built (or dev) app:
//   npm run build && npm start   (production build, default localhost:3000)
//   npm run dev                  (dev server, pass its URL explicitly)
import { chromium } from 'playwright';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const url = process.argv[2] || 'http://localhost:3000/';
const fixtureRoot = join(__dirname, 'fixtures', 'golden-world');

// Same known-benign Babel Standalone notice filtered in
// scripts/verify-worker-analysis.mjs — see that file's comment for why.
const KNOWN_NOISE = /\[BABEL\] Note: The code generator has deoptimised the styling/;

function assert(condition, message) {
  if (!condition) throw new Error('Assertion failed: ' + message);
}

const failures = [];
function step(name, fn) {
  return async (...args) => {
    try {
      await fn(...args);
      console.log('ok   - ' + name);
    } catch (err) {
      failures.push({ name, error: err });
      console.log('FAIL - ' + name + ': ' + err.message);
    }
  };
}

const browser = await chromium.launch();
const page = await browser.newPage();

const consoleErrors = [];
page.on('console', (msg) => {
  if (msg.type() !== 'error') return;
  const text = msg.text();
  if (KNOWN_NOISE.test(text)) return;
  consoleErrors.push(text);
});
page.on('pageerror', (err) => {
  consoleErrors.push('[pageerror] ' + (err.stack || err.message));
});

await step('repository (local folder) loads and the primary graph appears', async () => {
  await page.goto(url, { waitUntil: 'networkidle' });
  // Playwright resolves a real directory tree (with correct
  // webkitRelativePath per file) for [webkitdirectory] inputs when given a
  // directory path directly, rather than a file-path array.
  await page.setInputFiles('input[webkitdirectory]', fixtureRoot);
  await page.waitForSelector('svg circle.nc', { timeout: 15000 });
  const nodeCount = await page.locator('svg circle.nc').count();
  assert(nodeCount > 0, `expected at least one graph node, found ${nodeCount}`);
})();

await step('selecting a graph node updates the detail panel', async () => {
  await page.locator('svg circle.nc').first().click();
  await page.waitForSelector('.panel-title', { timeout: 5000 });
  const title = (await page.locator('.panel-title').first().textContent()) || '';
  assert(title.trim().length > 0, 'panel title should show the selected file name');
})();

await step('visualization switching still works', async () => {
  const select = page.locator('select[aria-label="Visualization type"]');
  await select.selectOption('treemap');
  await page.waitForSelector('.treemap-container', { timeout: 5000 });
  await select.selectOption('graph');
  await page.waitForSelector('svg circle.nc', { timeout: 5000 });
})();

await step('route/hash restoration (?repo=) does not crash and does not auto-run', async () => {
  const shareUrl = new URL(url);
  shareUrl.searchParams.set('repo', 'octocat/Hello-World');
  await page.goto(shareUrl.href, { waitUntil: 'networkidle' });
  // No ?run=1, so this must only prefill the input, never trigger a fetch.
  await page.waitForFunction(
    () => document.querySelector('[aria-label="Repository URL"]')?.value?.includes('octocat/Hello-World'),
    { timeout: 5000 }
  );
})();

await step('browser back/forward does not corrupt the view', async () => {
  await page.goBack({ waitUntil: 'networkidle' });
  await page.goForward({ waitUntil: 'networkidle' });
  // The app should still be responsive — the folder-open control must
  // exist (it's intentionally display:none, so "attached" not "visible").
  await page.waitForSelector('input[webkitdirectory]', { timeout: 5000, state: 'attached' });
})();

await step('no real console errors were emitted across the run', async () => {
  assert(consoleErrors.length === 0, `console errors: ${JSON.stringify(consoleErrors, null, 2)}`);
})();

await browser.close();

if (failures.length > 0) {
  console.log(`\n${failures.length} step(s) failed:`);
  for (const f of failures) console.log(' - ' + f.name + ': ' + f.error.message);
  process.exit(1);
}
console.log('\nUI smoke suite passed.');
