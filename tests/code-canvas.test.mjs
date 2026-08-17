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

test('folder cache keys differ per selected directory', () => {
  const a = context.localFolderCacheMeta({ title: 'alpha', paths: ['src/app.js', 'src/math.js'] });
  const b = context.localFolderCacheMeta({ title: 'beta', paths: ['src/app.js', 'src/math.js'] });
  const c = context.localFolderCacheMeta({ title: 'alpha', paths: ['lib/app.js'] });
  assert.equal(a.title, 'alpha');
  assert.notEqual(a.sourceKey, b.sourceKey);
  assert.notEqual(a.sourceKey, c.sourceKey);
  assert.equal(context.analysisCacheKey('folder', a.sourceKey), 'folder:' + a.sourceKey);
});

test('CLI cache keys use the watched root instead of a shared fallback', () => {
  const a = context.cliWatchCacheMeta({ ok: true, root: '/tmp/alpha', name: 'alpha' });
  const b = context.cliWatchCacheMeta({ ok: true, root: '/tmp/beta', name: 'beta' });
  const missing = context.cliWatchCacheMeta(null);
  assert.equal(a.sourceKey, '/tmp/alpha');
  assert.equal(a.title, 'alpha');
  assert.notEqual(a.sourceKey, b.sourceKey);
  assert.equal(missing.sourceKey, 'cli');
  assert.equal(context.analysisCacheKey('cli', a.sourceKey), 'cli:/tmp/alpha');
});

test('ZIP cache keys include archive metadata, not only the filename', () => {
  const a = context.zipArchiveCacheMeta({ name: 'main.zip', size: 100, lastModified: 10, paths: ['repo-a/src/app.js'] });
  const b = context.zipArchiveCacheMeta({ name: 'main.zip', size: 200, lastModified: 20, paths: ['repo-b/src/app.js'] });
  const sameNameDifferentPaths = context.zipArchiveCacheMeta({ name: 'main.zip', size: 100, lastModified: 10, paths: ['other/src/app.js'] });
  assert.equal(a.title, 'main.zip');
  assert.notEqual(a.sourceKey, b.sourceKey);
  assert.notEqual(a.sourceKey, sameNameDifferentPaths.sourceKey);
  assert.equal(context.analysisCacheKey('zip', a.sourceKey), 'zip:' + a.sourceKey);
});

test('retained folder handle only matches its own recent record', () => {
  const recordA = { sourceType: 'folder', sourceKey: 'alpha|1|src/app.js' };
  const recordB = { sourceType: 'folder', sourceKey: 'beta|1|src/app.js' };
  assert.equal(context.retainedFolderMatchesRecord(recordA, { sourceKey: recordA.sourceKey }), true);
  assert.equal(context.retainedFolderMatchesRecord(recordB, { sourceKey: recordA.sourceKey }), false);
  assert.equal(context.retainedFolderMatchesRecord(null, { sourceKey: recordA.sourceKey }), true);
});

test('HTML attribute sanitizer encodes quotes before they reach data-sym', () => {
  assert.equal(context.escapeHtmlAttr('say "hi"'), 'say &quot;hi&quot;');
  assert.match(context.escapeHtmlAttr('a"onclick="alert(1)'), /&quot;/);
  assert.doesNotMatch(context.escapeHtmlAttr('a"onclick="alert(1)'), /data-sym="[^"]*"/);
  const out = context.annotateHtmlWithSymbols('shared', [{ name: 'shared', kind: 'fn"onclick="alert(1)' }], null);
  assert.match(out, /class="sym-mark var"/);
  assert.doesNotMatch(out, /onclick=/);
});

test('index.html ships a working Code view, not a stub', () => {
  assert.match(htmlSource, /value:'code'/);
  assert.match(htmlSource, /function renderCodeView\(/);
  assert.match(htmlSource, /className:'code-split'/);
  assert.match(htmlSource, /vizType==='code'/);
  assert.match(htmlSource, /readableLabelScale/);
  assert.match(htmlSource, /listRecentAnalyses/);
  assert.match(htmlSource, /__codeflow\/status/);
  assert.match(htmlSource, /analyzeFromCli\(false,status\)/);
  assert.match(htmlSource, /retainedFolderMatchesRecord/);
  assert.match(htmlSource, /zipArchiveCacheMeta/);
  assert.match(htmlSource, /The folder picker is faster when the API is rate-limited/);
});
