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

async function analyzeSyntheticFiles(fileDescs) {
  const analyzed = [];
  const allFns = [];

  for (const file of fileDescs) {
    const path = file.path;
    const name = basename(path);
    const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : 'root';
    const content = file.content;
    const layer = Parser.detectLayer(path);
    const actualIsCode = Parser.isCode(name) !== false && (!Parser.isScriptContainer(path) || Parser.hasEmbeddedCode(content, path));
    const functions = actualIsCode ? Parser.extract(content, path) : [];
    analyzed.push({
      path,
      name,
      folder,
      content,
      functions,
      lines: content ? content.split('\n').length : 0,
      layer,
      churn: 0,
      isCode: actualIsCode,
    });
    if (actualIsCode) {
      functions.forEach((fn) => allFns.push(Object.assign({}, fn, { folder, layer })));
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

test('Hardcoded Secret rule still applies to executable infrastructure paths', async () => {
  // Fixture lines are assembled at runtime so this test file never contains a
  // literal credential-shaped string (fake values only, for the analyzer regex).
  const credentialLine = (keyword, fakeValue) => `${keyword} = "${fakeValue}"\n`;
  const data = await analyzeSyntheticFiles([
    { path: '.github/workflows/notify.js', content: `const ${credentialLine('api_key', 'fake-ci-value-1234')}` },
    { path: '.claude/hooks/session-start.py', content: credentialLine('password', 'fake-hook-value-1234') },
    { path: 'scripts/provision.py', content: credentialLine('token', 'fake-script-value-1234') },
    { path: 'docs/setup.md', content: credentialLine('password', 'fake-doc-value-1234') },
  ]);
  const flaggedPaths = data.securityIssues
    .filter((i) => i.title === 'Hardcoded Secret')
    .map((i) => i.path);

  assert.equal(flaggedPaths.includes('.github/workflows/notify.js'), true);
  assert.equal(flaggedPaths.includes('.claude/hooks/session-start.py'), true);
  assert.equal(flaggedPaths.includes('scripts/provision.py'), true);
  assert.equal(flaggedPaths.includes('docs/setup.md'), false);
});

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

test('Command Execution rule detects node: specifier on child_process import and require', async () => {
  const data = await analyzeFixture('security-precision-world');
  const flaggedPaths = data.securityIssues
    .filter((i) => i.title === 'Command Execution')
    .map((i) => i.path);

  assert.equal(flaggedPaths.includes('server/logger.ts'), true);
});

test('Command Execution rule detects require("node:child_process") in isolation', async () => {
  const data = await analyzeSyntheticFiles([
    {
      path: 'server/spawner.ts',
      content: 'const cp=require("node:child_process");\n',
    },
  ]);
  const flaggedPaths = data.securityIssues
    .filter((i) => i.title === 'Command Execution')
    .map((i) => i.path);

  assert.equal(flaggedPaths.includes('server/spawner.ts'), true);
});

test('SQL Injection Risk rule excludes markdown prose, keeps real template injection', async () => {
  const data = await analyzeFixture('security-precision-world');
  const flaggedPaths = data.securityIssues
    .filter((i) => i.title === 'SQL Injection Risk')
    .map((i) => i.path);

  assert.equal(flaggedPaths.includes('docs/decisions.md'), false);
  assert.equal(flaggedPaths.includes('lib/db.ts'), true);
});

test('SQL Injection Risk rule catches a vulnerable second db call after a safe first call', async () => {
  const data = await analyzeFixture('security-precision-world');
  const flaggedPaths = data.securityIssues
    .filter((i) => i.title === 'SQL Injection Risk')
    .map((i) => i.path);

  assert.equal(flaggedPaths.includes('lib/db.ts'), true);
});

test('XSS Vulnerability rule excludes static literals, keeps variable interpolation', async () => {
  const data = await analyzeFixture('security-precision-world');
  const flaggedPaths = data.securityIssues
    .filter((i) => i.title === 'XSS Vulnerability')
    .map((i) => i.path);

  assert.equal(flaggedPaths.includes('app/page.tsx'), false);
  assert.equal(flaggedPaths.includes('app/profile-card.tsx'), true);
});

test('XSS Vulnerability rule still catches a dangerous occurrence after a safe literal in the same file', async () => {
  const data = await analyzeFixture('security-precision-world');
  const flaggedPaths = data.securityIssues
    .filter((i) => i.title === 'XSS Vulnerability')
    .map((i) => i.path);

  assert.equal(flaggedPaths.includes('app/mixed-render.tsx'), true);
});

test('Function Constructor rule excludes substring mentions, keeps real constructor calls', async () => {
  const data = await analyzeFixture('security-precision-world');
  const flaggedPaths = data.securityIssues
    .filter((i) => i.title === 'Function Constructor')
    .map((i) => i.path);

  assert.equal(flaggedPaths.includes('lib/csp.ts'), false);
  assert.equal(flaggedPaths.includes('lib/dynamic.ts'), true);
});

test('Function Constructor rule flags bare Function() and new Function(), not identifiers like getFunction()', async () => {
  const data = await analyzeSyntheticFiles([
    { path: 'lib/factory.ts', content: 'export function make(src: string) {\n  return Function(src);\n}\n' },
    { path: 'lib/builder.ts', content: 'export function build(src: string) {\n  return new Function(src);\n}\n' },
    { path: 'lib/reflection.ts', content: 'export function lookup(name: string) {\n  return getFunction(name);\n}\n' },
  ]);
  const flaggedPaths = data.securityIssues
    .filter((i) => i.title === 'Function Constructor')
    .map((i) => i.path);

  assert.equal(flaggedPaths.includes('lib/factory.ts'), true);
  assert.equal(flaggedPaths.includes('lib/builder.ts'), true);
  assert.equal(flaggedPaths.includes('lib/reflection.ts'), false);
});

test('Debug Statements rule downgrades server-only code, keeps client code at low', async () => {
  const data = await analyzeFixture('security-precision-world');
  const serverIssue = data.securityIssues.find((i) => i.title === 'Debug Statements' && i.path === 'server/logger.ts');
  const clientIssue = data.securityIssues.find((i) => i.title === 'Debug Statements' && i.path === 'components/dashboard.tsx');

  assert.equal(serverIssue.severity, 'info');
  assert.equal(clientIssue.severity, 'low');
});

test('security issue sort places info strictly after high/medium/low with no NaN corruption', async () => {
  const data = await analyzeSyntheticFiles([
    { path: 'server/telemetry.ts', content: 'console.log(1);console.log(2);console.log(3);console.log(4);\n' },
    { path: 'app/widget.ts', content: 'var f=new Function("return 1;");\n' },
    { path: 'lib/db-query.ts', content: 'function findUser(id){ return db.query(`SELECT * FROM users WHERE id = ${id}`); }\n' },
  ]);
  const rank = { high: 0, medium: 1, low: 2, info: 3 };
  const severities = Array.from(data.securityIssues, (i) => i.severity);

  assert.deepEqual(severities, ['high', 'medium', 'info']);
  for (let i = 1; i < severities.length; i++) {
    assert.ok(
      rank[severities[i - 1]] <= rank[severities[i]],
      'security issues must be sorted by non-decreasing severity rank (high, medium, low, info)'
    );
  }
});

test('Duplicate names: Next.js POST route handlers are not flagged as a naming conflict', async () => {
  const data = await analyzeFixture('security-precision-world');
  const postNameDup = data.duplicates.find((d) => d.type === 'name' && d.name === 'POST');

  assert.equal(postNameDup, undefined);
});

test('XSS Vulnerability rule excludes dangerouslySetInnerHTML in non-production paths, even with variable interpolation', async () => {
  const data = await analyzeFixture('security-precision-world');
  const flaggedPaths = data.securityIssues
    .filter((i) => i.title === 'XSS Vulnerability')
    .map((i) => i.path);

  assert.equal(flaggedPaths.includes('preview-guard.md'), false);
  assert.equal(flaggedPaths.includes('app/profile-card.tsx'), true);
});

test('Duplicate code: structural duplicates are still detected across non-production paths', async () => {
  const duplicateFn = [
    'function processDataAlpha(items){',
    '    var result=[];',
    '    for(var i=0;i<items.length;i++){',
    '        if(items[i]>0){',
    '            result.push(items[i]*2);',
    '        }',
    '    }',
    '    return result;',
    '}',
    '',
  ].join('\n');
  const data = await analyzeSyntheticFiles([
    { path: 'tests/helpers/a.ts', content: duplicateFn },
    { path: 'tools/b.ts', content: duplicateFn.replace('processDataAlpha', 'processDataBeta') },
  ]);

  const codeDup = data.duplicates.find(
    (d) => d.type === 'code' && d.files.some((f) => f.file === 'tests/helpers/a.ts') && d.files.some((f) => f.file === 'tools/b.ts')
  );

  assert.notEqual(codeDup, undefined);
});
