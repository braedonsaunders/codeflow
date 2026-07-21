# GraphIR contract (MOO-68)

This document is the developer-facing reference for the architectural
language every later Code Reality Layer integration (MOO-69's repository
adapter, MOO-70's pyan3 file/script layer, MOO-71's CodeVisualizer function
layer) speaks. MOO-68 defines the contracts; it does not implement a real
pyan3 or CodeVisualizer adapter — `examples/minimal-graphir-adapter.mjs` and
`tests/fixtures/graph-ir/*.json` are illustrative fixtures, not production
adapters.

Governing decision, restated: **one shared architecture does not imply
visual sameness.** Repository, file, and function graphs all validate
against the same `GraphIR` envelope and share one source/revision identity
system, but each layer keeps its own `kind` vocabulary, rendering hints, and
visual grammar.

All modules live under `src/graph-ir/` and are re-exported from
`src/graph-ir/index.js`. Each has no dependency on `src/analyzer.js`,
`server/*`, or any UI code — a real adapter for a new language or renderer
only ever needs to import from `src/graph-ir/`.

## The repository → file → function identity flow

1. **A request arrives** naming a repository plus a repository, branch,
   commit, or PR reference (`server/lib/validate-repo-request.js` already
   validates the raw shape; `src/graph-ir/githubContext.js`'s
   `normalizeContext()` turns any of the four into one canonical
   `AnalysisContext` — always pinned to a resolved commit SHA, never a
   branch name).
2. **The repository adapter** (MOO-69) produces a `layer: 'repository'`
   `GraphIR` whose nodes are directories/files. Each node's `coordinate`
   (see `src/graph-ir/sourceCoordinate.js`) names that file's `path` at
   `context.resolvedSha`, with `symbolPath: []` (module/file-level, no
   symbol within it yet).
