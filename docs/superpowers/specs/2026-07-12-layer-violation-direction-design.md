# Layer-violation direction fix — design

Date: 2026-07-12
Status: Approved for planning

## Context

CodeFlow's "Architecture Violations" detector (`Parser.detectLayerViolations`,
embedded in `index.html`) reports the **exact inverse of reality**: it flags healthy
downward dependencies (a service using a foundational util) as violations, while
silently missing the genuine upward violations (a util reaching up into a service)
it exists to catch.

This was surfaced by running CodeFlow against an external project, where all
reported "layer violations" were healthy `service → db` / `service → lib`
dependencies mislabelled as "utils should not import from services", inflated by a
shared foundational module appearing once per caller (~13 identical-looking entries
for ~4 files).

### Root cause — direction inversion

The connection graph is built with a documented convention (`index.html:4981`):

```js
// Connection format: {source: fileDefiningFn, target: fileCallingFn, fn: fnName, count: callCount}
```

So `source` is the file that **defines** the called function (the depended-upon
file), and `target` is the file that **calls** it (the importer/dependent). The edge
points *from the definition to the caller*.

`detectLayerViolations` (`index.html:1385-1411`) reads this backwards. It treats
`source` as the importer:

```js
if(srcLevel!==undefined&&tgtLevel!==undefined&&srcLevel>tgtLevel&&srcLevel-tgtLevel>1){
    violations.push({
        from:srcFile.path, fromLayer:srcFile.layer,
        to:tgtFile.path, toLayer:tgtFile.layer,
        suggestion:srcFile.layer+' should not import from '+tgtFile.layer+'...'
    });
}
```

`layerOrder` assigns lower numbers to higher/topmost layers (`ui/presentation=0`,
`services=2`, `utils/lib=4`, `config=5`). A real violation is a *more-foundational*
file (higher number) importing from a *higher-up* layer (lower number). The importer
is `target`, not `source` — so the correct comparison is on the **target's** level,
and the current code compares the **source's**.

Verified empirically against the real analyzer (via `card/lib/analyzer.js`):

| Scenario | Reality | Detector output |
|---|---|---|
| `services/userService.ts` calls a helper in `lib/helper.ts` (services→utils, downward, healthy) | 0 violations | **1 false positive**: "utils should not import from services" |
| `lib/helper.ts` calls a function in `services/userService.ts` (utils→services, upward, genuine violation) | 1 violation | **0 — silently missed** |

The proposed fix (swap the interpretation so `target` is the importer) was also
verified inline: the healthy scenario drops to 0 violations, and the genuine
violation is correctly reported as "utils should not import from services".

### Secondary bug — `detectLayer` misses root-level folders

`detectLayer` (`index.html:1098-1126`) classifies files by path substring, but every
folder pattern requires a **leading slash** (`l.includes('/service')`, `/util`,
`/lib/`, `/data`, `/config`). A layer folder at the repository root (relative path
with no leading slash) never matches and falls through to the `return 'utils'`
default. Verified:

```
services/userService.ts       -> utils   (missed; should be services)
src/services/userService.ts   -> services (correct; the "src/" supplies the slash)
lib/client-ip.ts              -> utils   (missed; should be utils by luck, but for the wrong reason)
next.config.mjs               -> utils   (config pattern needs "/config", not ".config")
```

This is a real bug but **secondary**: in layouts where two files both fall through
to the `utils` default, they land at the same level, produce a zero level-difference,
and generate *no* violation at all. It does not produce the reported false positives
on its own — the inversion does. Fixing it broadens correct classification (and can
surface genuine violations that were previously suppressed), but it reclassifies
files repo-wide, so it needs its own regression coverage.

### Tertiary observation — coupling metric mislabel

`index.html:4797` computes `coupling[c.target]++` and the resulting issue is labelled
"Files imported by 8+ others". Because `target` is the caller (importer), this counts
each file's fan-**out** (how many external functions it calls), not fan-**in** (how
many files import it). Same source/target confusion as the primary bug, lower
severity (a wrong label, not a crash). In scope as an optional companion fix.

## Goal

Make the Architecture Violations detector report violations in the correct
direction, so healthy downward dependencies are not flagged and genuine upward
dependencies are caught — without adding dependencies or restructuring the
connection graph that other features (graph rendering, coupling, circular detection)
depend on.

## Scope

In scope:
- Fix the direction inversion in `detectLayerViolations` (primary).
- Fix the leading-slash gap in `detectLayer` so root-level layer folders classify
  correctly (secondary).
- Correct the coupling metric's fan-in/fan-out label (tertiary, optional).

Out of scope (explicitly):
- Any change to how `conns` is built (`index.html:4740`) or to the documented
  `{source: definition, target: caller}` convention — the graph, coupling, and
  circular-dependency features all consume it and are not part of this fix. The fix
  is localized to the *readers* that misinterpret the convention.
