# Security & duplicate-detector precision — design

Date: 2026-07-11
Status: Approved for planning

## Context

`detectSecurity()` and `findDuplicates()` in the analyzer (embedded in `index.html`
between `CODEFLOW_ANALYZER_START`/`END`, ~lines 393-790) are plain regex/substring
scanners over raw file text, with no awareness of file role (test/fixture/tooling
vs. shipped product code) applied to security rules, no word-boundary precision on
several patterns, and a hand-curated function-name allowlist that omits Next.js App
Router route-handler conventions.

This was diagnosed by running CodeFlow against an external project (AIROI): all 10
"critical" security issues and the "duplicate POST/GET" quality issue it reported
were false positives. Each was traced to a specific line in the analyzer:

| Alert | Root cause | Analyzer location |
|---|---|---|
| Hardcoded Secret in a test stub | No test-path exclusion in `detectSecurity`, even though `isArchitectureTestFile()` already exists in the same file for a different feature | ~line 703 |
| SQL Injection on a markdown bullet | Regex treats the English words select/insert/update/delete as SQL keywords, and scans all text file types including `.md` | ~line 707 |
| XSS on `dangerouslySetInnerHTML` with a static i18n string | Pure substring match on the API name, no check of whether the injected value is a literal or an external variable | ~line 711 |
| Shell Injection Risk on a dev git hook script | Scans the entire repo including tooling directories, no path exclusion | ~line 773 |
| Function Constructor false hit | `scanContent.includes('Function(')` is an unanchored substring match | ~line 721 |
| Debug Statements flagged on legitimate server logs | Pure count heuristic (`>3`), no client/server distinction | ~line 727 |
| "Duplicate POST/GET/generateMetadata" | `commonNames` allowlist covers React/Vue/Angular/Express/Python conventions but omits Next.js App Router route-handler exports | ~line 397-430 |

The tool's own authors are aware detection noise is a real problem: `getSecurityScanContent()`
(index.html ~line 743) special-cases CodeFlow's own `index.html` to strip out
`detectSecurity` entirely when CodeFlow scans itself, so its own regex-pattern
strings (which contain `eval`, `Function(`, etc.) don't self-flag. That fix was
never generalized to consumer repositories.

## Goal

Reduce false-positive rate on the security scanner and duplicate-name detector to
the point where the "Security Scanner" feature advertised in the README is
trustworthy on real-world repositories, without turning the analyzer into a full
static-analysis engine (no AST-based taint tracking, no dependency additions).

## Scope

In scope: precision fixes to the 7 detectors above, upstreamable as a single PR to
`braedonsaunders/codeflow`.

Out of scope (explicitly, to avoid scope creep):
- Full data-flow/taint analysis for XSS or SQL injection.
- Extending `commonNames` to frameworks other than Next.js (no concrete evidence
  for other frameworks yet).
- Any change to `Debug Statements` beyond the backend/frontend path distinction.
- Any UI/UX/packaging/documentation work beyond the README's "Security Scanner"
  section, which must stay accurate to the new behavior.

## Design

### 1. Shared file classifier

New function, adjacent to the existing `isArchitectureTestFile`/
`isArchitectureFixtureFile` (~line 2502):

```js
function isNonProductionPath(path){
    var p=String(path||'').toLowerCase().replace(/\\/g,'/');
    if(isArchitectureTestFile(p))return true;
    if(isArchitectureFixtureFile(p))return true;
    if(/(^|\/)\.github(\/|$)/.test(p))return true;
    if(/(^|\/)\.claude(\/|$)/.test(p))return true;
    if(/(^|\/)(scripts|tools|tooling)(\/|$)/.test(p))return true;
    if(/(^|\/)docs?(\/|$)/.test(p))return true;
    if(/\.(md|markdown|mdx)$/.test(p))return true;
    return false;
}
```

This reuses the two classifiers that already exist but were only wired into the
architecture/dead-code path, never into security or duplicate detection. It becomes
the single source of truth for "does this path count as shipped product code?".

`detectSecurity(files)` and `findDuplicates(...)` both consult it. Rules that only
make sense for product code (secrets, XSS, shell/command execution) skip when
`isNonProductionPath(f.path)` is true. Python-specific rules (eval/exec/pickle/
subprocess) stay active on all `.py` files regardless of path — a path-only signal
can't distinguish a production Python script from a tooling one — but this
limitation is documented in the PR body rather than left implicit.

### 2. Per-category fixes

1. **Hardcoded Secret** (~line 703-705): add the `isNonProductionPath` guard before
   pushing the issue. Regex itself unchanged.

