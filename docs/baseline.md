# CodeFlow baseline (MOO-67, Commits 1-3)

This document is the regression-protection reference point for the Code
Reality Layer construction work (MOO-66 and its sub-issues). It records what
"working" meant before modularization began, so later commits can prove they
preserved it rather than assert it.

## Pinned starting revision

- Repo: `OwenTanzer/codeflow` (`origin`), local clone at `codeflow-tool/`
- Commit: `b36869e68255633ea8f8a5bc0bada95c3f62d708` (branch `main`)
- Upstream: `braedonsaunders/codeflow` (`upstream`), same commit as of this baseline
- Reference-only remote: `sabare/codeflow` (`sabare-reference`, `1922fcc30de5d6dfb767200e58e0256fceb6528f`) — not merged, consult only if a capability is missing upstream

## Startup commands (current, pre-modularization)

| Purpose | Command |
|---|---|
| Run the app, zero-tooling | `open index.html` — **broken as of Commit 3, see the flagged regression below.** Opening the file directly (`file://`) now crashes with `ReferenceError: calcHealth is not defined` because the browser blocks the analyzer module's `import` under CORS for the `file://` origin. |
| Run the app, dev server (added Commit 2) | `npm install && npm run dev` — Vite dev server; now genuinely module-based as of Commit 3 (analyzer code lives in `src/analyzer.js`) |
| Production build (added Commit 2) | `npm run build` — Vite build, output to `dist/` (as of Commit 3: `dist/index.html` ~369KB + a separate hashed `dist/assets/index-*.js` ~117KB carrying the analyzer module, gitignored) |
| Serve the production build (added Commit 2) | `npm run start` (or `node server/index.js`) — minimal static file server over `dist/`, `PORT` env var (default `3000`); rejects path-traversal requests, falls back to `index.html` for unmatched paths |
| Run the full test suite | `node --test tests/*.test.mjs` (62 tests as of Commit 2; `node --test tests/` alone fails — Node's directory-mode test discovery does not pick up this repo's flat `tests/*.test.mjs` layout) |
| Run the analyzer against an arbitrary repo | `node tests/codeflow-repo-smoke.mjs [--json] [--limit=<files>] <repo-dir>...` |
| Run the GitHub Action analyzer locally | `cd card && node index.js` — writes `.github/codeflow-card.svg` and `.github/codeflow-card.json` **relative to `card/`** when `GITHUB_WORKSPACE` is unset (it falls back to `process.cwd()`); do not run this from the repo root without setting `GITHUB_WORKSPACE`, or it will analyze `card/` itself and leave stray output there |
| `card/` package script | `npm run dry-run` from `card/` (alias for `node index.js`) |

### Commit 2 scope note

`vite.config.js` points the build at `index.html`. At Commit 2 this produced
an output nearly byte-identical to the source, since the app's inline
script was left untouched — that changed in Commit 3 (below).

`server/index.js` is still a placeholder as of Commit 3: it serves `dist/`
as static files and has no analysis endpoints, authentication, health
checks, or request-workspace abstraction yet — those are Commit 5 and 6.

Node version used to establish this baseline: `v24.16.0`.

### Commit 3 — analyzer extraction, and a flagged regression

`Parser`, `buildAnalysisData`, `calcBlast`, `calcHealth`, `runAnalysisData`,
`createAnalysisWorkerSource`, `GitHub`, and the rest of the analyzer's
top-level names (previously inline in `index.html` between
`CODEFLOW_ANALYZER_START`/`END` and `CODEFLOW_METRICS_START`/`END` marker
comments) now live in **`src/analyzer.js`**, a real ES module. This is the
one canonical implementation:

- **Browser main thread**: `index.html` loads it via
  `<script type="module">import * as analyzer from './src/analyzer.js'; Object.assign(window, analyzer);</script>`,
  placed right before the classic `<script type="text/babel">` app script so
  the rest of that (unmodified, still non-module) script keeps referencing
  `Parser`/`GitHub`/etc. as bare identifiers, resolving through `window`
  exactly as it did when they were local top-level declarations in the same
  script. `Object.assign(window, analyzer)` rather than a hand-picked list
  of names, so this bridge can't silently drift out of sync with
  `src/analyzer.js`'s export statement.