- Expanding `detectLayer`'s folder vocabulary beyond adding leading-slash tolerance
  (e.g. inventing rules for `db/`, `legacy/`, `*.config.*`) — enumerating folder
  conventions is an open-ended rabbit hole with no correct stopping point, the same
  trap avoided in the security-scanner work.
- Any UI/rendering change beyond the corrected issue label.

## Design

### 1. Direction inversion (primary)

Rewrite the comparison in `detectLayerViolations` to treat `target` as the importer
and `source` as the imported (matching the `index.html:4981` convention):

```js
connections.forEach(function(c){
    var importedFile=fileByPath[c.source]; // source = definition (depended-upon)
    var importerFile=fileByPath[c.target]; // target = caller (importer)
    if(!importedFile||!importerFile)return;
    var importerLevel=layerOrder[(importerFile.layer||'').toLowerCase()];
    var importedLevel=layerOrder[(importedFile.layer||'').toLowerCase()];
    // Violation: a more-foundational file (higher level) imports from a higher-up layer
    if(importerLevel!==undefined&&importedLevel!==undefined&&importerLevel>importedLevel&&importerLevel-importedLevel>1){
        violations.push({
            from:importerFile.path,
            fromLayer:importerFile.layer,
            to:importedFile.path,
            toLayer:importedFile.layer,
            fn:c.fn,
            suggestion:importerFile.layer+' should not import from '+importedFile.layer+'. Consider inverting the dependency or using dependency injection.'
        });
    }
});
```

The `>1` gap threshold, the `layerOrder` map, and the suggestion wording are all
preserved — only the source/target roles swap. `from`/`to` in the emitted violation
now correctly name the importer and the imported file respectively.

### 2. `detectLayer` leading-slash tolerance (secondary)

Normalise the path so a leading segment matches the same patterns a nested one does.
The minimal change is to prepend a `/` to the lowercased path before the substring
checks, so `services/foo.ts` is tested as `/services/foo.ts`:

```js
detectLayer:function(p){
    var l='/'+p.toLowerCase().replace(/^\/+/,'');
    // ...existing pattern checks unchanged...
}
```

This makes root-level `services/`, `ui/`, `lib/`, `utils/`, `data/`, `config/`,
etc. classify identically to their nested counterparts, with no change to files that
already had a leading path segment. It deliberately does **not** add new folder
vocabulary — `next.config.mjs` (dot, not slash) and bare `db/` still fall through to
the default, which is acceptable and out of scope to chase.

### 3. Coupling label correction (tertiary, optional)

Change the issue title/desc at `index.html:4798-4799` from "imported by 8+ others"
to accurately describe fan-out ("import 8+ other files"), OR — the more useful
option — count fan-in by keying on `c.source` instead of `c.target`. The design
chooses the **label correction only** (rename to reflect what is measured), because
changing the key alters which files are flagged and would need its own fixture
coverage; renaming is zero-risk and removes the misleading claim. Exact new wording
is specified in the plan.

## Testing strategy

Follow the existing golden-fixture pattern (`tests/codeflow-golden.test.mjs`):
extract the analyzer from `index.html` via `vm`, feed it constructed
files/connections, assert on the output.

New test file `tests/layer-violation-direction.test.mjs`, driving
`Parser.detectLayerViolations` and `Parser.detectLayer` directly:

- **Direction, healthy dep:** a `services` file depending on a `utils` file (edge
  `{source: utils_file, target: services_file}`) produces **0** violations.
- **Direction, genuine violation:** a `utils` file depending on a `services` file
  (edge `{source: services_file, target: utils_file}`) produces **1** violation, with
  `from` = the utils file and a suggestion naming "utils should not import from
  services".
- **Gap threshold preserved:** an adjacent-layer dependency (level difference of 1)
  produces no violation, matching current behaviour.
- **`detectLayer` root-level folders:** `services/x.ts` → `services`, `lib/x.ts` →
  `utils`, `ui/x.ts` → `ui`, and the nested equivalents (`src/services/x.ts`, etc.)
  are unchanged.
- **Coupling label (if tertiary included):** assert the emitted issue title matches
  the corrected wording.

Non-regression: `tests/codeflow-golden.test.mjs` and the full existing suite
(`node --test`) must stay green, unmodified. The golden fixture exercises the whole
`buildAnalysisData` pipeline including `detectLayer`, so a classification change that
shifted its expected output would surface here.

## Delivery

Single PR to `braedonsaunders/codeflow`, off `main`, one commit per part
(direction, detectLayer, coupling label) for reviewability. PR body documents the
out-of-scope items as known limitations (no graph-convention change, no folder
vocabulary expansion).

## Error handling

No new failure modes: all changes are to pure functions over already-validated
inputs. The `undefined`-level guard (`importerLevel!==undefined && importedLevel!==undefined`)
is preserved, so files in layers absent from `layerOrder` (e.g. markdown `note`)
still produce no violations. No new I/O, no new dependencies.