2. **SQL Injection Risk** (~line 707-709): restrict to `f.isCode` files only (the
   parser already computes this); tighten the third alternative to require a
   plausible DB-call receiver on the same line
   (`/\.(query|execute|raw)\s*\(/`) immediately preceding the SELECT/INSERT/
   UPDATE/DELETE match, instead of matching the bare English word anywhere in the
   file.

3. **XSS Vulnerability** (~line 711-716): extract the `__html:` value and skip the
   issue when it is a literal/template string with no external identifier
   interpolation:
   ```js
   var htmlMatch=scanContent.match(/dangerouslySetInnerHTML\s*:\s*\{\s*__html\s*:\s*([^}]+)\}/);
   var isLiteralOnly=htmlMatch&&/^\s*(['"`])(?:(?!\1).)*\1\s*$/.test(htmlMatch[1].trim());
   ```
   Any interpolation of a variable/expression still triggers the issue — this stays
   heuristic by design (per approved scope), not full taint analysis.

4. **Command/Shell Execution** (~line 724-726, 737-738, 773-774): add the
   `isNonProductionPath` guard; tighten `.exec(` to
   `/(?:child_process|cp)\.\w*[Ee]xec\w*\s*\(/` so it no longer matches
   `regex.exec(...)`.

5. **Function Constructor** (~line 721-722): remove the bare
   `scanContent.includes('Function(')`; keep only `/\bnew\s+Function\s*\(/`.

6. **Debug Statements** (~line 727-731): reuse the existing
   `isArchitectureBackendPath` classifier (~line 2521) to downgrade
   `severity` from `'low'` to `'info'` when the file is server-only code, since a
   server-side `console.log` never reaches the browser and isn't the same class of
   risk as a client-side one. The issue is still surfaced, not deleted.

7. **Duplicate function names** (~line 397-430): add to `commonNames`:
   `'GET','POST','PUT','DELETE','PATCH','HEAD','OPTIONS','generateMetadata',
   'generateStaticParams','generateImageMetadata','generateSitemaps','middleware'`.

### 3. Testing strategy

Follow the existing golden-fixture pattern (`tests/codeflow-golden.test.mjs`):
extract the analyzer from `index.html` via `vm`, run it against fixtures on disk,
assert on `buildAnalysisData` output.

New fixture: `tests/fixtures/security-precision-world/`, containing one
false-positive case and one true-positive case per detector (8 pairs total,
covering all 7 categories plus the shell/`.exec` word-boundary case):

- `test/client-ip.test.ts` (stub secret, must NOT be flagged) vs. `lib/auth.ts`
  (real hardcoded literal outside test dir, must stay flagged).
- `docs/decisions.md` ("update" in prose, must NOT be flagged) vs. `lib/db.ts`
  (`query("SELECT * FROM x + " + id)`, must stay flagged).
- `app/page.tsx` (`__html:"<em>fixed</em>"`, must NOT be flagged) vs. a component
  with `__html: rawUserBio`, must stay flagged.
- `.claude/hooks/pre-commit.py` (`subprocess.run(cmd, shell=True)`, must NOT be
  flagged) vs. `api/import.py` (same call, outside tooling dir, must stay flagged).
- A file using `regex.exec(str)` (must NOT be flagged) vs. one using
  `child_process.exec(userInput)` (must stay flagged).
- A comment containing the string `"getFunction(x)"` (must NOT be flagged) vs.
  `new Function(userCode)` (must stay flagged).
- Three `route.ts` files each exporting `POST`/`GET` with a similar auth wrapper
  (must NOT produce a duplicate-name issue).

New test file `tests/security-precision.test.mjs`, one `test()` per pair, same
`assert.equal`/`assert.deepEqual` style as the existing golden test.

Non-regression: `tests/codeflow-golden.test.mjs` must stay green unmodified.

### 4. Delivery

Single PR to `braedonsaunders/codeflow`, one commit per category for reviewability:

1. `isNonProductionPath` + wiring into `detectSecurity`/`findDuplicates`.
2. One commit per of the 7 per-category fixes.
3. The new fixture + `tests/security-precision.test.mjs`.
4. README "Security Scanner" section update if the documented behavior changes
   (e.g., noting that test/tooling/doc paths are excluded from the security scan).

PR body documents the explicitly out-of-scope items above as known limitations.

## Error handling

No new failure modes: all changes are additional guards/regex tightening on
existing pure functions operating on already-validated file objects. No new I/O,
no new dependencies. If `f.path` is ever undefined, `isNonProductionPath` treats it
as an empty string and returns `false` (matches current defensive style elsewhere
in the file, e.g. `String(path||'')`).
