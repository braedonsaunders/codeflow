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

test('SQL Injection Risk rule excludes markdown prose, keeps real template injection', async () => {
  const data = await analyzeFixture('security-precision-world');
  const flaggedPaths = data.securityIssues
    .filter((i) => i.title === 'SQL Injection Risk')
    .map((i) => i.path);

  assert.equal(flaggedPaths.includes('docs/decisions.md'), false);
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

test('Debug Statements rule downgrades server-only code, keeps client code at low', async () => {
  const data = await analyzeFixture('security-precision-world');
  const serverIssue = data.securityIssues.find((i) => i.title === 'Debug Statements' && i.path === 'server/logger.ts');
  const clientIssue = data.securityIssues.find((i) => i.title === 'Debug Statements' && i.path === 'components/dashboard.tsx');

  assert.equal(serverIssue.severity, 'info');
  assert.equal(clientIssue.severity, 'low');
});
