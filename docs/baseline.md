# CodeFlow baseline (MOO-67, Commits 1-4C)

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
| Run the app, zero-tooling | `open index.html` — **no longer supported (intentional, decided Commit 3, see below).** Opening the file directly (`file://`) crashes with `ReferenceError: calcHealth is not defined` because the browser blocks the analyzer module's `import` under CORS for the `file://` origin. Use `npm run dev` or `npm run build && npm start` instead. |
| Run the app, dev server (added Commit 2) | `npm install && npm run dev` — Vite dev server; now genuinely module-based as of Commit 3 (analyzer code lives in `src/analyzer.js`) |
| Production build (added Commit 2) | `npm run build` — Vite build, output to `dist/` (as of Commit 3: `dist/index.html` ~369KB + a separate hashed `dist/assets/index-*.js` ~117KB carrying the analyzer module, gitignored) |
| Serve the production build (added Commit 2) | `npm run start` (or `node server/index.js`) — minimal static file server over `dist/`, `PORT` env var (default `3000`); rejects path-traversal requests, falls back to `index.html` for unmatched paths |
| Run the full test suite | `node --test tests/*.test.mjs` (62 tests as of Commit 2; `node --test tests/` alone fails — Node's directory-mode test discovery does not pick up this repo's flat `tests/*.test.mjs` layout) |
| Run the analyzer against an arbitrary repo | `node tests/codeflow-repo-smoke.mjs [--json] [--limit=<files>] <repo-dir>...` |
| Run the GitHub Action analyzer locally | `cd card && node index.js` — writes `.github/codeflow-card.svg` and `.github/codeflow-card.json` **relative to `card/`** when `GITHUB_WORKSPACE` is unset (it falls back to `process.cwd()`); do not run this from the repo root without setting `GITHUB_WORKSPACE`, or it will analyze `card/` itself and leave stray output there |
| Run the browser UI smoke suite (added Commit 4A) | `node tests/ui-smoke.mjs [url]` — needs a server already running (`npm run build && npm start`, default `http://localhost:3000/`, or `npm run dev` with its URL passed explicitly); not part of `node --test tests/*.test.mjs` for the same reason `codeflow-repo-smoke.mjs` isn't |
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
  `src/analyzer.js` directly, using unflagged synchronous `require(esm)`.
  **This raises the real minimum Node version** — unflagged `require(esm)`
  shipped in Node **20.19.0** and **22.12.0** (not all of 20.x/22.x, and not
  21.x, which was non-LTS and reached EOL before the backport). Both
  `package.json` files' `engines` fields are `^20.19.0 || >=22.12.0`
  (exactly Vite 8's own declared constraint — already a real dependency
  here, so the project couldn't have claimed a broader range regardless),
  enforced via `.npmrc`'s `engine-strict=true` so an incompatible local
  Node fails loudly at `npm install`/`npm ci` instead of surfacing as a
  runtime `ERR_REQUIRE_ESM` later. Confirmed working empirically on
  v24.16.0 (this baseline's Node); not independently re-verified against
  20.19.0 specifically.
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

**Decided regression — `file://` support intentionally dropped.** Opening
`index.html` directly via `file://` (the project's original "no build, no
install, just open the file" pitch, and the literal Commit 2 rollback
guarantee — "keep the original single-file entry available") now
**crashes** (`ReferenceError: calcHealth is not defined`), because Chromium
blocks the analyzer module's `import` under CORS for the `file://` origin
(confirmed via headless Chromium, not assumed). This was flagged as an open
question when Commit 3 landed; **product decision (2026-07-21): accept the
removal.** MOO-67 is building toward a server-backed Railway application
with server-held GitHub credentials (Commits 5-7) — preserving double-click
local-file execution would complicate the modular architecture for little
value against that direction, and isn't worth the build-time-inlining
workaround (re-embedding `src/analyzer.js`'s content into a classic script
for `dist/index.html` via a custom Vite transform, while keeping Node/test
consumers on the real ES module) that restoring it would require. The app
still works correctly served over any local HTTP server — `npm run dev` or
`npm run build && npm start`, both established in Commit 2 — which remains
the supported self-host path. `README.md` has been updated (Quick Start,
Architecture, Contributing, FAQ) to no longer advertise the zero-install
`open index.html` workflow.

### Commit 4A — browser UI smoke suite

`tests/ui-smoke.mjs` drives the repository-view interactions Commit 4B-4E
are about to touch, before touching them, so behavioral drift from the
upcoming renderer/state extraction has something to fail against. Six
deterministic checks, no screenshots: a local folder loads and the D3
graph renders (`svg circle.nc` nodes appear), clicking a node populates
`.panel-title` in the detail panel, switching `graphConfig.vizType` via the
`[aria-label="Visualization type"]` select round-trips correctly
(`treemap` → `graph`), a `?repo=owner/name` URL (deliberately without
`&run=1`) prefills the repo input without ever calling GitHub, browser
back/forward survives without corrupting the view, and no non-noise
console errors occur across the whole run. Verified passing against both
`npm run dev` and a production build (`npm run build && npm start`), per
Commit 4A's own check.

Uses a local-folder fixture (`tests/fixtures/golden-world`, chosen over
`web-app-world` because the latter has basename collisions like multiple
`index.js`/`index.ts` files across directories — see the
`webkitRelativePath` note below) rather than a real GitHub repository, to
keep the suite deterministic and independent of network access or a token.

**Correction to something I assumed wrong in Commit 3's verification
script:** `Worker`+`Blob`+`fetch` mocking there didn't need file inputs, so
this wasn't tested until now — Playwright's `setInputFiles` on a
`[webkitdirectory]` input, when given a **directory path** (not an array of
individual file paths), resolves the real directory tree and populates
each file's `webkitRelativePath` correctly. Passing an array of loose file
paths instead (what I tried first) throws
`Error: [webkitdirectory] input requires passing a path to a directory` —
Playwright enforces the directory-path form specifically for
`webkitdirectory` inputs; it doesn't silently degrade to flat `.name`-only
files the way raw CDP file injection would.

### Commit 4B — repository graph renderer extracted to src/render/repositoryGraph.js

The 2D D3 force-graph build/update lifecycle — previously a ~150-line
`useEffect` inline in `App()`, dependency array
`[data,colorMap,colorMode,theme,folderFilter,graphConfig]` — is now
`renderRepositoryGraph()` in `src/render/repositoryGraph.js`, a real ES
module bridged onto `window` the same way `src/analyzer.js` is (see the
Commit 3 section above; same `<script type="module">` bridge, extended to
also import this module).

**Mechanical extraction, not a rewrite:** the function body is the exact
original D3 code (`sed`-sliced out of `index.html`, not retyped), with
only four narrow substitutions:
- `svgRef.current` → the `svgEl` parameter
- `setTooltip(...)` → the `onHover(...)` parameter
- `setSelected(null);setBlastRadius(null);` (on empty-canvas click) →
  `onBackgroundClick()` parameter
- everything else — `data`, `colorMap`, `colorMode`, `theme`,
  `folderFilter`, `graphConfig`, `COLORS`, `LAYER_COLORS` — became
  explicit parameters instead of closed-over `App()` variables/constants
  (`COLORS`/`LAYER_COLORS` specifically needed to become parameters rather
  than ambient globals like `d3`/`TreeSitter`/`Babel`/`acorn`, because
  they're declared with `const` in the classic script — `const`/`let`
  don't attach to `window` the way top-level `var`/`function` do, so an
  ambient-global reference from a separate ES module wouldn't have found
  them)

**Why the refs stayed unchanged.** `zoomRef`, `simRef`, `linksRef`,
`nodesRef`, and `selectFileRef` are passed into `renderRepositoryGraph()`
as the *same* React ref objects `App()` already holds, populated by the
renderer exactly as the inline effect did (`zoomRef.current=zoom`, etc.).
This mattered because grepping every other use of these four refs found
them read directly in several unrelated places — zoom in/out/reset
buttons, blast-radius highlight reset, PDF export, the "Back to Issues"
button — none of which needed to change, since they're still reading the
same ref objects being populated the same way. Verified specifically
(beyond the standing `tests/ui-smoke.mjs` suite) with an ad hoc Playwright
probe exercising zoom in/out/reset, hover tooltip, and "Back to Issues":
zero console errors, all three still worked. `selectFileRef` needed no
new callback at all — node clicks already went through
`selectFileRef.current(d.id)`, an existing ref-indirection pattern, not a
direct `setSelected` call.

**Checks:** `tests/ui-smoke.mjs` passes against both `npm run dev` and a
production build (6/6 both times) — same suite Commit 4A added, now
serving as this commit's regression check exactly as intended. Full Node
suite unaffected (62/62 — this commit touches only browser-side rendering
code, nothing under `card/` or `tests/*.test.mjs`).

### Commit 4C — bounded selection/panel state extracted to src/state/selection.js

`selected`, `blastRadius`, `rightTab`, and `drillDown` — the state the
repository view's selection and detail panel need — moved from four
separate `useState` calls in `App()` into `useRepositorySelection()`
(`src/state/selection.js`), bridged onto `window` the same way as Commits
3 and 4B.

**Every variable name stayed identical** (`selected`, `setSelected`,
`blastRadius`, `setBlastRadius`, `rightTab`, `setRightTab`, `drillDown`,
`setDrillDown`) — the hook call replaces the old `useState` declarations
one-for-one at their original destructuring site, so **no call site
elsewhere in `App()` needed to change**. The ~8 places that inline
`setSelected(null);setBlastRadius(null);` and the panel-tab buttons that
inline `setRightTab(x);setDrillDown(null);` were deliberately left as-is
rather than migrated to the hook's new `clearSelection()`/`selectTab()`
composite actions — those exist for future use (satisfying "introduce a
small hook" per the checklist) without forcing a wider migration than this
commit needs.

**What was deliberately left alone**, per Commit 4C's own "do not migrate"
list: `showGraphConfig` (graph-config panel visibility — a different kind
of "panel" than the checklist meant here), `rightPanelWidth` (resize
state), `folderFilter`, `data`/`loading`/`error` (fetch state), `theme`,
and all architecture/security-specific state. `expandedPaths` and
`expandedCards` sit textually between the old `selected` and
`rightTab`/`drillDown`/`blastRadius` declarations in `App()` but are
unrelated (tree-expansion state) — left untouched in place, not swept
into the extraction just because they were nearby.

**Checks:** `tests/ui-smoke.mjs` 6/6 against a production build. Beyond
that fixed suite, ran an ad hoc Playwright probe cycling all four panel
tabs (details → patterns → security → suggestions → details) — zero
console errors. Full Node suite unaffected (62/62).

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