3. **Double-clicking a file node** emits a `drillDown` navigation event
   (`src/graph-ir/navigation.js`'s `createDrillDownEvent`) carrying that
   node's coordinate and `targetLayer: 'file'`. Before the file adapter
   (MOO-70) runs, `githubContext.js`'s `assertContextPropagation()` checks
   the drill-down request's context against the parent repository graph's
   context — same owner/repo, same `resolvedSha` — rejecting any silent
   revision switch.
4. **The file adapter** (pyan3 + tree-sitter, MOO-70) produces a
   `layer: 'file'` `GraphIR` whose nodes are functions/classes within that
   file, each carrying a fully-scoped coordinate (`symbolPath: ['Class',
   'method']`, a `SourceRange`, `ambiguous: false` once tree-sitter/pyan3
   agree on the resolution — `ambiguous: true` when they don't, e.g. an
   unresolved import target).
5. **Double-clicking a function node** (only when
   `isDrillDownEligible(coordinate, 'function')` — i.e. not ambiguous and
   resolved to a `function`/`method` symbol kind) emits another
   `drillDown` event, context-checked the same way, into the function
   adapter.
6. **The function adapter** (CodeVisualizer, MOO-71) produces a
   `layer: 'function'` `GraphIR` — a control-flow graph for exactly that
   coordinate. `function` has no further drill-down target
   (`createDrillDownEvent` throws if asked).

At every step, `src/graph-ir/navigation.js`'s `NavigationHistory` records a
`BreadcrumbEntry` (layer, coordinate, selected node, and the parent graph's
*cache key* — see below — rather than the graph itself) so back/forward can
restore a prior graph from cache instead of re-running analysis, and so
routes stay deep-linkable (a coordinate token from
`encodeCoordinateToken`/`decodeCoordinateToken` is itself URL-safe).

## Modules

| Module | Owns |
|---|---|
| `sourceCoordinate.js` | `SourceCoordinate` — repository identity + resolved revision + path + symbol scope chain + kind + range + ambiguity flag. Canonical (key-order-stable) JSON serialization, plus an opaque base64url route/cache-key token. Structured on purpose — no delimiter-based string splitting. |
| `githubContext.js` | `AnalysisContext` — normalizes repository/branch/commit/PR requests into one shape, always pinned to a resolved SHA. `assertContextPropagation` enforces that a drill-down request cannot silently switch revisions relative to its parent graph. |
| `graphIR.js` | `GraphIR` itself: schema version, layer, context, nodes/edges/groups, analyzer provenance, confidence, warnings, rendering hints. `validateGraphIR` rejects cross-layer node/edge references and dangling edges with a specific message, but ignores unknown extra fields anywhere in the tree so future schema growth stays backward-compatible. |
| `adapterResult.js` | `AdapterResult` (graph, warnings, diagnostics, provenance, timing, cache info, partial flag) and the fixed `ErrorCategory` set (`github_access`, `unsupported_input`, `parser_failure`, `subprocess_failure`, `malformed_analyzer_output`, `timeout`, `renderer_failure`, `internal_error`). `sanitizeDiagnostic` strips stack traces and redacts secret-shaped keys at any depth, applied unconditionally inside `buildAdapterResult`. |
| `navigation.js` | Interaction contract: single click → `createSelectionEvent` (select/focus only); double click → `createDrillDownEvent` (drill-down intent), gated by `isDrillDownEligible` so an unresolved/ambiguous coordinate can never dispatch an incorrect drill-down. `createOpenSourceEvent` for "view raw source." `NavigationHistory` is the back/forward breadcrumb stack. |
| `cacheKey.js` | `buildCacheKey` — a stable sha256-based key from normalized context + analyzer name/version + GraphIR schema version + requested coordinate + depth/options, so equivalent normalized requests collapse to one key while any real difference never collides. `isCacheStale` and `buildProvenanceSummary` (visible provenance plus resolved/unresolved adapter-match counts). |

## Extension rules

- **A new language** (beyond the Python-first v1 baseline) adds a new
  analyzer that produces the same `GraphIR` shape for the `file`/`function`
  layers — it does not need a new schema version unless it needs a
  genuinely new top-level field, in which case bump
  `GRAPH_IR_SCHEMA_VERSION` and update `validateGraphIR` additively (old
  fixtures/consumers should keep validating against the new version too,
  since validation ignores unknown fields rather than requiring them).
- **A new analyzer** for an existing layer only needs to produce a
  schema-valid `GraphIR` and wrap it in an `AdapterResult` — it does not
  need its own cache-key scheme (`buildCacheKey` already parameterizes on
  `analyzerName`/`analyzerVersion`) or its own error categories (reuse the
  fixed `ErrorCategory` set; add a new category only if none of the eight
  genuinely fits, which should be rare).
- **A new renderer** only needs to consume `GraphIR` nodes/edges/hints and
  emit the navigation events this module defines
  (`createSelectionEvent`/`createDrillDownEvent`/`createOpenSourceEvent`) —
  it does not invent its own click/double-click semantics or its own
  coordinate format.
- **Future LLM annotation** (explicitly out of scope for MOO-66/MOO-68,
  deferred to a follow-on issue proposed during the Garrison Step, MOO-44)
  would attach as `metadata` on existing nodes/edges — a layer-specific,
  arbitrary, safely-ignorable field the schema already supports — rather
  than requiring a new top-level `GraphIR` field or a schema version bump.

## Fixtures and the example adapter

`tests/fixtures/graph-ir/repository.json`, `file-pyan.json`, and
`function-codevisualizer.json` are representative, hand-curated `GraphIR`
graphs for the three layers (regenerate with
`node scripts/gen-graph-ir-fixtures.mjs` after an intentional schema
change, then review the diff before committing — same convention
`docs/baseline.md` documents for
`tests/fixtures/baseline-snapshots/*.json`). `tests/graph-ir-fixtures.test.mjs`
validates all three against `validateGraphIR` in CI.

`examples/minimal-graphir-adapter.mjs` is a runnable, self-contained
demonstration that a `GraphIR`-producing adapter needs nothing from this
application beyond `src/graph-ir/index.js` — it fabricates a tiny synthetic
"analyzer output" in place of a real external tool, builds a `GraphIR` and
`AdapterResult` from it, and consumes the result (selection event,
drill-down event, provenance summary) using only contract functions. Run it
directly with `node examples/minimal-graphir-adapter.mjs`.
