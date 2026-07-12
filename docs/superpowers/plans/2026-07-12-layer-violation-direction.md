# Layer-Violation Direction Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make CodeFlow's Architecture Violations detector report the correct dependency direction (it currently reports the exact inverse), fix the secondary `detectLayer` leading-slash gap, and correct the coupling metric's fan-in/fan-out label — all inside `index.html`'s analyzer, no new dependencies.

**Architecture:** Three localized fixes to pure functions in the analyzer block of `index.html` (`Parser.detectLayerViolations`, `Parser.detectLayer`, and the coupling issue-builder inside `buildAnalysisData`), each backed by a new fixture-driven test in `tests/layer-violation-direction.test.mjs` following the existing `tests/codeflow-golden.test.mjs` VM-harness pattern. None of the fixes touch how the connection graph (`conns`) is built — they only correct readers that misinterpret the documented `{source: definition, target: caller}` convention.

**Tech Stack:** Vanilla JS (no build step, no framework, no new dependencies). Tests run with Node's built-in `node:test` runner via `node --test`.

## Global Constraints

- No new npm dependencies. No build step exists for `index.html` and none is being introduced.
- Every change lives inside the existing `CODEFLOW_ANALYZER_START`/`END` block in `index.html`, matching the file's existing code style (`var`, single-line `if` bodies, no semicolonless ASI reliance).
- Do NOT change how `conns` is built (`index.html:4740`) or the documented `{source: fileDefiningFn, target: fileCallingFn}` convention (`index.html:4947`). Other consumers (graph rendering, circular detection) rely on it. Fix only the misreading consumers.
- Do NOT expand `detectLayer`'s folder vocabulary (no new rules for `db/`, `legacy/`, `*.config.*`). The only `detectLayer` change is leading-slash tolerance so existing patterns also match root-level folders.
- `tests/codeflow-golden.test.mjs` and the full existing suite (`node --test`) must stay green, unmodified, after every task (non-regression gate).
- Every code change in this plan has been verified against the real analyzer (via `card/lib/analyzer.js`) — implementers transcribe, they do not re-derive.

---

## File Structure

- `index.html` — modify in place (analyzer block only): `Parser.detectLayerViolations` (~line 1379), `Parser.detectLayer` (~line 1098), coupling issue-builder (~line 4765).
- `tests/layer-violation-direction.test.mjs` — new test file, created in Task 1, appended to in Tasks 2-3.

---

### Task 1: Fix the direction inversion in `detectLayerViolations`

**Files:**
- Modify: `index.html:1384-1403` (the `connections.forEach` body inside `detectLayerViolations`)
- Create: `tests/layer-violation-direction.test.mjs`

**Interfaces:**
- Consumes: `Parser.detectLayerViolations(files, connections)` where `files` is `[{path, layer}]` and `connections` follows the documented convention `{source: fileDefiningFn, target: fileCallingFn, fn}` (`index.html:4947`).
- Produces: `tests/layer-violation-direction.test.mjs` — a standalone `node:test` file following the same in-file analyzer-loading pattern as `tests/codeflow-golden.test.mjs`. Tasks 2-3 append to it.

- [ ] **Step 1: Write the test harness and the two failing direction tests**

