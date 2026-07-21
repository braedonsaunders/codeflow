// Headless verification for MOO-67 Commit 3.
//
// The analyzer's Web Worker bootstrap (createAnalysisWorkerSource, in
// src/analyzer.js) is invoked here directly via window globals (the
// module's exports are bridged onto window by index.html's
// `<script type="module">` bridge — confirmed empirically, see
// docs/baseline.md).
//
// This drives runAnalysisData() with a tiny synthetic payload end-to-end
// through the real Worker + Blob + self-fetch-and-slice mechanism (not a
// mock), and reports whether a Worker was actually constructed and used
// (vs. silently falling back to the synchronous main-thread path, which
// runAnalysisData() does on any worker-bootstrap failure without surfacing
// an error — see src/analyzer.js's runAnalysisData().catch()).
//
// Usage: node scripts/verify-worker-analysis.mjs [url]
// Requires the target URL to already be serving the built app
// (`npm run build && node server/index.js`, or `npm run dev`).
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://localhost:3000/';

const browser = await chromium.launch();
const page = await browser.newPage();

const consoleMessages = [];
page.on('console', (msg) => consoleMessages.push(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', (err) => consoleMessages.push(`[pageerror] ${err.stack || err.message}`));

// Observe whether the Worker constructor actually gets used, and whether
// createAnalysisWorkerSource's `fetch(import.meta.url)` — fetching the
// analyzer module's own resolved URL, e.g. /src/analyzer.js in dev or a
// hashed /assets/*.js in a production build — actually happens.
await page.addInitScript(() => {
  window.__probe = { workerConstructions: 0, analyzerModuleFetches: 0 };
  const OriginalWorker = window.Worker;
  window.Worker = function PatchedWorker(...args) {
    window.__probe.workerConstructions += 1;
    return new OriginalWorker(...args);
  };
  window.Worker.prototype = OriginalWorker.prototype;
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const requestUrl = typeof input === 'string' ? input : input && input.url;
    if (requestUrl && /\/(analyzer|index)[^/]*\.js(\?.*)?$/.test(new URL(requestUrl, window.location.href).pathname)) {
      window.__probe.analyzerModuleFetches += 1;
    }
    return originalFetch(input, init);
  };
});

await page.goto(url, { waitUntil: 'networkidle' });

const result = await page.evaluate(async () => {
  const analyzed = [
    { path: 'a.py', name: 'a.py', folder: 'root', content: 'def foo():\n    return 1\n', functions: [{ name: 'foo', line: 1 }], lines: 2, layer: 'app', churn: 0, isCode: true },
    { path: 'b.py', name: 'b.py', folder: 'root', content: 'from a import foo\n\ndef bar():\n    return foo()\n', functions: [{ name: 'bar', line: 3 }], lines: 4, layer: 'app', churn: 0, isCode: true },
  ];
  const allFns = [
    Object.assign({}, analyzed[0].functions[0], { folder: 'root', layer: 'app' }),
    Object.assign({}, analyzed[1].functions[0], { folder: 'root', layer: 'app' }),
  ];
  try {
    const data = await window.runAnalysisData({
      analyzed,
      allFns,
      excludePatterns: [],
      progress: () => {},
      yieldFn: () => Promise.resolve(),
    });
    return {
      ok: true,
      files: data && data.stats && data.stats.files,
      functions: data && data.stats && data.stats.functions,
      probe: window.__probe,
    };
  } catch (err) {
    return { ok: false, error: err && err.message, probe: window.__probe };
  }
});

console.log('runAnalysisData result:', JSON.stringify(result, null, 2));
console.log('console/page messages:', consoleMessages.length);
consoleMessages.forEach((m) => console.log(m));

await browser.close();

const usedWorker = result.ok && result.probe && result.probe.workerConstructions > 0 && result.probe.analyzerModuleFetches > 0;
// The in-browser Babel Standalone transformer logs a benign deoptimization
// notice at console.error level once the (600KB+) inline script exceeds its
// pretty-printer's 500KB threshold — pre-existing noise, not an app error.
// Confirmed present even on an untouched baseline run; excluded here so
// this script signals real regressions instead of always failing on it.
const KNOWN_NOISE = /\[BABEL\] Note: The code generator has deoptimised the styling/;
const consoleErrors = consoleMessages.filter(
  (m) => (m.startsWith('[error]') || m.startsWith('[pageerror]')) && !KNOWN_NOISE.test(m)
);

console.log('---');
console.log('summary: ok=' + result.ok + ' usedWorker=' + usedWorker + ' consoleErrors=' + consoleErrors.length);

if (!result.ok || consoleErrors.length > 0) {
  process.exit(1);
}
