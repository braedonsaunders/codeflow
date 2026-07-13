# PR 63 review fixes — security scanner regressions

Branch: `security-scanner-precision` (PR 63 on braedonsaunders/codeflow, currently CLOSED).
Base for this wave: commit `37cdcdd` (branch head). Baseline: full suite 47/47 pass via `node --test` from repo root.

Reviewer reported four merge-blocking regressions. All four were verified against the code before planning. Each task fixes one and adds regression coverage.

## Global constraints

- All scanner logic lives in `index.html` between `// ===== CODEFLOW_ANALYZER_START =====` and `// ===== CODEFLOW_ANALYZER_END =====` markers. Tests (`tests/security-precision.test.mjs`) extract exactly that region and run it in a `node:vm` context — any code you add there must not depend on browser globals.
- Code style in `index.html` is dense ES5-ish: `var`, no spaces around `=` or after `,` in the analyzer section. Match it exactly.
- Fixtures live under `tests/fixtures/security-precision-world/`. Existing tests analyze that fixture tree via `analyzeFixture('security-precision-world')` and assert on `data.securityIssues` / duplicate findings. Follow the existing test patterns in `tests/security-precision.test.mjs`.
- Every task: write the failing regression test FIRST (verify it fails against current code), then apply the fix, then confirm the new test passes and the full suite (`node --test` from repo root) stays green (47 baseline + your new tests).
- Do not renumber or restructure unrelated code. Surgical diffs only.
- Commit per task with a conventional message (`fix(security): …` / `fix(duplicates): …`).

## Task R1 — SQL template injection: scan ALL db calls, not just the first

**Defect** (`index.html:1494-1496`):