Create `tests/layer-violation-direction.test.mjs`:
```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const htmlSource = await readFile(join(repoRoot, 'index.html'), 'utf8');
const startMarker = '// ===== CODEFLOW_ANALYZER_START =====';
const endMarker = '// ===== CODEFLOW_ANALYZER_END =====';
const parserStart = htmlSource.indexOf(startMarker);
const parserEnd = htmlSource.indexOf(endMarker, parserStart);

if (parserStart < 0 || parserEnd < 0) {
  throw new Error('Could not locate analyzer source in index.html');
}

const context = {
  console,
  TreeSitter: undefined,
  Babel: undefined,
  acorn: undefined,
  getSecurityScanContent(file) {
    return file && file.content ? file.content : '';
  },
  isSanitizedPreviewRenderer() {
    return false;
  },
};

vm.createContext(context);
vm.runInContext(`${htmlSource.slice(parserStart, parserEnd)}\nthis.Parser = Parser;`, context);
const { Parser } = context;

// Convention (index.html): connection {source: fileDefiningFn (imported), target: fileCallingFn (importer)}.
// layerOrder: lower number = higher/topmost layer. services=2, utils/lib=4. utils importing UP from services = violation.
const files = [
  { path: 'src/services/userService.ts', layer: 'services' },
  { path: 'src/lib/helper.ts', layer: 'utils' },
];

test('healthy downward dependency (service uses a util) is NOT a violation', () => {
  // userService (services) calls a function defined in lib/helper (utils):
  // caller = userService, definition = helper => {source: helper, target: userService}
  const violations = Parser.detectLayerViolations(files, [
    { source: 'src/lib/helper.ts', target: 'src/services/userService.ts', fn: 'formatDate' },
  ]);
  assert.equal(violations.length, 0);
});

test('genuine upward dependency (util reaches into a service) IS a violation, correctly attributed', () => {
  // helper (utils) calls a function defined in userService (services):
  // caller = helper, definition = userService => {source: userService, target: helper}
  const violations = Parser.detectLayerViolations(files, [
    { source: 'src/services/userService.ts', target: 'src/lib/helper.ts', fn: 'fetchUser' },
  ]);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].from, 'src/lib/helper.ts');
  assert.equal(violations[0].to, 'src/services/userService.ts');
  assert.match(violations[0].suggestion, /utils should not import from services/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/layer-violation-direction.test.mjs`
Expected: BOTH fail — the healthy-dependency test reports 1 violation (false positive), and the genuine-violation test reports 0 (false negative), because the current code reads the direction backwards.

- [ ] **Step 3: Apply the direction fix**

In `index.html`, inside `detectLayerViolations:function(files,connections){`, find:
```js
        connections.forEach(function(c){
            var srcFile=fileByPath[c.source];
            var tgtFile=fileByPath[c.target];
            if(!srcFile||!tgtFile)return;
            var srcLayer=(srcFile.layer||'').toLowerCase();
            var tgtLayer=(tgtFile.layer||'').toLowerCase();
            var srcLevel=layerOrder[srcLayer];
            var tgtLevel=layerOrder[tgtLayer];
            // Violation: lower layer importing from higher layer (e.g., service importing from UI)
            if(srcLevel!==undefined&&tgtLevel!==undefined&&srcLevel>tgtLevel&&srcLevel-tgtLevel>1){
                violations.push({
                    from:srcFile.path,
                    fromLayer:srcFile.layer,
                    to:tgtFile.path,
                    toLayer:tgtFile.layer,
                    fn:c.fn,
                    suggestion:srcFile.layer+' should not import from '+tgtFile.layer+'. Consider inverting the dependency or using dependency injection.'
                });
            }
        });
```

Replace with:
```js
        connections.forEach(function(c){
            // Convention (see buildAnalysisData): source = file DEFINING the fn (imported),
            // target = file CALLING it (the importer). The importer is c.target.
            var importedFile=fileByPath[c.source];
            var importerFile=fileByPath[c.target];
            if(!importedFile||!importerFile)return;
            var importedLayer=(importedFile.layer||'').toLowerCase();
            var importerLayer=(importerFile.layer||'').toLowerCase();
            var importedLevel=layerOrder[importedLayer];
            var importerLevel=layerOrder[importerLayer];
            // Violation: a more-foundational file (higher level number) imports from a higher-up layer.
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

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/layer-violation-direction.test.mjs`
Expected: PASS (2 tests)

- [ ] **Step 5: Run the non-regression suite**

Run: `node --test`
Expected: all suites PASS, including `tests/codeflow-golden.test.mjs` and `tests/architecture-diagram.test.mjs`, unchanged. (Layer classification is unchanged by this task; only violation direction changed, and no existing test hard-asserts on violation output.)

- [ ] **Step 6: Commit**

```bash
git add index.html tests/layer-violation-direction.test.mjs
git commit -m "fix(architecture): report layer violations in the correct dependency direction"
```

---

### Task 2: `detectLayer` leading-slash tolerance for root-level folders

