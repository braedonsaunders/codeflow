# CodeFlow baseline (MOO-67 Commit 1)

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
| Run the app | `open index.html` — no build step, no `npm install`; loads pinned CDN dependencies |
| Run the full test suite | `node --test tests/*.test.mjs` (58 tests as of this baseline; `node --test tests/` alone fails — Node's directory-mode test discovery does not pick up this repo's flat `tests/*.test.mjs` layout) |
| Run the analyzer against an arbitrary repo | `node tests/codeflow-repo-smoke.mjs [--json] [--limit=<files>] <repo-dir>...` |
| Run the GitHub Action analyzer locally | `cd card && node index.js` — writes `.github/codeflow-card.svg` and `.github/codeflow-card.json` **relative to `card/`** when `GITHUB_WORKSPACE` is unset (it falls back to `process.cwd()`); do not run this from the repo root without setting `GITHUB_WORKSPACE`, or it will analyze `card/` itself and leave stray output there |
| `card/` package script | `npm run dry-run` from `card/` (alias for `node index.js`) |

Node version used to establish this baseline: `v24.16.0`.

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