```js
var dbCallMatch=scanContent.match(/\b(?:query|execute|raw)\s*\(([^)]*)\)/i);
var hasSqlConcat=scanContent.match(/query\s*\(\s*['"`][^'"`]*\s*\+/)||scanContent.match(/execute\s*\(\s*['"`][^'"`]*\$\{/);
var hasSqlTemplateInjection=dbCallMatch&&/\$\{/.test(dbCallMatch[1])&&/(?:SELECT|INSERT|UPDATE|DELETE)/i.test(dbCallMatch[1]);
```

`.match()` without `/g` captures only the FIRST `query/execute/raw` call. A file whose first call is safe hides a vulnerable second call. Reviewer repro: ``db.query("SELECT 1"); db.query(`SELECT * FROM users WHERE id = ${id}`);`` → no finding.

**Fix**: iterate every db call with a global regex, flag if ANY argument list contains `${` plus a SQL keyword:

```js
var dbCallRegex=/\b(?:query|execute|raw)\s*\(([^)]*)\)/gi;
var hasSqlTemplateInjection=false;
var dbCall;
while((dbCall=dbCallRegex.exec(scanContent))!==null){
    if(/\$\{/.test(dbCall[1])&&/(?:SELECT|INSERT|UPDATE|DELETE)/i.test(dbCall[1])){hasSqlTemplateInjection=true;break;}
}
```

Keep `hasSqlConcat` and the finding-emission block (`f.isCode&&(hasSqlConcat||hasSqlTemplateInjection)`) unchanged.

**Regression coverage**: add a fixture file (e.g. `tests/fixtures/security-precision-world/lib/reporting.ts`) whose FIRST db call is safe (`db.query("SELECT 1")` or similar, no `${`, no string concat) and whose SECOND call is a template-literal SQL query interpolating a variable. Test asserts a `SQL Injection Risk` finding is produced for that file. Verify test fails before the fix. Check the new fixture does not trip unrelated rules (run full suite) — if it does, adjust the fixture content, not the rules.

## Task R2 — detect `node:child_process`

**Defect** (`index.html:1525`):

```js
var execMatch=scanContent.match(/(?:child_process|cp)\.\w*[Ee]xec\w*\s*\(/)||scanContent.match(/require\(\s*['"]child_process['"]\s*\)/)||scanContent.match(/from\s+['"]child_process['"]/);
```

Neither the `require` nor the `from` alternative allows the `node:` specifier prefix. `import { exec } from "node:child_process"; exec(userInput);` produces no Command Execution finding, while a bare `require('child_process')` with no call still does.

**Fix**: add `(?:node:)?` to both import alternatives:

```js
var execMatch=scanContent.match(/(?:child_process|cp)\.\w*[Ee]xec\w*\s*\(/)||scanContent.match(/require\(\s*['"](?:node:)?child_process['"]\s*\)/)||scanContent.match(/from\s+['"](?:node:)?child_process['"]/);
```

Do NOT change the pre-existing behavior of flagging an import without a call — the reviewer noted the asymmetry but the blocking defect is the missed `node:` form.

**Regression coverage**: add a fixture file in a production path (NOT under `test/`, `docs/`, `.claude/` etc. — the rule is gated by `!isNonProductionPath`) containing `import { exec } from "node:child_process";` and a call `exec(someVar)`. Test asserts a `Command Execution` finding for that file. Verify it fails pre-fix. Also keep an eye on `require("node:child_process")` — cover it in the same test if cheap (a second assertion via a second snippet in the same fixture is fine).

## Task R3 — restore structural (type "code") duplicate detection for non-production paths

**Defect** (`index.html:1267-1268`): commit `0e9a675` added `isNonProductionPath(fn.file)` to BOTH the name-based `fnByName` loop (line ~1220, documented and intended) AND the structural `codeGroups` loop:

```js
allFns.forEach(function(fn){
    if(isNonProductionPath(fn.file))return;   // ← REMOVE this line (codeGroups loop only)
    if(!fn.code||fn.code.length<80)return;
```

The PR body states structural `type: "code"` duplicate detection is intentionally untouched; this guard silently disabled it for tests/fixtures/tooling/docs.

**Fix**: remove the guard from the `codeGroups` loop ONLY (the one right after `var codeGroups=Object.create(null);`). Leave the `fnByName` loop guard (with its comment) in place.

**Regression coverage**: test that two structurally-identical functions (≥80 chars of code, different files, at least one under a non-production path such as `tests/` or a fixture `docs/`/tooling path) still yield a structural duplicate finding (`type:'code'` or however `buildAnalysisData` surfaces it — inspect how existing duplicate tests in `tests/security-precision.test.mjs` assert, e.g. the Next.js route-handler test, and mirror that mechanism). Verify the test fails against current branch code and passes after removing the guard. Prefer synthetic in-memory input over new fixture files if the existing test harness allows (it constructs `allFns` from fixtures — if fixture files are needed, place them so they don't disturb other assertions).

## Task R4 — wire the new `info` severity into sort map, UI totals, and styles

**Defect**: commit `9254993` introduced `severity:'info'` (Debug Statements on backend paths) but:
- `index.html:1606` sort map lacks it: `var sev={high:0,medium:1,low:2};` → `sev['info']` is `undefined`, comparator returns `NaN`, ordering becomes unstable/inconsistent.
- UI totals row (`index.html:~8755-8759`) renders only High/Medium/Low badges — an info finding is listed below but absent from the totals.
- CSS has `.security-item.high/.medium/.low` (lines 170-172) but no `.security-item.info`.
- `getSeverityColor` (`index.html:5377-5379`) falls through to blue for info, identical to low.

**Fix**:
1. Sort map → `var sev={high:0,medium:1,low:2,info:3};`
2. Totals row: add a fourth badge after Low: `React.createElement('div',{className:'badge badge-default'},data.securityIssues.filter(function(i){return i.severity==='info';}).length,' Info')` — `badge-default` already exists (used at line ~8212). Match surrounding formatting.
3. CSS: add `.security-item.info` after line 172, following the pattern of the others but with a neutral/muted tint (inspect the CSS variables near the top of `index.html` and pick an existing neutral color var, e.g. the muted-text/border gray family — do not invent new hex without checking the palette).
4. `getSeverityColor`: return the same neutral/muted color for `level==='info'` so the StatusDot distinguishes info from low. Keep critical/high/medium/low behavior identical.

**Regression coverage**: the vm-based harness only extracts the ANALYZER region, so UI/CSS aren't testable there. Cover what is testable: assert `detectSecurity` (or the sorted `securityIssues` from `analyzeFixture`) places an `info` finding strictly after `low` findings and that the comparator never yields NaN for any pair of severities present (e.g. assert the array of severities is ordered per `{high,medium,low,info}`). An existing fixture already produces an info finding (backend Debug Statements — check `server/logger.ts`); if none exists, extend a backend fixture with >3 console.log calls.

## Task R5 — full-suite regression + ledger

Run `node --test` from repo root in the working tree. Expect baseline 47 + all new tests, 0 fail. Record results.

## After all tasks

Final whole-branch review (this review wave only: diff `37cdcdd..HEAD`), then push to `fork` and reopen PR 63 (or open a revised PR if reopen is rejected) with a comment mapping each reviewer finding to its fix commit + regression test.