**Files:**
- Modify: `index.html:1098-1099` (the first two lines of `detectLayer`)
- Modify: `tests/layer-violation-direction.test.mjs` (append one `test()` block)

**Verified behavior:** every folder pattern in `detectLayer` requires a leading slash (`l.includes('/service')`, `/util`, `/lib/`, etc.), so a layer folder at the repository root (relative path, no leading slash) never matches and falls through to `return 'utils'`. Confirmed against the real analyzer: `services/userService.ts` → `utils` (wrong), while `src/services/userService.ts` → `services` (right). Prepending a single `/` to the normalized path makes root-level folders match identically to nested ones, with no change to already-nested paths. The golden fixture's files (`src/*.js`, `src/*.py`, root `*.md`) are unaffected: `src/service.py` still matches `/service` → `services`; the others match no folder pattern → `utils`; markdown is overridden to `note` before classification matters.

- [ ] **Step 1: Append the failing test**

Append to `tests/layer-violation-direction.test.mjs`:
```js
test('detectLayer classifies root-level layer folders, not just nested ones', () => {
  // Root-level folders (no leading path segment) must match the same as nested ones.
  assert.equal(Parser.detectLayer('services/userService.ts'), 'services');
  assert.equal(Parser.detectLayer('ui/Button.tsx'), 'ui');
  assert.equal(Parser.detectLayer('lib/helper.ts'), 'utils');
  // Nested paths keep their existing classification (regression guard).
  assert.equal(Parser.detectLayer('src/services/userService.ts'), 'services');
  assert.equal(Parser.detectLayer('src/lib/helper.ts'), 'utils');
  // A file with no recognizable layer folder still falls through to the default.
  assert.equal(Parser.detectLayer('src/app.js'), 'utils');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/layer-violation-direction.test.mjs`
Expected: FAIL — `detectLayer('services/userService.ts')` currently returns `'utils'`, not `'services'` (and `'ui/Button.tsx'` returns `'utils'`, not `'ui'`).

- [ ] **Step 3: Apply the leading-slash normalization**

In `index.html`, find the first two lines of `detectLayer`:
```js
    detectLayer:function(p){
        var l=p.toLowerCase();
```

Replace with:
```js
    detectLayer:function(p){
        // Prepend a leading slash so root-level layer folders (e.g. "services/x.ts")
        // match the same substring patterns as nested ones (e.g. "src/services/x.ts").
        var l='/'+p.toLowerCase().replace(/^\/+/,'');
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/layer-violation-direction.test.mjs`
Expected: PASS (3 tests total)

- [ ] **Step 5: Run the non-regression suite**

Run: `node --test`
Expected: all suites PASS. In particular `tests/codeflow-golden.test.mjs` (whose fixture layers are unchanged by this normalization) and `tests/architecture-diagram.test.mjs` stay green. If any suite changes, STOP and report — a shifted classification means a fixture path matched a pattern it shouldn't; do not modify existing tests to accommodate.

- [ ] **Step 6: Commit**

```bash
git add index.html tests/layer-violation-direction.test.mjs
git commit -m "fix(architecture): classify root-level layer folders in detectLayer"
```

---

### Task 3: Correct the coupling metric's fan-in/fan-out label

**Files:**
- Modify: `index.html:4765` (the "Highly Coupled" issue title/desc)
- Modify: `tests/layer-violation-direction.test.mjs` (append one `test()` block)

**Verified behavior:** `coupling[c.target]++` (`index.html:4763`) keys on `c.target`, which — per the documented convention — is the **calling** file (the importer). So the count is each file's fan-**out** (how many external functions it calls), but the emitted issue is titled "Highly Coupled" with desc "Files imported by 8+ others" (fan-**in**). This is a mislabel, not a miscount: the metric still surfaces highly-coupled files, but the description claims the opposite relationship. This task corrects only the wording (zero behavioral risk); it does NOT change the `c.target` key, because re-keying to `c.source` would change which files are flagged and is out of scope.

- [ ] **Step 1: Append the failing test**

