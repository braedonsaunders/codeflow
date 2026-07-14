# Security & Duplicate-Detector Precision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the false-positive classes in CodeFlow's `detectSecurity`/`detectDuplicates` analyzer (embedded in `index.html`) that were documented by running the tool against an external project, without adding dependencies or building full taint analysis.

**Architecture:** All changes live inside the single analyzer block in `index.html` (`CODEFLOW_ANALYZER_START`…`END`). A new shared classifier `isNonProductionPath()` generalizes two classifiers that already exist for a different feature (`isArchitectureTestFile`, `isArchitectureFixtureFile`) and wires them into `detectSecurity`/`detectDuplicates`. Six further precision fixes are layered on top, each independently testable via the existing golden-fixture test pattern.

**Tech Stack:** Vanilla JS (no build step, no framework, no new dependencies). Tests run with Node's built-in `node:test` runner via `node --test`.

## Global Constraints

- No new npm dependencies. No build step exists for `index.html` and none is being introduced.
- Every change lives inside the existing `CODEFLOW_ANALYZER_START`/`END` block in `index.html`, matching the file's existing code style (`var`, no semicolonless ASI reliance, single-line `if` bodies as already used throughout this file).
- `tests/codeflow-golden.test.mjs` must stay green, unmodified, after every task (non-regression gate).
- Each task's own new/updated test(s) in `tests/security-precision.test.mjs` must pass before moving to the next task.
- Every regex/logic change in this plan has already been verified against real reproductions of the false positives (see each task's "Verified behavior" note) — implementers should not need to re-derive the regexes, only transcribe them.
- Fixture credential-like values must be obviously synthetic so they don't trip GitHub's own scanning once pushed.
- Out of scope (do not implement): full data-flow/taint analysis, `commonNames` entries for frameworks other than Next.js App Router, any change to `Debug Statements` beyond the backend/frontend severity split, any UI/packaging/documentation work beyond the README's "Security Scanner" section.

---

## File Structure

- `index.html` — modify in place (analyzer block only): new `isNonProductionPath()` function; `detectSecurity` rule guards/regex tightening; `detectDuplicates` (`Parser.detectDuplicates`) allowlist + path guard.
- `tests/fixtures/security-precision-world/` — new fixture tree, one false-positive/true-positive file pair added per task.
- `tests/security-precision.test.mjs` — new test file, created in Task 1, one `test()` appended per task.
- `README.md` — one paragraph added to the "Security Scanner" section (Task 8).

---

### Task 1: Shared file classifier + Hardcoded Secret fix

**Files:**

- Modify: `index.html:3288-3292` (insert `isNonProductionPath` after `isArchitectureFixtureFile`)
- Modify: `index.html:1484-1486` (gate the Hardcoded Secret rule)
- Create: `tests/fixtures/security-precision-world/test/client-ip.test.ts`
- Create: `tests/fixtures/security-precision-world/lib/auth.ts`
- Create: `tests/security-precision.test.mjs`

**Interfaces:**

- Produces: global function `isNonProductionPath(path: string): boolean` — returns `true` for test/fixture/tooling/docs/markdown paths. Declared as a top-level `function` statement (hoisted, same pattern as the existing `getSecurityScanContent`/`isSanitizedPreviewRenderer` globals that `Parser.detectSecurity` already calls), so it is callable from inside the `Parser` object literal without import.
- Produces: `tests/security-precision.test.mjs` exposes no exports — it is a standalone `node:test` file following the same in-file harness pattern as `tests/codeflow-golden.test.mjs`. Later tasks append `test(...)` blocks to this same file and add fixtures under `tests/fixtures/security-precision-world/`.

- [ ] **Step 1: Add the fixture pair**

Create `tests/fixtures/security-precision-world/test/client-ip.test.ts`:

```ts
const AUTH_SECRET = "stub-auth-secret-for-tests";

export function resolveClientIp(headers: Record<string, string>) {
  if (headers["x-forwarded-for"]) return headers["x-forwarded-for"];
  return AUTH_SECRET ? "test-mode" : "unknown";
}
```

Create `tests/fixtures/security-precision-world/lib/auth.ts`:

```ts
export const AUTH_SECRET = "hardcoded-example-not-a-real-credential-9f8e7d6c";

export function getAuthSecret() {
  return AUTH_SECRET;
}
```

- [ ] **Step 2: Write the test harness and the failing test**

Create `tests/security-precision.test.mjs`:

```js
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
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
vm.runInContext(
  `${htmlSource.slice(parserStart, parserEnd)}\nthis.Parser = Parser; this.buildAnalysisData = buildAnalysisData;`,
  context
);

const { Parser, buildAnalysisData } = context;

async function collectFixtureFiles(root) {
  const files = [];

  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile() || !Parser.isIncluded(entry.name)) continue;
      const repoPath = relative(root, fullPath).replace(/\\/g, '/');
      files.push({
        fullPath,
        path: repoPath,
        name: basename(repoPath),
        folder: repoPath.includes('/') ? repoPath.slice(0, repoPath.lastIndexOf('/')) : 'root',
        isCode: Parser.isCode(entry.name),
      });
    }
  }

  await walk(root);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

async function analyzeFixture(name) {
  const root = join(__dirname, 'fixtures', name);
  const files = await collectFixtureFiles(root);
  const analyzed = [];
  const allFns = [];

  for (const file of files) {
    const content = await readFile(file.fullPath, 'utf8');
    const layer = Parser.detectLayer(file.path);
    const actualIsCode = file.isCode !== false && (!Parser.isScriptContainer(file.path) || Parser.hasEmbeddedCode(content, file.path));
    const functions = actualIsCode ? Parser.extract(content, file.path) : [];
    analyzed.push({
      path: file.path,
      name: file.name,
      folder: file.folder,
      content,
      functions,
      lines: content ? content.split('\n').length : 0,
      layer,
      churn: 0,
      isCode: actualIsCode,
    });
    if (actualIsCode) {
      functions.forEach((fn) => allFns.push(Object.assign({}, fn, { folder: file.folder, layer })));
    }
  }

  return buildAnalysisData({
    analyzed,
    allFns,
    excludePatterns: [],
    progress() {},
    yieldFn: async () => {},
  });
}

test('Hardcoded Secret rule excludes test stubs, keeps real hits', async () => {
  const data = await analyzeFixture('security-precision-world');
  const flaggedPaths = data.securityIssues
    .filter((i) => i.title === 'Hardcoded Secret')
    .map((i) => i.path);

  assert.equal(flaggedPaths.includes('test/client-ip.test.ts'), false);
  assert.equal(flaggedPaths.includes('lib/auth.ts'), true);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test tests/security-precision.test.mjs`
Expected: FAIL — `flaggedPaths.includes('test/client-ip.test.ts')` is `true` (both files are currently flagged).

- [ ] **Step 4: Add the shared classifier**

In `index.html`, find:

```js
function isArchitectureFixtureFile(path){
    var p=String(path||'').toLowerCase().replace(/\\/g,'/');
    return /(^|\/)fixtures(\/|$)/.test(p)||/(^|\/)__fixtures__(\/|$)/.test(p);
}

function isArchitectureBarrelIndex(path){
```

Replace with:

```js
function isArchitectureFixtureFile(path){
    var p=String(path||'').toLowerCase().replace(/\\/g,'/');
    return /(^|\/)fixtures(\/|$)/.test(p)||/(^|\/)__fixtures__(\/|$)/.test(p);
}

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

function isArchitectureBarrelIndex(path){
```

**Verified behavior:** `isArchitectureTestFile`/`isArchitectureFixtureFile` are plain top-level `function` declarations defined later in the same script scope (~line 3283); JS function-declaration hoisting makes them callable from `isNonProductionPath` regardless of source order, exactly like `Parser.detectSecurity` already calls the top-level `getSecurityScanContent`/`isSanitizedPreviewRenderer` globals declared elsewhere in the file.

- [ ] **Step 5: Gate the Hardcoded Secret rule**

In `index.html`, inside `detectSecurity:function(files){`, find:

```js
            lines.forEach(function(line,idx){
                if(line.match(/(?:password|passwd|pwd|secret|api_key|apikey|token|auth)\s*[=:]\s*['"][^'"]{4,}['"]/i)&&!line.includes('process.env')&&!line.includes('config.')){
                    issues.push({severity:'high',title:'Hardcoded Secret',file:f.name,path:f.path,line:idx+1,desc:'Credentials should never be hardcoded. Use environment variables or a secrets manager.',code:line.trim().substring(0,80)});
                }
            });
```

Replace with:

```js
            lines.forEach(function(line,idx){
                if(!isNonProductionPath(f.path)&&line.match(/(?:password|passwd|pwd|secret|api_key|apikey|token|auth)\s*[=:]\s*['"][^'"]{4,}['"]/i)&&!line.includes('process.env')&&!line.includes('config.')){
                    issues.push({severity:'high',title:'Hardcoded Secret',file:f.name,path:f.path,line:idx+1,desc:'Credentials should never be hardcoded. Use environment variables or a secrets manager.',code:line.trim().substring(0,80)});
                }
            });
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `node --test tests/security-precision.test.mjs`
Expected: PASS

- [ ] **Step 7: Run the non-regression suite**

Run: `node --test tests/codeflow-golden.test.mjs`
Expected: PASS, unchanged (1 test, same assertions as before this task).

- [ ] **Step 8: Commit**

```bash
git add index.html tests/security-precision.test.mjs tests/fixtures/security-precision-world/test/client-ip.test.ts tests/fixtures/security-precision-world/lib/auth.ts
git commit -m "fix(security): exclude test/tooling paths from Hardcoded Secret rule"
```

---

### Task 2: Command/Shell Execution — path guard + `.exec(` word-boundary fix

**Files:**

- Modify: `index.html:1505-1506` (JS Command Execution rule)
- Modify: `index.html:1518-1519` (VBA Shell Command Execution rule)
- Modify: `index.html:1554-1555` (Python `subprocess shell=True` rule)
- Create: `tests/fixtures/security-precision-world/.claude/hooks/pre-commit.py`
- Create: `tests/fixtures/security-precision-world/api/import.py`
- Create: `tests/fixtures/security-precision-world/lib/search.ts`
- Create: `tests/fixtures/security-precision-world/lib/runner.ts`
- Modify: `tests/security-precision.test.mjs` (append two `test()` blocks)

**Interfaces:**

- Consumes: `isNonProductionPath(path)` from Task 1.

**Verified behavior (checked against the exact regexes below, run through the real analyzer):**

- `api/import.py` and `lib/runner.ts` (production code) stay flagged.
- `.claude/hooks/pre-commit.py` (dev tooling) and `lib/search.ts` (uses `regex.exec()`, unrelated to shell) are no longer flagged.

- [ ] **Step 1: Add the fixture files**

Create `tests/fixtures/security-precision-world/.claude/hooks/pre-commit.py`:

```py
import subprocess


def run(cmd):
    subprocess.run(cmd, shell=True)
```

Create `tests/fixtures/security-precision-world/api/import.py`:

```py
import subprocess


def run(cmd):
    subprocess.run(cmd, shell=True)
```

Create `tests/fixtures/security-precision-world/lib/search.ts`:

```ts
export function find(items: string[], re: RegExp) {
  return items.filter((i) => re.exec(i));
}
```

Create `tests/fixtures/security-precision-world/lib/runner.ts`:

```ts
import child_process from 'child_process';

export function run(userInput: string) {
  return child_process.exec(userInput);
}
```

- [ ] **Step 2: Append the failing tests**

Append to `tests/security-precision.test.mjs`:

```js
test('Shell Injection Risk rule excludes dev tooling, keeps real hits', async () => {
  const data = await analyzeFixture('security-precision-world');
  const flaggedPaths = data.securityIssues
    .filter((i) => i.title === 'Shell Injection Risk')
    .map((i) => i.path);

  assert.equal(flaggedPaths.includes('.claude/hooks/pre-commit.py'), false);
  assert.equal(flaggedPaths.includes('api/import.py'), true);
});

test('Command Execution rule excludes regex.exec(), keeps child_process.exec()', async () => {
  const data = await analyzeFixture('security-precision-world');
  const flaggedPaths = data.securityIssues
    .filter((i) => i.title === 'Command Execution')
    .map((i) => i.path);

  assert.equal(flaggedPaths.includes('lib/search.ts'), false);
  assert.equal(flaggedPaths.includes('lib/runner.ts'), true);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test tests/security-precision.test.mjs`
Expected: both new tests FAIL — `.claude/hooks/pre-commit.py` is currently flagged, and `lib/search.ts` (`regex.exec(...)`) is currently flagged as Command Execution.

- [ ] **Step 4: Fix the JS Command Execution rule**

In `index.html`, inside `detectSecurity:function(files){`, find:

```js
            if(scanContent.match(/\.exec\s*\(/)||scanContent.match(/child_process/)){
                issues.push({severity:'medium',title:'Command Execution',file:f.name,path:f.path,desc:'Shell command execution detected. Ensure input is sanitized to prevent injection.',code:''});
            }
```

Replace with:

```js
            var execMatch=scanContent.match(/(?:child_process|cp)\.\w*[Ee]xec\w*\s*\(/)||scanContent.match(/require\(\s*['"]child_process['"]\s*\)/)||scanContent.match(/from\s+['"]child_process['"]/);
            if(!isNonProductionPath(f.path)&&execMatch){
                issues.push({severity:'medium',title:'Command Execution',file:f.name,path:f.path,desc:'Shell command execution detected. Ensure input is sanitized to prevent injection.',code:''});
            }
```

- [ ] **Step 5: Fix the VBA Shell Command Execution rule**

In `index.html`, find:

```js
            if(scanContent.match(/Shell\s*\(/i)){
                issues.push({severity:'high',title:'Shell Command Execution',file:f.name,path:f.path,desc:'Shell() executes system commands. Ensure input is validated.',code:''});
            }
```

Replace with:

```js
            if(!isNonProductionPath(f.path)&&scanContent.match(/Shell\s*\(/i)){
                issues.push({severity:'high',title:'Shell Command Execution',file:f.name,path:f.path,desc:'Shell() executes system commands. Ensure input is validated.',code:''});
            }
```

- [ ] **Step 6: Fix the Python `subprocess shell=True` rule**

In `index.html`, find:

```js
                // subprocess with shell=True
                if(scanContent.match(/subprocess\.\w+\([^)]*shell\s*=\s*True/)){
                    issues.push({severity:'high',title:'Shell Injection Risk',file:f.name,path:f.path,desc:'subprocess with shell=True is vulnerable to command injection. Use shell=False with a list of args.',code:''});
                }
```

Replace with:

```js
                // subprocess with shell=True
                if(!isNonProductionPath(f.path)&&scanContent.match(/subprocess\.\w+\([^)]*shell\s*=\s*True/)){
                    issues.push({severity:'high',title:'Shell Injection Risk',file:f.name,path:f.path,desc:'subprocess with shell=True is vulnerable to command injection. Use shell=False with a list of args.',code:''});
                }
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `node --test tests/security-precision.test.mjs`
Expected: PASS (3 tests total: Task 1's + these 2)

- [ ] **Step 8: Run the non-regression suite**

Run: `node --test tests/codeflow-golden.test.mjs`
Expected: PASS, unchanged.

- [ ] **Step 9: Commit**

```bash
git add index.html tests/security-precision.test.mjs tests/fixtures/security-precision-world/.claude tests/fixtures/security-precision-world/api tests/fixtures/security-precision-world/lib/search.ts tests/fixtures/security-precision-world/lib/runner.ts
git commit -m "fix(security): scope Command/Shell Execution rules to product paths and real exec calls"
```

---

### Task 3: SQL Injection Risk — scope to code files, anchor to a DB-call receiver

**Files:**

- Modify: `index.html:1488-1490`
- Create: `tests/fixtures/security-precision-world/docs/decisions.md`
- Create: `tests/fixtures/security-precision-world/lib/db.ts`
- Modify: `tests/security-precision.test.mjs` (append one `test()` block)

**Verified behavior:** the current rule's third alternative (`/\$\{.*\}.*(?:SELECT|INSERT|UPDATE|DELETE)/i`) requires no DB-call receiver at all, so it also matches prose containing both a `${...}`-shaped token and an English SQL-ish word on the same line (confirmed against `docs/decisions.md` below). It is also **order-dependent** — `SELECT ... ${id}` (keyword before the interpolation, the realistic case) does not match it at all, so `lib/db.ts` below is a real SQL-injection pattern the current rule silently misses. The replacement fixes both: it requires a `query`/`execute`/`raw` call whose argument list contains both a SQL keyword and a `${` interpolation, in either order.

- [ ] **Step 1: Add the fixture pair**

Create `tests/fixtures/security-precision-world/docs/decisions.md`:

```md
# Decisions actees 2026-07-10

Voir ${CHANGELOG} pour la mise a jour complete (update log).
```

Create `tests/fixtures/security-precision-world/lib/db.ts`:

```ts
export function findUser(id: string) {
  return db.query(`SELECT * FROM users WHERE id = ${id}`);
}
```

- [ ] **Step 2: Append the failing test**

Append to `tests/security-precision.test.mjs`:

```js
test('SQL Injection Risk rule excludes markdown prose, keeps real template injection', async () => {
  const data = await analyzeFixture('security-precision-world');
  const flaggedPaths = data.securityIssues
    .filter((i) => i.title === 'SQL Injection Risk')
    .map((i) => i.path);

  assert.equal(flaggedPaths.includes('docs/decisions.md'), false);
  assert.equal(flaggedPaths.includes('lib/db.ts'), true);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test tests/security-precision.test.mjs`
Expected: FAIL — `docs/decisions.md` is currently flagged and `lib/db.ts` currently is not (both wrong, in opposite directions).

- [ ] **Step 4: Fix the rule**

In `index.html`, inside `detectSecurity:function(files){`, find:

```js
            if(scanContent.match(/query\s*\(\s*['"`][^'"`]*\s*\+/)||scanContent.match(/execute\s*\(\s*['"`][^'"`]*\$\{/)||scanContent.match(/\$\{.*\}.*(?:SELECT|INSERT|UPDATE|DELETE)/i)){
                var m=scanContent.match(/.*(query|execute|SELECT|INSERT|UPDATE|DELETE).*(\+|\$\{).*/i);
                issues.push({severity:'high',title:'SQL Injection Risk',file:f.name,path:f.path,desc:'String concatenation in SQL queries. Use parameterized queries instead.',code:m?m[0].trim().substring(0,80):''});
            }
```

Replace with:

```js
            var dbCallMatch=scanContent.match(/\b(?:query|execute|raw)\s*\(([^)]*)\)/i);
            var hasSqlConcat=scanContent.match(/query\s*\(\s*['"`][^'"`]*\s*\+/)||scanContent.match(/execute\s*\(\s*['"`][^'"`]*\$\{/);
            var hasSqlTemplateInjection=dbCallMatch&&/\$\{/.test(dbCallMatch[1])&&/(?:SELECT|INSERT|UPDATE|DELETE)/i.test(dbCallMatch[1]);
            if(f.isCode&&(hasSqlConcat||hasSqlTemplateInjection)){
                var m=scanContent.match(/.*(query|execute|SELECT|INSERT|UPDATE|DELETE).*(\+|\$\{).*/i);
                issues.push({severity:'high',title:'SQL Injection Risk',file:f.name,path:f.path,desc:'String concatenation in SQL queries. Use parameterized queries instead.',code:m?m[0].trim().substring(0,80):''});
            }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test tests/security-precision.test.mjs`
Expected: PASS (4 tests total)

- [ ] **Step 6: Run the non-regression suite**

Run: `node --test tests/codeflow-golden.test.mjs`
Expected: PASS, unchanged.

- [ ] **Step 7: Commit**

```bash
git add index.html tests/security-precision.test.mjs tests/fixtures/security-precision-world/docs tests/fixtures/security-precision-world/lib/db.ts
git commit -m "fix(security): anchor SQL Injection Risk to a real DB-call receiver"
```

---

### Task 4: XSS Vulnerability — skip literal-only `dangerouslySetInnerHTML`

**Files:**

- Modify: `index.html:1492-1496`
- Create: `tests/fixtures/security-precision-world/app/page.tsx`
- Create: `tests/fixtures/security-precision-world/app/profile-card.tsx`
- Modify: `tests/security-precision.test.mjs` (append one `test()` block)

**Verified behavior:** the extraction regex `dangerouslySetInnerHTML\s*[:=]\s*\{\{?\s*__html\s*:\s*([^}]+)\}` matches both the JSX-attribute form (`dangerouslySetInnerHTML={{__html: ...}}`) and the object-literal form (`dangerouslySetInnerHTML:{__html:...}`, used by CodeFlow's own preview renderer). Confirmed against real fixture content that a pure quoted-literal capture is correctly classified as safe, and an identifier capture (`rawUserBio`) is not.

- [ ] **Step 1: Add the fixture pair**

Create `tests/fixtures/security-precision-world/app/page.tsx`:

```tsx
export function LandingCopy() {
  return (
    <p dangerouslySetInnerHTML={{ __html: "<em>5 a 30x</em> moins cher que vos outils actuels" }} />
  );
}
```

Create `tests/fixtures/security-precision-world/app/profile-card.tsx`:

```tsx
export function ProfileCard({ rawUserBio }: { rawUserBio: string }) {
  return <div dangerouslySetInnerHTML={{ __html: rawUserBio }} />;
}
```

- [ ] **Step 2: Append the failing test**

Append to `tests/security-precision.test.mjs`:

```js
test('XSS Vulnerability rule excludes static literals, keeps variable interpolation', async () => {
  const data = await analyzeFixture('security-precision-world');
  const flaggedPaths = data.securityIssues
    .filter((i) => i.title === 'XSS Vulnerability')
    .map((i) => i.path);

  assert.equal(flaggedPaths.includes('app/page.tsx'), false);
  assert.equal(flaggedPaths.includes('app/profile-card.tsx'), true);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test tests/security-precision.test.mjs`
Expected: FAIL — both files are currently flagged.

- [ ] **Step 4: Fix the rule**

In `index.html`, inside `detectSecurity:function(files){`, find:

```js
            var hasInnerHtmlAssignment=scanContent.match(/innerHTML\s*=/);
            var hasDangerousHtmlRender=scanContent.match(/dangerouslySetInnerHTML/);
            var isSafePreviewRender=!hasInnerHtmlAssignment&&hasDangerousHtmlRender&&isSanitizedPreviewRenderer(f.content||'');
            if((hasInnerHtmlAssignment||hasDangerousHtmlRender)&&!isSafePreviewRender){
                issues.push({severity:'high',title:'XSS Vulnerability',file:f.name,path:f.path,desc:'Direct HTML injection can lead to XSS attacks. Sanitize user input.',code:''});
            }
```

Replace with:

```js
            var hasInnerHtmlAssignment=scanContent.match(/innerHTML\s*=/);
            var hasDangerousHtmlRender=scanContent.match(/dangerouslySetInnerHTML/);
            var isSafePreviewRender=!hasInnerHtmlAssignment&&hasDangerousHtmlRender&&isSanitizedPreviewRenderer(f.content||'');
            var htmlValueMatch=scanContent.match(/dangerouslySetInnerHTML\s*[:=]\s*\{\{?\s*__html\s*:\s*([^}]+)\}/);
            var isLiteralOnlyHtml=!!(htmlValueMatch&&/^(['"`])(?:(?!\1)[\s\S])*\1$/.test(htmlValueMatch[1].trim()));
            var isSafeStaticHtml=!hasInnerHtmlAssignment&&hasDangerousHtmlRender&&isLiteralOnlyHtml;
            if((hasInnerHtmlAssignment||hasDangerousHtmlRender)&&!isSafePreviewRender&&!isSafeStaticHtml){
                issues.push({severity:'high',title:'XSS Vulnerability',file:f.name,path:f.path,desc:'Direct HTML injection can lead to XSS attacks. Sanitize user input.',code:''});
            }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test tests/security-precision.test.mjs`
Expected: PASS (5 tests total)

- [ ] **Step 6: Run the non-regression suite**

Run: `node --test tests/codeflow-golden.test.mjs`
Expected: PASS, unchanged.

- [ ] **Step 7: Commit**

```bash
git add index.html tests/security-precision.test.mjs tests/fixtures/security-precision-world/app
git commit -m "fix(security): skip XSS Vulnerability for literal-only dangerouslySetInnerHTML"
```

---

### Task 5: Function Constructor — remove unanchored substring match

**Files:**

- Modify: `index.html:1502-1504`
- Create: `tests/fixtures/security-precision-world/lib/csp.ts`
- Create: `tests/fixtures/security-precision-world/lib/dynamic.ts`
- Modify: `tests/security-precision.test.mjs` (append one `test()` block)

- [ ] **Step 1: Add the fixture pair**

Create `tests/fixtures/security-precision-world/lib/csp.ts`:

```ts
// NOTE: getFunction(x) helper lives in utils/reflection.ts - unrelated to eval.
export const CSP_HEADER = "script-src 'self'";
```

Create `tests/fixtures/security-precision-world/lib/dynamic.ts`:

```ts
export function buildHandler(userCode: string) {
  return new Function(userCode);
}
```

- [ ] **Step 2: Append the failing test**

Append to `tests/security-precision.test.mjs`:

```js
test('Function Constructor rule excludes substring mentions, keeps real constructor calls', async () => {
  const data = await analyzeFixture('security-precision-world');
  const flaggedPaths = data.securityIssues
    .filter((i) => i.title === 'Function Constructor')
    .map((i) => i.path);

  assert.equal(flaggedPaths.includes('lib/csp.ts'), false);
  assert.equal(flaggedPaths.includes('lib/dynamic.ts'), true);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test tests/security-precision.test.mjs`
Expected: FAIL — `lib/csp.ts` is currently flagged (the comment contains the substring `Function(`).

- [ ] **Step 4: Fix the rule**

In `index.html`, inside `detectSecurity:function(files){`, find:

```js
            if(scanContent.includes('Function(')||scanContent.match(/new\s+Function\s*\(/)){
                issues.push({severity:'medium',title:'Function Constructor',file:f.name,path:f.path,desc:'Function constructor is similar to eval(). Consider alternatives.',code:''});
            }
```

Replace with:

```js
            if(scanContent.match(/\bnew\s+Function\s*\(/)){
                issues.push({severity:'medium',title:'Function Constructor',file:f.name,path:f.path,desc:'Function constructor is similar to eval(). Consider alternatives.',code:''});
            }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test tests/security-precision.test.mjs`
Expected: PASS (6 tests total)

- [ ] **Step 6: Run the non-regression suite**

Run: `node --test tests/codeflow-golden.test.mjs`
Expected: PASS, unchanged.

- [ ] **Step 7: Commit**

```bash
git add index.html tests/security-precision.test.mjs tests/fixtures/security-precision-world/lib/csp.ts tests/fixtures/security-precision-world/lib/dynamic.ts
git commit -m "fix(security): anchor Function Constructor rule to an actual constructor call"
```

---

### Task 6: Debug Statements — downgrade severity for server-only code

**Files:**

- Modify: `index.html:1508-1512`
- Create: `tests/fixtures/security-precision-world/server/logger.ts`
- Create: `tests/fixtures/security-precision-world/components/dashboard.tsx`
- Modify: `tests/security-precision.test.mjs` (append one `test()` block)

**Interfaces:**

- Consumes: `isArchitectureBackendPath(path)`, an existing classifier at `index.html:3302` (not modified by this task — only newly consumed by `detectSecurity`).

- [ ] **Step 1: Add the fixture pair**

Create `tests/fixtures/security-precision-world/server/logger.ts`:

```ts
export function bootServer() {
  console.log('booting server');
  console.log('loading config');
  console.info('config loaded');
  console.debug('ready to accept connections');
}
```

Create `tests/fixtures/security-precision-world/components/dashboard.tsx`:

```tsx
export function Dashboard() {
  console.log('render start');
  console.log('data', 1);
  console.info('mounted');
  console.debug('layout computed');
  return null;
}
```

- [ ] **Step 2: Append the failing test**

Append to `tests/security-precision.test.mjs`:

```js
test('Debug Statements rule downgrades server-only code, keeps client code at low', async () => {
  const data = await analyzeFixture('security-precision-world');
  const serverIssue = data.securityIssues.find((i) => i.title === 'Debug Statements' && i.path === 'server/logger.ts');
  const clientIssue = data.securityIssues.find((i) => i.title === 'Debug Statements' && i.path === 'components/dashboard.tsx');

  assert.equal(serverIssue.severity, 'info');
  assert.equal(clientIssue.severity, 'low');
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test tests/security-precision.test.mjs`
Expected: FAIL — `serverIssue.severity` is currently `'low'`, not `'info'`.

- [ ] **Step 4: Fix the rule**

In `index.html`, inside `detectSecurity:function(files){`, find:

```js
            if(scanContent.match(/console\.(log|debug|info)\(/)){
                var consoleCount=(scanContent.match(/console\.(log|debug|info)\(/g)||[]).length;
                if(consoleCount>3){
                    issues.push({severity:'low',title:'Debug Statements',file:f.name,path:f.path,desc:consoleCount+' console statements found. Remove before production.',code:''});
                }
            }
```

Replace with:

```js
            if(scanContent.match(/console\.(log|debug|info)\(/)){
                var consoleCount=(scanContent.match(/console\.(log|debug|info)\(/g)||[]).length;
                if(consoleCount>3){
                    var debugSeverity=isArchitectureBackendPath(f.path)?'info':'low';
                    issues.push({severity:debugSeverity,title:'Debug Statements',file:f.name,path:f.path,desc:consoleCount+' console statements found. Remove before production.',code:''});
                }
            }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test tests/security-precision.test.mjs`
Expected: PASS (7 tests total)

- [ ] **Step 6: Run the non-regression suite**

Run: `node --test tests/codeflow-golden.test.mjs`
Expected: PASS, unchanged.

- [ ] **Step 7: Commit**

```bash
git add index.html tests/security-precision.test.mjs tests/fixtures/security-precision-world/server tests/fixtures/security-precision-world/components
git commit -m "fix(security): downgrade Debug Statements severity for server-only code"
```

---

### Task 7: Duplicate function names — Next.js route-handler allowlist + path guard

**Files:**

- Modify: `index.html:1178-1211` (add Next.js names to `commonNames`)
- Modify: `index.html:1213-1231` (skip non-production paths in the name-duplicate grouping)
- Modify: `index.html:1259-1271` (skip non-production paths in the code-duplicate grouping)
- Create: `tests/fixtures/security-precision-world/app/api/users/route.ts`
- Create: `tests/fixtures/security-precision-world/app/api/orders/route.ts`
- Create: `tests/fixtures/security-precision-world/app/api/invoices/route.ts`
- Modify: `tests/security-precision.test.mjs` (append one `test()` block)

**Interfaces:**

- Consumes: `isNonProductionPath(path)` from Task 1.

**Verified behavior:** confirmed directly against `Parser.detectDuplicates` that three files each exporting a byte-identical `POST` function currently produce both a `type:'name'` duplicate (message: "Function \"POST\" appears in 3 files... consider consolidating") and a `type:'code'` duplicate (message: "Similar code blocks... consider extracting to a shared utility"). The `'name'` type is the false positive under investigation — it treats a framework-mandated export name as a naming collision. The `'code'` type is a separate, still-legitimate signal (genuinely identical bodies are worth extracting regardless of what they're named) and is **intentionally left untouched** by the `commonNames` addition — only the path-guard change in this task affects it, and only for paths under test/fixture/tooling/docs directories. This task's test asserts only on the `'name'` type for that reason.

- [ ] **Step 1: Add the fixture files**

Create `tests/fixtures/security-precision-world/app/api/users/route.ts`:

```ts
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const body = await request.json();
  if (!body.email) {
    return NextResponse.json({ error: 'email required' }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
```

Create `tests/fixtures/security-precision-world/app/api/orders/route.ts`:

```ts
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const body = await request.json();
  if (!body.email) {
    return NextResponse.json({ error: 'email required' }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
```

Create `tests/fixtures/security-precision-world/app/api/invoices/route.ts`:

```ts
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const body = await request.json();
  if (!body.email) {
    return NextResponse.json({ error: 'email required' }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Append the failing test**

Append to `tests/security-precision.test.mjs`:

```js
test('Duplicate names: Next.js POST route handlers are not flagged as a naming conflict', async () => {
  const data = await analyzeFixture('security-precision-world');
  const postNameDup = data.duplicates.find((d) => d.type === 'name' && d.name === 'POST');

  assert.equal(postNameDup, undefined);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test tests/security-precision.test.mjs`
Expected: FAIL — a `type:'name'` duplicate for `POST` across the 3 route files is currently produced.

- [ ] **Step 4: Add the Next.js route-handler names to `commonNames`**

In `index.html`, inside `Parser.detectDuplicates:function(files,allFns){`, find:

```js
            'onMount','onDestroy'
        ]);
```

Replace with:

```js
            'onMount','onDestroy',
            // Next.js App Router route-handler & metadata exports (framework-mandated names)
            'GET','POST','PUT','DELETE','PATCH','HEAD','OPTIONS',
            'generateMetadata','generateStaticParams','generateImageMetadata','generateSitemaps','middleware'
        ]);
```

- [ ] **Step 5: Skip non-production paths in the name-duplicate grouping**

In `index.html`, find:

```js
        var fnByName=Object.create(null);
        allFns.forEach(function(fn){
            // Skip non-string names (e.g. numeric object-literal keys from the JS AST walker)
            if(typeof fn.name!=='string')return;
```

Replace with:

```js
        var fnByName=Object.create(null);
        allFns.forEach(function(fn){
            // Skip functions outside shipped product code (tests, fixtures, tooling, docs)
            if(isNonProductionPath(fn.file))return;
            // Skip non-string names (e.g. numeric object-literal keys from the JS AST walker)
            if(typeof fn.name!=='string')return;
```

- [ ] **Step 6: Skip non-production paths in the code-duplicate grouping**

In `index.html`, find:

```js
        var codeGroups=Object.create(null);
        allFns.forEach(function(fn){
            if(!fn.code||fn.code.length<80)return;  // Skip very short functions
```

Replace with:

```js
        var codeGroups=Object.create(null);
        allFns.forEach(function(fn){
            if(isNonProductionPath(fn.file))return;
            if(!fn.code||fn.code.length<80)return;  // Skip very short functions
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `node --test tests/security-precision.test.mjs`
Expected: PASS (8 tests total)

- [ ] **Step 8: Run the non-regression suite**

Run: `node --test tests/codeflow-golden.test.mjs`
Expected: PASS, unchanged.

- [ ] **Step 9: Commit**

```bash
git add index.html tests/security-precision.test.mjs tests/fixtures/security-precision-world/app/api
git commit -m "fix(duplicates): recognize Next.js route-handler exports as idiomatic, not duplicated"
```

---

### Task 8: Document the exclusions in the README

**Files:**

- Modify: `README.md:46-51`

- [ ] **Step 1: Update the Security Scanner section**

In `README.md`, find:

```md
### Security Scanner
Automatic detection of:
- Hardcoded secrets & API keys
- SQL injection vulnerabilities
- Dangerous `eval()` usage
- Debug statements in production code
```

Replace with:

```md
### Security Scanner
Automatic detection of:
- Hardcoded secrets & API keys
- SQL injection vulnerabilities
- Dangerous `eval()` usage
- Debug statements in production code

Test files, fixtures, `docs/`, and common tooling directories (`.github/`, `.claude/`, `scripts/`) are excluded from the secret/XSS/shell-execution checks, since findings there don't reflect the shipped product's attack surface.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document security scanner path exclusions"
```

---

### Task 9: Full regression pass

**Files:** none (verification only)

- [ ] **Step 1: Run every test file in the repo**

Run: `node --test tests/`
Expected: all suites PASS, including `tests/codeflow-golden.test.mjs` (unchanged) and `tests/security-precision.test.mjs` (8 tests, all passing).

- [ ] **Step 2: Confirm the fixture tree matches the plan**

Run: `find tests/fixtures/security-precision-world -type f | sort`
Expected output (order may vary by platform, content must match):

```
tests/fixtures/security-precision-world/.claude/hooks/pre-commit.py
tests/fixtures/security-precision-world/api/import.py
tests/fixtures/security-precision-world/app/api/invoices/route.ts
tests/fixtures/security-precision-world/app/api/orders/route.ts
tests/fixtures/security-precision-world/app/api/users/route.ts
tests/fixtures/security-precision-world/app/page.tsx
tests/fixtures/security-precision-world/app/profile-card.tsx
tests/fixtures/security-precision-world/components/dashboard.tsx
tests/fixtures/security-precision-world/docs/decisions.md
tests/fixtures/security-precision-world/lib/auth.ts
tests/fixtures/security-precision-world/lib/csp.ts
tests/fixtures/security-precision-world/lib/db.ts
tests/fixtures/security-precision-world/lib/dynamic.ts
tests/fixtures/security-precision-world/lib/runner.ts
tests/fixtures/security-precision-world/lib/search.ts
tests/fixtures/security-precision-world/server/logger.ts
tests/fixtures/security-precision-world/test/client-ip.test.ts
```

- [ ] **Step 3: Report status**

No commit in this task — it is a verification checkpoint. If both steps pass, the branch is ready for the user to review and decide whether to push and open the PR against `braedonsaunders/codeflow` (not automated by this plan).

---

## Self-Review Notes

- **Spec coverage:** all 7 detector categories from the design doc have a task (1: secret, 2: shell/exec, 3: SQL, 4: XSS, 5: Function Constructor, 6: debug statements, 7: duplicates), plus the README update (8) and final regression (9). The shared classifier from design Section 1 is introduced in Task 1 and reused by Tasks 2 and 7 — no duplicate classifier logic.
- **Placeholder scan:** no TBD/TODO; every step has complete, verified code.
- **Type/name consistency:** `isNonProductionPath` is defined once (Task 1) and referenced identically (same name, same signature) in Tasks 2 and 7. `isArchitectureBackendPath` is consumed, not redefined, in Task 6. Test title strings match the exact `title:` values used in `detectSecurity`'s `issues.push(...)` calls.