- **The analysis Web Worker** (`createAnalysisWorkerSource`, still inside
  `src/analyzer.js`): previously fetched the *page's own HTML*
  (`fetch(window.location.href)`) and sliced out the analyzer block by
  string marker, because the analyzer lived inline in that HTML. Now that
  it's a separate module, it fetches **its own module URL**
  (`fetch(import.meta.url)`) instead — `import.meta.url` resolves correctly
  to `/src/analyzer.js` in dev or the hashed built asset in production,
  either way giving the worker its own real source text with no page
  involved. New internal markers, `CODEFLOW_CORE_START`/`END` (inside
  `src/analyzer.js`, distinct from the old `CODEFLOW_ANALYZER_START`/`END`
  which no longer exist anywhere), delimit exactly the "pure analysis"
  slice — `Parser` through `calcHealth` — that gets embedded into the
  classic (non-module) worker script. `runAnalysisData` and
  `createAnalysisWorkerSource` themselves are deliberately **excluded** from
  that slice: their own source text contains `import.meta.url`, and
  `import.meta` is a syntax error when parsed as part of a classic
  (non-module) script — embedding it would have broken the worker outright.
  Verified end-to-end (real `Worker` + `Blob` + `fetch`, not mocked) via
  `scripts/verify-worker-analysis.mjs` against both the dev server and a
  production build — worker constructed, module fetched, correct
  file/function counts, zero console errors.
- **`card/lib/analyzer.js`**: previously VM-extracted the marker block from
  `index.html` text (`vm.createContext` + `vm.Script`). Now `require()`s
  `src/analyzer.js` directly — Node 22.12+ (this baseline: v24.16.0) added
  stable synchronous `require(esm)` support, confirmed working empirically
  before relying on it.
- **The Node test suite**: every test that used to VM-extract the marker
  block from `index.html` (`tests/codeflow-golden.test.mjs`,
  `tests/codeflow-repo-smoke.mjs`, `tests/architecture-diagram.test.mjs`,
  `tests/duplicate-function-resolution.test.mjs`,
  `tests/layer-violation-direction.test.mjs`,
  `tests/numeric-fn-name.test.mjs`, `tests/security-precision.test.mjs`, and
  `tests/html-inline-script-analysis.smoke.js`, the last renamed to `.mjs`
  — see below) now does `await import('../src/analyzer.js')` instead. All
  still stub `globalThis.TreeSitter`/`Babel`/`acorn` to `undefined` before
  importing (Parser's methods reference these as ambient globals only when
  actually invoked, not at import time — same requirement as before, just
  via `globalThis` mutation instead of a `vm.createContext` object, since a
  real ES module resolves unqualified identifiers through `globalThis`, not
  through an injectable sandbox object).

**Two pre-existing leaks fixed as a side effect.** `getSecurityScanContent`
and `isSanitizedPreviewRenderer` used to be defined just *outside* the
marker block (`index.html:744-759`, pre-Commit-3 line numbers), meaning
every Node-side consumer had to inject **simplified stub versions** of them
(e.g. the stub `getSecurityScanContent` was missing the real one's
`index.html`-self-exclusion special case for the security scanner). They're
now moved into `src/analyzer.js` for real, so Node-side analysis uses the
exact same implementation the browser does — closing a latent
browser/Node behavioral divergence, not just a code-location cleanup.