This fix is a pure copy change to a static string literal (no behavioral difference — the `coupling` count and which files are flagged are unchanged). A proportionate guard asserts on the emitted wording directly, using the `htmlSource` the harness already loaded. Append to `tests/layer-violation-direction.test.mjs`:
```js
test('coupling issue label describes fan-out (files it imports), not fan-in', () => {
  const start = htmlSource.indexOf("title:highCoup.length+' Highly Coupled'");
  assert.ok(start > 0, 'Highly Coupled issue builder not found in analyzer source');
  const snippet = htmlSource.slice(start, start + 200);
  // The stale fan-in wording ("imported by 8+ others") must be gone...
  assert.equal(/imported by 8\+ others/.test(snippet), false, 'stale fan-in wording still present');
  // ...replaced by wording that describes fan-out (this file imports others).
  assert.match(snippet, /import 8\+ other/);
});
```

Note: this is intentionally a source-text guard, not a pipeline test — the change alters only a description string, so exercising the full `buildAnalysisData` coupling path (which would require engineering a 9+ file fixture to trip the `>8` threshold) would add fixture complexity without testing anything the string assertion doesn't. If a reviewer prefers a behavioral test, that is a reasonable upgrade, but it is not required for a copy-only change.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/layer-violation-direction.test.mjs`
Expected: FAIL — the current desc is `'Files imported by 8+ others'`, so the `/imported by 8\+ others/` match is still true (assertion `false` fails) and the new-wording match is absent.

- [ ] **Step 3: Apply the label correction**

In `index.html`, find:
```js
    if(highCoup.length)issues.push({type:'warning',title:highCoup.length+' Highly Coupled',desc:'Files imported by 8+ others',items:highCoup.map(function(x){return{name:x[0].split('/').pop()+' ('+x[1]+' imports)',file:x[0],imports:x[1]};})});
```

Replace with:
```js
    if(highCoup.length)issues.push({type:'warning',title:highCoup.length+' Highly Coupled',desc:'Files that import 8+ other files',items:highCoup.map(function(x){return{name:x[0].split('/').pop()+' ('+x[1]+' imports)',file:x[0],imports:x[1]};})});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/layer-violation-direction.test.mjs`
Expected: PASS (4 tests total)

- [ ] **Step 5: Run the non-regression suite**

Run: `node --test`
Expected: all suites PASS, unchanged.

- [ ] **Step 6: Commit**

```bash
git add index.html tests/layer-violation-direction.test.mjs
git commit -m "fix(architecture): correct coupling issue label to describe fan-out, not fan-in"
```

---

### Task 4: Full regression pass

**Files:** none (verification only)

- [ ] **Step 1: Run every test in the repo**

Run: `node --test`
Expected: all suites PASS, including `tests/layer-violation-direction.test.mjs` (4 tests), `tests/codeflow-golden.test.mjs`, and `tests/architecture-diagram.test.mjs`, all unmodified except the new file.

- [ ] **Step 2: Confirm the diff touches only the intended surface**

Run: `git diff --stat origin/main..HEAD`
Expected: only `index.html`, `tests/layer-violation-direction.test.mjs`, and the two `docs/superpowers/` files (design + plan) changed. No other files.

- [ ] **Step 3: Report status**

No commit — verification checkpoint. If both steps pass, the branch is ready for the user to review and decide whether to push and open the PR against `braedonsaunders/codeflow` (not automated by this plan).

---

## Self-Review Notes

- **Spec coverage:** all three design fixes have a task (1: direction inversion — primary; 2: detectLayer leading-slash — secondary; 3: coupling label — tertiary), plus a final regression pass (4). The out-of-scope items from the design (no `conns` change, no folder-vocabulary expansion, no coupling re-key) are respected — each task's fix is the minimal one named in the design.
- **Placeholder scan:** no TBD/TODO; every step has complete, verified code.
- **Type/name consistency:** the connection field names (`source`, `target`, `fn`), the `files` element shape (`{path, layer}`), and the violation output fields (`from`, `to`, `fromLayer`, `toLayer`, `suggestion`) match the actual `detectLayerViolations` contract at `index.html:1379-1405`. The test harness mirrors `tests/codeflow-golden.test.mjs` exactly (same markers, same VM context stubs).
