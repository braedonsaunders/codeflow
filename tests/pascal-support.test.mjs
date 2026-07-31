import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const fixtureRoot = join(__dirname, 'fixtures', 'pascal-world');
const html = await readFile(join(repoRoot, 'index.html'), 'utf8');
const start = html.indexOf('// ===== CODEFLOW_ANALYZER_START =====');
const end = html.indexOf('// ===== CODEFLOW_ANALYZER_END =====', start);
const context = {
  console,
  TreeSitter: undefined,
  Babel: undefined,
  acorn: undefined,
  getSecurityScanContent(file) { return file && file.content ? file.content : ''; },
  isSanitizedPreviewRenderer() { return false; },
};

vm.createContext(context);
vm.runInContext(
  html.slice(start, end) + '\nthis.Parser = Parser; this.buildAnalysisData = buildAnalysisData;',
  context
);

const { Parser, buildAnalysisData } = context;

async function analyzePascalFixture() {
  const entries = await readdir(fixtureRoot, { withFileTypes: true });
  const analyzed = [];
  const allFns = [];
  for (const entry of entries) {
    if (!entry.isFile() || !Parser.isIncluded(entry.name)) continue;
    const fullPath = join(fixtureRoot, entry.name);
    const filePath = relative(fixtureRoot, fullPath).replace(/\\/g, '/');
    const content = await readFile(fullPath, 'utf8');
    const functions = Parser.extract(content, filePath);
    const layer = Parser.detectLayer(filePath);
    analyzed.push({
      path: filePath,
      name: basename(filePath),
      folder: 'root',
      content,
      functions,
      lines: content.split('\n').length,
      layer,
      churn: 0,
      isCode: true,
    });
    functions.forEach((fn) => allFns.push(Object.assign({}, fn, { folder: 'root', layer })));
  }
  return buildAnalysisData({
    analyzed,
    allFns,
    excludePatterns: [],
    progress() {},
    yieldFn: async () => {},
  });
}

test('Object Pascal and FreePascal extensions are code files', () => {
  for (const name of ['unit.pas', 'unit.pp', 'app.dpr', 'package.dpk', 'app.lpr', 'shared.inc']) {
    assert.equal(Parser.isCode(name), true, name);
  }
});

test('Pascal extraction uses implementation bodies and recognizes routines', async () => {
  const content = await readFile(join(fixtureRoot, 'MathUtils.pas'), 'utf8');
  const functions = Parser.extract(content, 'MathUtils.pas');

  assert.deepEqual(
    Array.from(functions, (fn) => fn.name).sort(),
    ['DoubleValue', 'LogValue']
  );
});

test('Pascal call graph follows uses units and ignores comments and strings', async () => {
  const data = await analyzePascalFixture();
  const appConnections = data.connections
    .filter((connection) => connection.target === 'app.lpr')
    .map((connection) => connection.source + ':' + connection.fn)
    .sort();

  assert.deepEqual(Array.from(appConnections), ['MathUtils.pas:DoubleValue', 'MathUtils.pas:LogValue']);
  assert.equal(data.connections.some((connection) => connection.source === 'OtherUtils.pp'), false);
  assert.equal(data.stats.files, 3);
  assert.equal(data.stats.functions, 3);
});
