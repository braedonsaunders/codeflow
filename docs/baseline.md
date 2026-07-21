# CodeFlow baseline (MOO-67, Commits 1-7 — MOO-67 complete)

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
| Serve the production build (added Commit 2, expanded Commits 5-6) | `npm run start` (or `node server/index.js`) — serves `dist/` plus `/healthz`, `/readyz` (public, no auth), `POST /api/analyze`, `POST /api/analyze-repo` (both require `Authorization: Bearer <AUTH_TOKEN>`); **required** env vars `AUTH_TOKEN`, `GITHUB_TOKEN`, and at least one of `ALLOWED_REPOS`/`ALLOWED_OWNERS` (comma-separated) — the server now fails fast at startup if any are missing, same fail-fast principle as the pre-existing `dist/index.html`/`PORT`/workspace-writability checks; optional: `PORT` (default `3000`), `WORKSPACE_ROOT` (default `<tmpdir>/codeflow-workspaces`), `NODE_ENV`, `RATE_LIMIT_PER_MINUTE` (default `30`), `MAX_REQUEST_BODY_BYTES` (default `16384`), `MAX_REPO_FILES` (default `500`) |
| Run the server integration smoke suite (added Commit 5, expanded Commit 6) | `node tests/server-smoke.mjs` — needs `dist/` built first, and a real GitHub credential via `gh auth login` (extracts it with `gh auth token` to verify the GitHub-backed path against real repos, not a mock); spawns the real server on an isolated port/workspace root, not part of `node --test tests/*.test.mjs` for the same reason `codeflow-repo-smoke.mjs`/`ui-smoke.mjs` aren't |
| Run the browser UI smoke suite against a server (Commit 4A, now requires Commit 6 env vars too) | `AUTH_TOKEN=x GITHUB_TOKEN=x ALLOWED_OWNERS=x node server/index.js` then `node tests/ui-smoke.mjs [url]` — the values don't need to be real for this suite specifically, since it only drives the local-folder (client-side-only) flow, never the server's `/api/*` endpoints; the server just needs to *start*, which now requires these to be set to anything non-empty |
| Run the full test suite | `node --test tests/*.test.mjs` (126 tests as of the PR #1 review fixups; `node --test tests/` alone fails — Node's directory-mode test discovery does not pick up this repo's flat `tests/*.test.mjs` layout) |
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

### Commit 4D — minimal route persistence extracted to src/state/route.js

`buildAppUrl` (a top-level function) and the scattered query-param
read/write logic it fed — a `useEffect` reading `?repo=`/`?run=1` on
mount, and two `window.history.replaceState` call sites (one after a
GitHub repo successfully loads, one clearing the URL in `resetAnalysis`)
— consolidated into `src/state/route.js`: `buildRepoUrl`, `readRouteRepo`,
`writeRepoRoute`, `clearRoute`. Bridged onto `window` the same way as
Commits 3, 4B, and 4C.

**Scope, per the checklist's own boundary:** repository identity only
(which repo the URL names, and whether to auto-run) — not active
view/panel/selection/drill-down restoration, and not canonical source
coordinates or breadcrumb payloads, both explicitly reserved for MOO-68.

**Unlike the three prior extractions, this one is genuinely unit-testable
without a DOM** — `buildRepoUrl`/`readRouteRepo` accept an optional
`baseHref`/`search` parameter (falling back to the real
`window.location` when omitted) specifically so `tests/route-state.test.mjs`
could exercise them as plain Node tests: URL construction, the `run=1`
gating logic, and the three validation guards the original inline code
had (200-char cap, reject `{`, restrict to `[a-zA-Z0-9_./-]`) — 8 new
tests, including one for each rejection case, none of which had explicit
test coverage before this extraction even though the validation logic
itself is unchanged.

**Checks:** `tests/route-state.test.mjs` 8/8. `tests/ui-smoke.mjs` 6/6
against a production build — its "route/hash restoration" check exercises
`readRouteRepo` directly, so this wasn't just incidentally unbroken, it
was specifically re-verified. The write path (`writeRepoRoute`/
`clearRoute`) isn't reachable through the local-folder flow the smoke
suite uses (only a real GitHub repo load triggers it, which the suite
deliberately avoids to skip a network dependency), so verified it
separately with an ad hoc Playwright probe calling
`window.writeRepoRoute`/`window.clearRoute` directly and asserting
`window.location.search` changed correctly both ways — zero console
errors. Full suite unaffected (70/70 total, 62 pre-existing + 8 new).

### Commit 4E — generic node-select/node-activate interaction seam

Unlike 4B/4C/4D, this one adds something genuinely new rather than just
parameterizing/relocating existing code: a `dblclick` handler on graph
nodes in `src/render/repositoryGraph.js`, alongside the existing `click`
handler, using the same node identity (`d.id`) the click handler already
uses. Wired to a new `activateFileRef` (React ref, same pattern as
`selectFileRef`), which `App()` initializes to a no-op
(`useRef(function(){})`) and does not wire to anything else — per Commit
4's governing decision not to encode navigation policy ahead of MOO-68,
and the checklist's explicit allowance that `node-activate` "may remain
unused or resolve to a no-op in MOO-67."

This gives MOO-68 an obvious, already-wired seam (swap `activateFileRef`'s
no-op for a real drill-down dispatch) instead of needing to touch the
renderer again to add double-click handling from scratch.

**Checks:** `tests/ui-smoke.mjs` 6/6 against a production build (single-
click selection, the behavior 4E must not disturb, still passes). Beyond
that, an ad hoc Playwright probe specifically double-clicked a node (no
crash — the no-op default absorbs it cleanly) and then single-clicked the
same node again (still selects correctly, proving the new handler didn't
corrupt event wiring or leave stray state behind). Full Node suite
unaffected (70/70 — this only touches browser rendering).

## Commit 5 — Railway service and workspace skeleton

`server/index.js` (the Commit 2 static-file placeholder) is now a real
server shell, split into namespaced modules:

- `server/lib/config.js` — reads `PORT`/`WORKSPACE_ROOT`/`NODE_ENV`,
  **fails fast at startup** (not lazily on first request) if `dist/index.html`
  is missing or `PORT` is invalid, with an actionable message
  (`ConfigError`).
- `server/lib/workspace.js` — `WorkspaceManager`: one controlled root
  (`ensureRoot()` probes writability at startup, same fail-fast principle),
  one normalized subdirectory per request (`createRequestWorkspace(requestId)`,
  requestId restricted to `[a-zA-Z0-9_-]`), a `resolve()` that rejects any
  path escaping that subdirectory, and a `cleanup()`. This exists so MOO-70
  (pyan3) and MOO-71 (CodeVisualizer) have one shared convention for
  staging fetched source and intermediate artifacts instead of each
  inventing its own temp-directory handling.
- `server/lib/logger.js` — structured JSON-lines logging
  (`{time,level,message,...meta}`), a `generateRequestId()`
  (`crypto.randomUUID()`), and a `createRequestLogger(requestId)` so every
  log line from one request carries the same ID. Sanitizes any meta key
  matching `/token|authorization|secret|password|api[_-]?key|cookie/i` to
  `[redacted]` — no secrets exist yet (that's Commit 6), but the sanitizer
  is in place before there's anything to leak, not retrofitted after.
- `server/lib/health.js` — `/healthz` (liveness: process up, Node version,
  uptime) and `/readyz` (readiness: `dist/index.html` present + workspace
  root writable, 503 if either fails) are deliberately distinct — a
  liveness failure means "restart the container," a readiness failure
  means "stop routing traffic here without necessarily restarting,"
  relevant once this runs on Railway.
- `server/lib/static.js` — the Commit 2 static-file logic, unchanged, just
  relocated into its own module.
- `server/routes/analyze.js` (+ `server/lib/analyzer-bridge.js`) —
  `POST /api/analyze`, deliberately bounded to paths already on the
  server's own filesystem (validated to resolve within `repoRoot`, e.g.
  `tests/fixtures/golden-world`) rather than fetching from GitHub — no
  credential and no auth gate exist yet (Commit 6), so this endpoint
  couldn't safely reach further even if it tried. Copies the requested
  path into a request-scoped workspace, runs the analyzer, cleans up.
  `analyzer-bridge.js` reuses `card/lib/collect.js`'s `buildAnalyzed()`
  for file collection rather than writing a fourth copy of that logic
  (codeflow-repo-smoke.mjs, card/lib/collect.js, and
  codeflow-golden.test.mjs's fixture harness each already have one) —
  genuine cross-package reuse (`card/`'s CommonJS module imported directly
  from the ESM server code), not just avoided duplication in spirit.

**Checks:**
- `tests/server-config.test.mjs` (4 tests) and
  `tests/server-workspace.test.mjs` (5 tests) — plain Node unit tests, no
  process spawning, covering `loadConfig`'s fail-fast validation and
  `WorkspaceManager`'s containment/cleanup guarantees directly.
- `tests/server-smoke.mjs` (new, following the existing `-smoke.mjs`
  convention — not part of `node --test tests/*.test.mjs`, needs `dist/`
  built first) spawns the **real** server process on an isolated port and
  workspace root and exercises exactly what Commit 5's checklist checks:
  static serving, `/healthz`, `/readyz`, `/api/analyze` against
  `golden-world` (confirmed to match the exact `files:6/functions:7/connections:6`
  baseline from Commit 1 — the server-side pipeline produces identical
  results to the existing analyzer, not just "doesn't crash"), the
  path-traversal and missing-path rejections, and — critically — that the
  workspace root is completely empty after all requests complete (cleanup
  actually ran, not just callable).
- Manually confirmed (via `curl` and a captured log file) that request IDs
  correlate across every log line for a single request (workspace
  created → analysis complete → request summary all share one ID), and
  that `tests/ui-smoke.mjs` still passes 6/6 against the refactored server
  (the static-file logic moved modules but didn't change behavior).
- Full suite: 79/79 (70 pre-existing + 9 new unit tests).

## Fixup — GitHub.scan's missing dependencies (found while starting Commit 6)

`GitHub.scanTree`/`scanRecursive` (both inside `src/analyzer.js`) call
`shouldExcludeFile`/`shouldIgnoreDirectory`, which — it turns out — were
never moved out of `index.html` during the Commit 3 extraction. They only
"worked" in the browser by accident, via the exact same window-fallthrough
mechanism that makes `TreeSitter`/`Babel`/`acorn`/`d3` resolve as ambient
globals from a separate ES module (top-level `function` declarations in a
classic script attach to `window`). Nothing defines them on `globalThis`
in Node, so the first time anything actually called `GitHub.scan()`
server-side (testing it directly, ahead of building Commit 6's real
GitHub-backed endpoint around it), it threw
`shouldExcludeFile is not defined` immediately.

Commit 3's own verification never caught this because nothing exercised
`GitHub.scan` specifically — the worker-path verification
(`scripts/verify-worker-analysis.mjs`) only drives `buildAnalysisData`
directly, and no Node test called any `GitHub` method. This is the same
category of gap `getSecurityScanContent`/`isSanitizedPreviewRenderer` were
in Commit 3 (external dependencies of the analyzer that lived just
outside the marked block) — just a second, later-discovered instance of it
involving a code path (`GitHub.scan`) nothing had actually invoked yet.

Fixed by moving `IGNORE` (the ignored-directory-names `Set`),
`normalizeExcludePath`, `matchesExcludePattern`, `shouldIgnoreDirectory`,
and `shouldExcludeFile` into `src/analyzer.js` for real (same "fold into
the real module" treatment), exported and re-bridged onto `window` so
`index.html`'s own local-folder-reading code (which also calls
`shouldExcludeFile`/`shouldIgnoreDirectory`) keeps working unchanged.

**Checks:** re-ran `GitHub.scan('octocat','Hello-World',...)` +
`GitHub.getFile(...)` directly from Node against the real public repo —
correctly returned the 1-file tree and fetched its content. Added
`tests/analyzer-module.test.mjs` (4 tests, no network) so this specific
gap can't silently reappear — confirms the five functions are real
exports and exercises their logic with synthetic inputs. Full suite
(83/83 with the new tests), a clean build, and `tests/ui-smoke.mjs` (6/6)
all still pass — this was a pure addition/relocation, no existing
behavior changed.

## Commit 6 — authentication and repository-request controls

Three independent gates now sit in front of every `/api/*` route, checked
in this order, each failing before the next thing it protects is touched:

1. **`server/lib/auth.js`** — a shared-secret check
   (`Authorization: Bearer <AUTH_TOKEN>`), timing-safe compared
   (`crypto.timingSafeEqual`, padded to equal length first so the
   length-mismatch branch doesn't return early with a different timing
   profile). This is a private-use gate, not a multi-user login system —
   deliberately, per the checklist's own "practical private-use
   authentication gate" framing. `/healthz`/`/readyz`/static serving stay
   public, since Railway's own health monitoring needs to reach them
   without a token.
2. **`server/lib/rate-limit.js`** — an in-memory, per-client-IP
   (`X-Forwarded-For`-aware) fixed-window counter (`RATE_LIMIT_PER_MINUTE`,
   default 30). Adequate for a single-instance private tool; doesn't
   survive a restart or scale across instances, which is fine at this
   scale.
3. **`server/lib/validate-repo-request.js`** + **`server/lib/allowlist.js`**
   — format validation (owner/repo/ref/PR-number patterns, deliberately
   narrower than GitHub actually allows in edge cases) happens before the
   allowlist check, which happens before any GitHub call.

**The GitHub-backed pipeline** (`server/lib/github-analyzer-bridge.js`,
wired up by `server/routes/analyze-repo.js`'s new `POST /api/analyze-repo`)
reuses `GitHub`/`Parser`/`shouldExcludeFile`/`buildAnalysisData` from
`src/analyzer.js` rather than writing a second GitHub client. It does
**not** reuse `GitHub.scanTree`/`getFile` as-is, though — both are
hardcoded to the repository's default branch with no ref parameter, which
is exactly the gap "validate repository, branch, commit, and PR inputs"
needs closed. Instead: resolve the request to a concrete `{owner, repo,
ref}` (branch name, commit SHA, or a PR's head SHA), fetch that ref's tree
via the Git Trees API, then fetch each file's content by **blob SHA**
(`git/blobs/{sha}`) rather than the Contents API's own separate ref
resolution — sidesteps needing to export more analyzer-internal URL
helpers just for this, and guarantees the content matches the exact tree
entry, not a second, potentially-racy lookup.

Kept `Commit 5`'s local-path `/api/analyze` as a separate endpoint rather
than merging the two — they have genuinely different trust boundaries
(server's own filesystem vs. an external API call with a credential) and
different validation needs (file path vs. owner/repo/ref/PR).

### Two real bugs found and fixed while verifying this against real GitHub data

Both were caught because verification used **real repositories and PRs**,
not fixtures with predictable shapes — worth calling out since it's the
reason this took longer than the code alone would suggest.

1. **A PR's head commit usually lives in a fork, not the base repo.**
   `octocat/Hello-World` PR #10590's head SHA only exists in
   `angelg84/Hello-World`'s object database — fetching the *base* repo's
   tree for that SHA 404s (confirmed directly against GitHub's API, not
   assumed). Fixed by having `resolveRef()` return the PR's actual
   `head.repo` owner/name alongside its SHA, and using *that* — not the
   originally-requested owner/repo — for the subsequent tree/blob fetches.
   The base repo being allowlisted remains the operative access check: the
   caller asked for a specific PR *of* that allowlisted repo, and GitHub's
   own PR data is what resolves which fork/SHA that means.
   (Separately: while testing this, PR #10590's fork/commit turned out to
   already be deleted/garbage-collected — a genuinely old PR on a 15-year
   demo repo — which is *why* bug #2 below was worth finding: that failure
   mode needs to surface as a clear error, not a crash.)
2. **`GitHub.request()`'s errorMap-driven errors are plain `Error`s, not
   `GithubFetchError`.** `GitHub.request` (shared with the browser) throws
   a plain `Error` using the caller-supplied `errorMap`'s messages on a
   non-OK response. Since the route handler only maps `GithubFetchError`
   to a clean `502`, this genuinely-expected condition (bug #1's deleted
   fork) was surfacing as a generic `"Analysis failed"` `500` instead of
   GitHub's own `"Ref not found..."` message. Fixed by having
   `apiRequest()` catch and re-wrap every `GitHub.request()` failure as a
   `GithubFetchError`.

Both are now covered by dedicated `tests/server-smoke.mjs` steps against
real GitHub data (PR #10587, still resolvable at the time of writing) —
not just unit tests with mocked responses, since the whole point of both
bugs was a mismatch between assumed and actual GitHub API behavior that a
mock would have hidden.

**Checks:**
- `tests/server-auth.test.mjs` (16 unit tests, no network) covering
  `auth.js`, `allowlist.js`, `rate-limit.js`, and
  `validate-repo-request.js` directly.
- `tests/server-config.test.mjs` expanded (10 tests) for the new required
  fields and their fail-fast validation.
- `tests/server-smoke.mjs` expanded to 17 steps: anonymous/wrong-token
  rejection, the local-path endpoint now requiring auth too, the
  GitHub-backed endpoint against a real allowlisted repo (`octocat/Hello-World`,
  default branch **and** an explicit `ref` **and** a real PR resolved
  through its fork), allowlist rejection *before* any GitHub call,
  malformed-input rejection, the clean-502-not-generic-500 regression
  check, and rate-limit exceeded (429). Requires a real GitHub credential
  via `gh auth token` — verifies the actual claim in Commit 6's own
  checklist ("allowed requests work using server-held GitHub
  credentials"), not just "didn't throw with a fake token."
- Full suite: 105/105. Clean build. `tests/ui-smoke.mjs` still 6/6 (the
  browser's local-folder flow never touches the new `/api/*` endpoints, so
  it's unaffected by the new auth requirement — though the server process
  itself now needs `AUTH_TOKEN`/`GITHUB_TOKEN`/an allowlist entry set to
  *something* just to start, even for this browser-only test).

## Commit 7 — deployed the authenticated Railway preview shell

**Live at:** `https://codeviz-production.up.railway.app` (Railway-generated
domain — not the final `codeviz.moopertonic.net`, see the DNS section
below). Project `codeviz` (`b9f4568f-b0bd-4ebe-b54d-7978bf3c544a`), service
`codeviz` (`f6722304-46c5-41aa-a29f-20f5035dcca6`), environment
`production`, region `sfo`, workspace `owentanzer's Projects`.

### Deployment configuration

Railway auto-detected this as a Node app via its Railpack builder and
succeeded on the very first deploy with **no config file at all** — it
correctly ran `npm run build` during the build phase (package.json has a
`build` script) and `npm start` to launch, confirmed by `/readyz` reporting
`buildOutput.ok: true` on that first deployment. Added `railway.json`
anyway, since "add Railway deployment configuration" is a real checklist
item and relying purely on implicit auto-detection is fragile to depend on
long-term:

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": { "builder": "RAILPACK" },
  "deploy": {
    "startCommand": "npm start",
    "healthcheckPath": "/readyz",
    "healthcheckTimeout": 30,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

`healthcheckPath: /readyz` (rather than `/healthz`) is the one substantive
choice here: it makes Railway itself gate traffic routing and rollout
success on the *readiness* check (build output present, workspace
writable), not just "the process is up" — confirmed applied by re-reading
deployment metadata after redeploying with this file present
(`meta.serviceManifest.deploy.healthcheckPath` changed from `null` to
`/readyz`, `startCommand` from `null` to `npm start`).

### Environment variables (set via `railway variable set`, not committed anywhere)

| Variable | Value | Notes |
|---|---|---|
| `AUTH_TOKEN` | a generated 32-byte random secret (base64url) | **Not recorded in this repo or in Linear** — given directly to the operator in conversation when set. Rotate via `railway variable set AUTH_TOKEN=<new value>` (triggers a redeploy by default; add `--skip-deploys` to stage it and roll out separately) whenever it may have been exposed. |
| `GITHUB_TOKEN` | the operator's existing `gh auth token` PAT | Same credential already used locally throughout Commits 5-6's verification — reused per the decision recorded in the MOO-67 environment-setup comment, not a new credential. |
| `ALLOWED_OWNERS` | `*` (wildcard — any owner) | Started as `OwenTanzer` only (a judgment call made at initial deployment); widened to the wildcard on request, to analyze other users' repos too. `server/lib/allowlist.js` treats `*` as an explicit "any owner" opt-in, not the default — the auth token remains the actual gate on who can reach the endpoint at all; the allowlist only restricts *which* repos a valid caller can point it at, and this setting says "don't restrict that." Change anytime with `railway variable set ALLOWED_OWNERS=...`, or add `ALLOWED_REPOS` for narrower per-repo scoping instead of the wildcard. |
| `NODE_ENV` | `production` | |
| `PORT` | *(not set)* | Railway injects its own `PORT`; `server/lib/config.js` already reads `process.env.PORT` with a fallback, so this needed no change. |

### Verified against the live deployment (not just locally)

- `GET /healthz` → `200 {"status":"ok",...,"nodeVersion":"v22.23.1","env":"production"}`.
  Node v22.23.1 on Railway satisfies the `^20.19.0 || >=22.12.0` engine
  constraint from the Commit 3 fixup — confirmed, not assumed.
- `GET /readyz` → `200 {"status":"ready","checks":{"buildOutput":{"ok":true},"workspaceRoot":{"ok":true}}}`.
- `GET /` → `200`, serves the built app.
- `POST /api/analyze` with no `Authorization` header → `401`.
- `POST /api/analyze` with a wrong token → `401`.
- `POST /api/analyze` with the correct token, `golden-world` → `200`,
  `files:6 functions:7` — matches the same baseline every other
  environment (local dev, `tests/server-smoke.mjs`) produces.
- `POST /api/analyze-repo` for `torvalds/linux` (not allowlisted) → `403`.
- `POST /api/analyze-repo` for `OwenTanzer/CodeVisualizer` (allowlisted,
  real repo, real GitHub fetch through the deployed instance) → `200`.

### Rollback

No CLI command targets a **specific past** deployment — `railway service
redeploy` only redeploys *the latest* one (useful after a crash, not for
rolling back to an older version). Confirmed by checking `railway service
redeploy --help` and `railway deployment --help` directly rather than
assuming. Two real rollback paths exist:

1. **Dashboard** (the actual "pick an older version" mechanism): Railway
   project → `codeviz` service → Deployments tab → find the last-known-good
   deployment → "⋯" menu → Redeploy.
2. **CLI, from source**: `git checkout <last-known-good-commit>` (or a
   branch/tag), then `railway up --detach -y --json` from that checkout —
   Railway deploys are just an upload of the local directory's content, so
   redeploying from an earlier commit has the same effect. This is the
   same command this commit's own deploys used, just pointed at older code.

Both are described here rather than exercised live, to avoid burning an
extra real deployment cycle just to prove a redeploy works — the mechanism
itself (`railway up` succeeding) was already demonstrated twice during
this commit's own rollout.

### DNS and Moopertonic Hub cutover — recorded for later, not done now

Per MOO-66/MOO-72's plan, the final production domain is
`codeviz.moopertonic.net`, and `moopertonic.net`'s DNS is managed via
Cloudflare (per the `viewer-wrangler-deploy` project memory;
`CLOUDFLARE_API_TOKEN` already exists locally for this). Exact steps for
whoever does the MOO-72 cutover:

1. `railway domain codeviz.moopertonic.net` (or via the dashboard) against
   this service — Railway will return the CNAME target to point at.
2. In Cloudflare's DNS for `moopertonic.net`, add a CNAME record:
   `codeviz` → the host Railway returned in step 1.
3. `railway domain status codeviz.moopertonic.net` to confirm the custom
   domain has verified and the certificate has issued.
4. Add/update the CodeViz link in the Moopertonic Hub navigation once the
   custom domain is live.
5. Only after the custom domain is confirmed healthy, consider whether to
   keep or remove the `codeviz-production.up.railway.app` Railway-generated
   domain as a fallback.

Not doing this now — MOO-66/MOO-67 explicitly scope the DNS/Hub cutover to
MOO-72, after all layers (repository/file/function views) are actually
operational. This is intentionally just the recorded procedure, not a
blocker for MOO-68 to begin.

### Post-deployment update — allowlist widened to any owner

Requested after the initial deploy: analyze other users' repos too, not
just the operator's own. Added a `*` wildcard to
`server/lib/allowlist.js`'s owner check (2 new unit tests in
`tests/server-auth.test.mjs` covering it) rather than piling on individual
owner names — `ALLOWED_OWNERS=*` is an explicit "any owner" opt-in
recognized by the code, not a magic value that happened to work. The auth
token is still the operative gate on who can reach `/api/analyze-repo` at
all; this only changes *which* repos a valid caller can point it at.
Redeployed and verified live: `octocat/Hello-World` (previously blocked)
now analyzes successfully, and `OwenTanzer/CodeVisualizer` (the original
narrower allowlist entry) still works too.

## PR #1 review fixups

Four review comments came back on the pull request for all of MOO-67
(https://github.com/OwenTanzer/codeflow/pull/1). All four addressed:

1. **Repository byte limits, not just file-count limits.** `MAX_REPO_FILES`
   capped file *count* but not byte size — the GitHub-backed path fetched
   every accepted blob into memory and held it resident before analysis.
   That mattered less while repositories were tightly allowlisted; the
   wildcard follow-up above means any authenticated caller can point the
   server at any public repo, and a repo with a few hundred enormous blobs
   could exhaust memory despite staying under `MAX_REPO_FILES`. Added
   `MAX_FILE_BYTES` (default 1MB) and `MAX_REPO_BYTES` (default 25MB).
   GitHub's tree API already reports each blob's size, so oversized files
   are rejected **before any content is fetched/decoded** — exactly the
   reviewer's suggestion. Individually-oversized files are *skipped*
   (excluded from analysis, same treatment as an ignored directory) rather
   than failing the whole request; the aggregate is a hard cap instead,
   since that's the actual memory-exhaustion risk. Refactored the
   selection logic out of `fetchTree()` into a pure, exported
   `selectAnalyzableFiles()` (`server/lib/github-analyzer-bridge.js`)
   specifically so this could be unit-tested against synthetic tree data
   (`tests/server-github-bridge.test.mjs`, 7 tests) instead of only being
   reachable through a real GitHub round-trip.
2. **Local-path symlink containment claim was false.** `resolveWithinRepo()`
   (`server/routes/analyze.js`) did lexical path-traversal checking only,
   but its own comment claimed it rejected symlinks — it didn't call
   `realpath()`, so a symlink sitting lexically inside the repo while
   pointing elsewhere would sail through un-rejected. Fixed by resolving
   both the repo root and the requested target through `realpath()` and
   checking containment on the *resolved* paths (what `cp()` actually
   reads from), rejecting a nonexistent path — including a broken symlink
   — as invalid input rather than a 500. Verified with real filesystem
   junctions (Windows equivalent of a symlink that doesn't require
   elevated privileges), not just a claim: `tests/server-analyze-path.test.mjs`
   creates an actual junction pointing outside a temp repo root and
   confirms it's rejected, and a second junction pointing to another
   location *inside* the root and confirms that one is accepted — proving
   the fix distinguishes the two cases rather than just rejecting
   everything.
3. **Request-body limit was inconsistent between the two endpoints.**
   `/api/analyze-repo` bounded its body via `MAX_REQUEST_BODY_BYTES`;
   `/api/analyze` buffered the whole request unbounded, despite both being
   publicly addressable behind the same bearer-token gate. Extracted one
   shared `readJsonBody()` (`server/lib/http-body.js`, 5 unit tests in
   `tests/server-http-body.test.mjs`) both routes now use, rather than
   maintaining two subtly different parsers.
4. **No CI status checks.** Explicitly flagged as non-blocking by the
   reviewer, but easy enough to close out now rather than defer: added
   `.github/workflows/test.yml` running `npm ci && npm run build && node --test tests/*.test.mjs`
   on push/PR to `main`. Deliberately scoped to the credential-free, no-
   real-network unit/integration suite — `tests/ui-smoke.mjs` (needs a
   Playwright browser) and `tests/server-smoke.mjs` (needs a real GitHub
   token) stay manual-precondition scripts for now, consistent with how
   they're already documented above; wiring those into CI too is a
   reasonable separate follow-up, not bundled into this fixup.

**Checks:** full suite 126/126 (up from 107 — 19 new tests across the four
fixups). Clean build. `tests/server-smoke.mjs` re-verified against real
GitHub data (17/17) to confirm none of these changes broke the existing
happy paths.

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