**Known regression, deliberately not silently fixed:** opening `index.html`
directly via `file://` (the project's original "no build, no install, just
open the file" pitch, and the literal Commit 2 rollback guarantee — "keep
the original single-file entry available") now **crashes**
(`ReferenceError: calcHealth is not defined`), because Chromium blocks the
analyzer module's `import` under CORS for the `file://` origin (confirmed
via headless Chromium, not assumed). The app still works correctly served
over any local HTTP server — `npm run dev` or `npm run build && npm start`,
both already established in Commit 2 — so this is not a functional dead
end, but it is a real loss of the zero-tooling `open index.html` workflow
the current public README still advertises. Properly restoring `file://`
support would mean build-time-inlining `src/analyzer.js`'s content back
into a classic script for the shipped `dist/index.html` (via a custom Vite
transform) while keeping Node/test consumers on the real ES module — not
done here to avoid open-ended scope inside a "modularize the build" commit.
Flagging this explicitly for a product decision rather than assuming it's
fine: MOO-66's broader direction is a Railway-hosted, server-owned-auth
application (see MOO-67 commits 5-7), which may make the standalone
`file://` mode moot anyway — but that's a call for whoever's driving product
direction, not an engineering default to quietly accept.

## Baseline snapshot mechanism

`tests/baseline-snapshot.test.mjs` runs the existing `tests/codeflow-repo-smoke.mjs`
script — the same Node-side analyzer path `card/`'s GitHub Action already
uses — against every fixture under `tests/fixtures/baseline-snapshots/*.json`
has a committed snapshot for, and asserts the live structural output matches.
This is additive to (not a replacement for) the existing
`tests/codeflow-golden.test.mjs`, which already asserts exact file/function/
connection identity for `golden-world`; the new snapshots widen coverage to
fields the golden test doesn't check exactly (`securityIssues`, `duplicates`,
`layerViolations`, `highComplexityFiles`, `topLanguages`) and extend it to the
other three committed fixtures (`web-app-world`, `security-precision-world`,
`vault`).

To regenerate a snapshot after an intentional analyzer change:

```
node tests/codeflow-repo-smoke.mjs --json tests/fixtures/<name> > tests/fixtures/baseline-snapshots/<name>.json
```

then manually remove the `path` and `durationMs` fields (see below) before
committing — the test will otherwise pass trivially by comparing a snapshot
against itself.

## Known nondeterministic fields

Two fields in `codeflow-repo-smoke.mjs`'s JSON output are not stable across
machines or runs, and are stripped before comparison in
`baseline-snapshot.test.mjs`:

- **`path`** — the absolute filesystem path to the analyzed fixture; differs by checkout location.
- **`durationMs`** — wall-clock analysis time; differs by machine load and hardware.

Everything else in the smoke output (`analyzedFiles`, `functions`,
`connections`, `patterns`, `securityIssues`, `highSecurityIssues`,
`duplicates`, `layerViolations`, `highComplexityFiles`, `loc`,
`topLanguages`, `errors`) is deterministic for a fixed fixture and fixed
analyzer source.

Separately, within `buildAnalysisData()`'s own output, array **ordering** is
not guaranteed for `files`, `functions`, or `connections` — the existing
`codeflow-golden.test.mjs` test already works around this by `.sort()`-ing
before asserting. Any future snapshot or test that compares these arrays
directly (rather than via the smoke script's aggregate counts) must sort
first or it will be spuriously flaky.

`churn` is hardcoded to `0` in both `codeflow-repo-smoke.mjs` and
`codeflow-golden.test.mjs`'s fixture harness (git-history-derived churn is
not exercised by either) — not a source of nondeterminism today, but a gap
worth knowing about if a future test starts asserting on it.

## What this baseline does not cover

- Browser-only behavior (D3 rendering, drag/zoom/click interactions, local
  file drag-and-drop, GitHub PR fetch UI) has no automated snapshot yet —
  Commit 1's "UI startup" check is manual (`open index.html`, confirm no
  console errors) per MOO-67's checklist. Automating this is not required by
  MOO-67 Commit 1 and isn't added here to avoid scope creep.
- The `card/` dry-run is exercised manually (see Startup commands above) but
  has no committed snapshot of its own SVG/state output; its underlying
  analyzer path is already covered by the fixture snapshots above via the
  same `buildAnalysisData()` call.
