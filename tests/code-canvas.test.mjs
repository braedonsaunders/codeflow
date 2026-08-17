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
  const samePaths = ['src/app.js', 'src/math.js'];
  const a = context.localFolderCacheMeta({ title: 'project', paths: samePaths, selectionId: 'sel-a' });
  const b = context.localFolderCacheMeta({ title: 'project', paths: samePaths, selectionId: 'sel-b' });
  const again = context.localFolderCacheMeta({ title: 'project', paths: samePaths, selectionId: 'sel-a' });
  assert.equal(a.title, 'project');
  assert.notEqual(a.sourceKey, b.sourceKey);
  assert.equal(a.sourceKey, again.sourceKey);
  assert.equal(context.analysisCacheKey('folder', a.sourceKey), 'folder:' + a.sourceKey);
});

test('CLI re-analyze only matches the active watch root', () => {
  const record = { sourceType: 'cli', sourceKey: '/tmp/alpha' };
  assert.equal(context.cliRecordMatchesStatus(record, { ok: true, root: '/tmp/alpha' }), true);
  assert.equal(context.cliRecordMatchesStatus(record, { ok: true, root: '/tmp/beta' }), false);
  assert.equal(context.cliRecordMatchesStatus(record, null), false);
});

test('retained ZIP only matches its own recent record', () => {
  const recordA = { sourceType: 'zip', sourceKey: 'main.zip|100|10|1|src/app.js' };
  const recordB = { sourceType: 'zip', sourceKey: 'main.zip|200|20|1|src/app.js' };
  assert.equal(context.retainedZipMatchesRecord(recordA, { identity: 'main.zip|100|10' }), true);
  assert.equal(context.retainedZipMatchesRecord(recordB, { identity: 'main.zip|100|10' }), false);
  assert.equal(context.retainedZipMatchesRecord(recordA, { sourceKey: recordA.sourceKey }), true);
});

