import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const htmlSource = await readFile(join(__dirname, '..', 'index.html'), 'utf8');
const startMarker = '// ===== CODEFLOW_CANVAS_START =====';
const endMarker = '// ===== CODEFLOW_CANVAS_END =====';
const start = htmlSource.indexOf(startMarker);
const end = htmlSource.indexOf(endMarker, start);
if (start < 0 || end < 0) throw new Error('Could not locate canvas helpers in index.html');

const context = { console };
vm.createContext(context);
vm.runInContext(htmlSource.slice(start, end + endMarker.length), context);
const J = (v) => JSON.parse(JSON.stringify(v));

test('readable labels grow only when zoomed out', () => {
  assert.equal(context.readableLabelScale(1), 1);
  assert.equal(context.readableLabelScale(2), 1);
  assert.equal(context.readableLabelScale(0.5), 2);
  assert.ok(context.readableLabelScale(0.1) > 2);
});

test('connected files include both directions', () => {
  const paths = context.getConnectedFilePaths('src/app.js', [
    { source: 'src/math.js', target: 'src/app.js', fn: 'add' },
    { source: 'src/app.js', target: 'src/ui.js', fn: 'render' }
  ]);
  assert.deepEqual(J(paths).sort(), ['src/math.js', 'src/ui.js']);
});

test('symbol extraction finds imports, exports, and functions', () => {
  const file = {
    path: 'src/app.js',
    content: 'import { add } from "./math.js";\nexport function render(){ return add(1, 2); }\n',
    functions: [{ name: 'render', isExported: true }]
  };
  const symbols = context.extractFileSymbols(file, [{ source: 'src/math.js', target: 'src/app.js', fn: 'add' }]);
  const names = J(symbols).map((s) => s.name).sort();
  assert.deepEqual(names, ['add', 'render']);
  assert.equal(symbols.find((s) => s.name === 'add').kind, 'import');
  assert.equal(symbols.find((s) => s.name === 'render').kind, 'export');
});

test('cross-file symbols stay identifiable across visible files', () => {
  const files = [
    { path: 'a.js', content: 'export function shared(){}', functions: [{ name: 'shared', isExported: true }] },
    { path: 'b.js', content: 'import { shared } from "./a.js"; shared();', functions: [] }
  ];
  const symbols = context.collectCrossFileSymbols(files, [{ source: 'a.js', target: 'b.js', fn: 'shared' }]);
  const shared = symbols.find((s) => s.name === 'shared');
  assert.ok(shared);
  assert.equal(shared.files.length, 2);
});

test('symbol annotation wraps identifiers and skips HTML tags', () => {
  const html = '<span class="syn-fn">shared</span> and shared again';
  const out = context.annotateHtmlWithSymbols(html, [{ name: 'shared', kind: 'fn' }], 'shared');
  assert.match(out, /data-sym="shared"/);
  assert.doesNotMatch(out, /class="sym-mark[^"]*">class/);
});

test('visible code files prefer the selection and its neighbors', () => {
  const data = {
    files: [
      { path: 'a.js', folder: 'src', name: 'a.js', content: 'export function a(){}', functions: [{ name: 'a', isExported: true }] },
      { path: 'b.js', folder: 'src', name: 'b.js', content: 'import { a } from "./a.js"', functions: [] },
      { path: 'c.js', folder: 'other', name: 'c.js', content: '', functions: [] }
    ],
    connections: [{ source: 'a.js', target: 'b.js', fn: 'a' }]
  };
  const visible = context.collectVisibleCodeFiles('a.js', data, 'src', 4);
  assert.deepEqual(J(visible).map((f) => f.path), ['a.js', 'b.js']);
});

test('cache keys and records stay stable', () => {
  assert.equal(context.analysisCacheKey('github', 'braedonsaunders/codeflow'), 'github:braedonsaunders/codeflow');
  const record = context.buildRecentAnalysisRecord({
    sourceType: 'github',
    sourceKey: 'owner/repo',
    title: 'owner/repo',
    data: { files: [{ path: 'a.js' }] }
  });
  assert.equal(record.id, 'github:owner/repo');
  assert.equal(record.fileCount, 1);
  assert.ok(record.savedAt > 0);
});

test('github zip URL is a user-chosen download, not a hidden clone', () => {
  assert.equal(
    context.githubZipDownloadUrl('braedonsaunders', 'codeflow'),
    'https://github.com/braedonsaunders/codeflow/archive/HEAD.zip'
  );
});

test('CLI path helper rejects traversal', () => {
  assert.equal(context.resolveSafeCliPath('/tmp/proj', '../etc/passwd'), null);
  assert.equal(context.resolveSafeCliPath('/tmp/proj', '/etc/passwd'), null);
  assert.equal(context.resolveSafeCliPath('/tmp/proj', 'src/app.js'), '/tmp/proj/src/app.js');
});

test('index.html ships a working Code view, not a stub', () => {
  assert.match(htmlSource, /value:'code'/);
  assert.match(htmlSource, /function renderCodeView\(/);
  assert.match(htmlSource, /className:'code-split'/);
  assert.match(htmlSource, /vizType==='code'/);
  assert.match(htmlSource, /readableLabelScale/);
  assert.match(htmlSource, /listRecentAnalyses/);
  assert.match(htmlSource, /__codeflow\/status/);
  assert.match(htmlSource, /The folder picker is faster when the API is rate-limited/);
});