test('GitHub cache keys include the exclude pattern set', () => {
  const none = context.githubCacheSourceKey('owner', 'repo', []);
  const tests = context.githubCacheSourceKey('owner', 'repo', [{ raw: 'tests/**' }]);
  const vendor = context.githubCacheSourceKey('owner', 'repo', ['vendor/**']);
  assert.equal(none, 'owner/repo');
  assert.notEqual(none, tests);
  assert.notEqual(tests, vendor);
  assert.equal(context.cachedAnalysisMatchesExcludes({ sourceKey: tests, data: { excludePatterns: ['tests/**'] } }, [{ raw: 'tests/**' }]), true);
  assert.equal(context.cachedAnalysisMatchesExcludes({ sourceKey: tests, data: { excludePatterns: ['tests/**'] } }, [{ raw: 'vendor/**' }]), false);
  assert.equal(context.analysisCacheKey('github', tests), 'github:' + tests);
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

test('compactAnalysisForCache drops raw source and keeps graph metadata', () => {
  const compact = context.compactAnalysisForCache({
    files: [{
      path: 'src/a.js',
      name: 'a.js',
      language: 'javascript',
      lines: 3,
      size: 40,
      content: 'function hello(){ return 1; }\n',
      functions: [{ name: 'hello', line: 1, code: 'function hello(){ return 1; }' }],
      deadFunctions: [{ name: 'unused', line: 2, code: 'function unused(){}' }],
      securityIssues: [{ type: 'eval', line: 1, code: 'eval(x)' }],
      connections: [{ from: 'hello', to: 'other' }]
    }],
    functions: [{ name: 'hello', file: 'src/a.js', line: 1, code: 'function hello(){ return 1; }' }],
    deadFunctions: [{ name: 'unused', file: 'src/a.js', line: 2, code: 'function unused(){}' }],
    connections: [{ source: 'src/a.js', target: 'src/b.js', fn: 'hello' }],
    issues: [{ title: 'Unused Functions', items: [{ name: 'unused', file: 'src/a.js', line: 2, code: 'function unused(){}' }] }],
    securityIssues: [{ title: 'eval', file: 'src/a.js', code: 'eval(x)' }],
    fnStats: { hello: { name: 'hello', file: 'src/a.js', code: 'function hello(){ return 1; }' } }
  });
  assert.equal(Object.prototype.hasOwnProperty.call(compact.files[0], 'content'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(compact.files[0].functions[0], 'code'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(compact.functions[0], 'code'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(compact.deadFunctions[0], 'code'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(compact.issues[0].items[0], 'code'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(compact.securityIssues[0], 'code'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(compact.fnStats.hello, 'code'), false);
  assert.equal(compact.files[0].path, 'src/a.js');
  assert.equal(compact.files[0].functions[0].name, 'hello');
  assert.equal(compact.files[0].functions[0].line, 1);
  assert.equal(compact.files[0].size, 40);
  assert.deepEqual(J(compact.connections), [{ source: 'src/a.js', target: 'src/b.js', fn: 'hello' }]);
  assert.equal(compact.issues[0].title, 'Unused Functions');
});

test('hydrated sources stay in memory and are not treated as cached source', () => {
  const cached = { files: [{ path: 'src/a.js', name: 'a.js', functions: [{ name: 'hello', line: 1 }] }] };
  assert.equal(context.analysisFileNeedsSource(cached.files[0]), true);
  const merged = context.mergeHydratedFileSources(cached, [{ path: 'src/a.js', content: 'export function hello(){ return 1; }\n' }]);
  assert.equal(merged.files[0].content.includes('hello'), true);
  assert.equal(context.fileSourceDisplayState(cached.files[0], true), 'loading');
  assert.equal(context.fileSourceDisplayState(merged.files[0], true), 'ready');
  assert.equal(context.fileSourceDisplayState({ path: 'big.js', analysisSkipped: 'oversized' }, false), 'skipped');
  assert.equal(context.fileSourceDisplayState({ path: 'src/a.js' }, false), 'unavailable');
});

test('empty source files count as loaded after hydration', () => {
  const cached = { files: [{ path: 'src/empty.js', name: 'empty.js' }] };
  assert.equal(context.fileHasLoadedSource(cached.files[0]), false);
  assert.equal(context.fileSourceDisplayState(cached.files[0], true), 'loading');
  const merged = context.mergeHydratedFileSources(cached, [{ path: 'src/empty.js', content: '' }]);
  assert.equal(merged.files[0].content, '');
  assert.equal(context.fileHasLoadedSource(merged.files[0]), true);
  assert.equal(context.analysisFileNeedsSource(merged.files[0]), false);
  assert.equal(context.fileSourceDisplayState(merged.files[0], true), 'ready');
});

test('code split percent uses the stacked axis', () => {
  const rect = { width: 1000, height: 800, right: 1000, bottom: 800 };
  assert.equal(context.codeSplitPanePercent(rect, { clientX: 400, clientY: 200 }, false), 60);
  assert.equal(context.codeSplitPanePercent(rect, { clientX: 400, clientY: 200 }, true), 72);
  assert.equal(context.codeSplitPanePercent(rect, { clientX: 900, clientY: 600 }, true), 28);
});

test('empty code cards always render from an array of lines', () => {
  assert.deepEqual(J(context.asCodeLines('')), ['']);
  assert.deepEqual(J(context.asCodeLines(null)), ['']);
  assert.deepEqual(J(context.asCodeLines([])), ['']);
  assert.deepEqual(J(context.asCodeLines(['const x = 1;'])), ['const x = 1;']);
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
  assert.match(htmlSource, /retainedZipMatchesRecord/);
  assert.match(htmlSource, /cliRecordMatchesStatus/);
  assert.match(htmlSource, /githubCacheSourceKey/);
  assert.match(htmlSource, /filterAnalyzableLocalFiles\(/);
  assert.match(htmlSource, /asCodeLines\(highlightSyntax/);
  assert.match(htmlSource, /zipArchiveCacheMeta/);
  assert.match(htmlSource, /compactAnalysisForCache/);
  assert.match(htmlSource, /fileHasLoadedSource/);
  assert.match(htmlSource, /codeSplitPanePercent/);
  assert.match(htmlSource, /onPointerDown/);
  assert.match(htmlSource, /__codeflow\/file\?path=/);
  assert.match(htmlSource, /The folder picker is faster when the API is rate-limited/);
});
