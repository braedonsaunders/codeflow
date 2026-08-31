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

test('color blocks replace fine chrome below the CodeCanvas zoom threshold', () => {
  assert.equal(context.COLOR_BLOCK_ZOOM, 0.4);
  assert.equal(context.CODE_FAR_ZOOM, 0.22);
  assert.equal(context.zoomShowsColorBlocks(1), false);
  assert.equal(context.zoomShowsColorBlocks(0.41), false);
  assert.equal(context.zoomShowsColorBlocks(0.4), true);
  assert.equal(context.zoomShowsColorBlocks(0.39), true);
  assert.equal(context.zoomShowsColorBlocks(0.2), true);
  assert.equal(context.graphColorBlockScale(1), 1);
  assert.ok(context.graphColorBlockScale(0.4) >= 1);
  assert.ok(context.graphColorBlockScale(0.2) > context.graphColorBlockScale(0.4));
  assert.equal(context.zoomHidesCodeText(0.4), false);
  assert.equal(context.zoomHidesCodeText(0.22), false);
  assert.equal(context.zoomHidesCodeText(0.21), true);
  assert.equal(context.vizHasZoomColorBlocks('graph'), true);
  assert.equal(context.vizHasZoomColorBlocks('code'), true);
  assert.equal(context.vizHasZoomColorBlocks('graph3d'), false);
  assert.equal(context.vizHasZoomColorBlocks('treemap'), false);
  assert.ok(context.graphColorBlockSize({ fnCount: 0 }) >= 18);
  assert.ok(context.graphColorBlockSize({ fnCount: 20 }) > context.graphColorBlockSize({ fnCount: 0 }));
});

test('zoom-out color blocks avoid red and green diff colors', () => {
  ['fn', 'import', 'export', 'var', 'file', 'class'].forEach((kind) => {
    const fill = context.codeColorBlockKindColor(kind);
    assert.equal(context.colorBlockLooksLikeDiff(fill), false, kind + ' ' + fill);
  });
  ['#00ff9d', '#22c55e', '#84cc16', '#98c379', '#ff5f5f', '#e06c75'].forEach((hex) => {
    assert.equal(context.colorBlockLooksLikeDiff(hex), true, hex);
    assert.equal(context.colorBlockLooksLikeDiff(context.graphColorBlockFill(hex)), false, hex);
  });
  ['#4d9fff', '#a78bfa', '#22d3ee', '#ff9f43', '#61afef'].forEach((hex) => {
    assert.equal(context.graphColorBlockFill(hex).toLowerCase(), hex.toLowerCase());
  });
  const churnHigh = context.graphColorBlockFill('#ff5f5f');
  const churnLow = context.graphColorBlockFill('#22c55e');
  assert.notEqual(churnHigh.toLowerCase(), '#ff5f5f');
  assert.notEqual(churnLow.toLowerCase(), '#22c55e');
  const folderPalette = ['#4d9fff', '#a78bfa', '#22d3ee', '#00ff9d', '#ff9f43', '#ec4899', '#ff5f5f', '#84cc16'];
  const folderFills = folderPalette.map((hex) => context.graphColorBlockFill(hex).toLowerCase());
  assert.equal(new Set(folderFills).size, folderPalette.length);
  folderFills.forEach((hex) => {
    assert.equal(context.colorBlockLooksLikeDiff(hex), false, hex);
  });
  const layerPalette = ['#4d9fff', '#22d3ee', '#a78bfa', '#00ff9d', '#ff9f43', '#ec4899', '#f59e0b', '#c084fc'];
  const layerFills = layerPalette.map((hex) => context.graphColorBlockFill(hex).toLowerCase());
  assert.equal(new Set(layerFills).size, layerPalette.length);
  assert.notEqual(context.graphColorBlockFill('#00ff9d').toLowerCase(), '#22d3ee');
  assert.notEqual(context.graphColorBlockFill('#ff5f5f').toLowerCase(), '#a78bfa');
  assert.notEqual(context.graphColorBlockFill('#84cc16').toLowerCase(), '#ff9f43');
});

test('code color blocks cover functions and leftover file regions', () => {
  const file = {
    path: 'src/app.js',
    name: 'app.js',
    content: 'import { add } from "./math.js";\n\nexport function render(){\n  return add(1, 2);\n}\n\nfunction helper(){\n  return 1;\n}\n',
    functions: [
      { name: 'render', line: 3, isExported: true },
      { name: 'helper', line: 7, isExported: false }
    ]
  };
  const sections = context.codeColorBlockSections(file, [{ source: 'src/math.js', target: 'src/app.js', fn: 'add' }]);
  const names = J(sections).map((s) => s.name);
  assert.ok(names.includes('render'));
  assert.ok(names.includes('helper'));
  assert.ok(names.includes('add') || names.includes('app.js'));
  const render = sections.find((s) => s.name === 'render');
  assert.equal(render.kind, 'export');
  assert.equal(render.startLine, 3);
  assert.ok(render.endLine >= 3);
  assert.ok(render.height >= 6);
  assert.equal(render.color, context.codeColorBlockKindColor('export'));
  const helper = sections.find((s) => s.name === 'helper');
  assert.equal(helper.kind, 'fn');
  assert.ok(helper.top > render.top);
  const empty = context.codeColorBlockSections({ name: 'notes.md', path: 'notes.md', content: '# hi\n' }, []);
  assert.equal(empty.length, 1);
  assert.equal(empty[0].name, 'notes.md');
  assert.equal(empty[0].kind, 'file');
  const wrapCols = context.codeCardWrapColumns();
  const long = 'x'.repeat(800);
  const oneLiner = { name: 'one.js', path: 'one.js', content: long };
  const visualRows = context.codeCardWrappedLineCount(context.codeCardContentMetrics(oneLiner), { wrap: true });
  assert.ok(visualRows > 8);
  assert.equal(context.codeCardVisualLineIndex(oneLiner, 1, { wrap: true }), 1);
  assert.equal(context.codeCardVisualLineEndIndex(oneLiner, 1, { wrap: true }), visualRows);
  const wrappedFile = context.codeColorBlockSections(oneLiner, [], { wrap: true });
  assert.equal(wrappedFile.length, 1);
  assert.equal(wrappedFile[0].height, visualRows * context.CODE_CARD_LINE_HEIGHT);
  assert.ok(wrappedFile[0].height > context.CODE_CARD_LINE_HEIGHT);
  const mid = {
    name: 'mid.js',
    path: 'mid.js',
    content: 'function foo(){\n' + long + '\n}\nfunction bar(){\n  return 1;\n}\n',
    functions: [
      { name: 'foo', line: 1, isExported: false },
      { name: 'bar', line: 4, isExported: false }
    ]
  };
  const midSections = context.codeColorBlockSections(mid, [], { wrap: true });
  const foo = midSections.find((s) => s.name === 'foo');
  const fooEnd = 1 + Math.ceil(800 / wrapCols) + 1;
  assert.equal(foo.endLine, 3);
  assert.equal(context.codeCardVisualLineEndIndex(mid, 3, { wrap: true }), fooEnd);
  assert.equal(foo.height, fooEnd * context.CODE_CARD_LINE_HEIGHT);
});

test('card layout toggles color-block and far-zoom classes at the thresholds', () => {
  function trackingCard(path) {
    const classes = new Set();
    return {
      path,
      classes,
      getAttribute(name) { return name === 'data-code-card' ? path : null; },
      style: {},
      classList: {
        add(name) { classes.add(name); },
        remove(name) { classes.delete(name); }
      },
      querySelector() { return { style: {} }; }
    };
  }
  const near = trackingCard('a.js');
  const mid = trackingCard('b.js');
  const far = trackingCard('c.js');
  const layerFor = (card) => ({ style: {}, querySelectorAll() { return [card]; } });
  const nodes = { 'a.js': { x: 10, y: 10 }, 'b.js': { x: 10, y: 10 }, 'c.js': { x: 10, y: 10 } };
  const sizes = { 'a.js': { width: 100, height: 80 }, 'b.js': { width: 100, height: 80 }, 'c.js': { width: 100, height: 80 } };
  const nearLaid = context.applyCodeCardLayout(layerFor(near), nodes, { k: 1, x: 0, y: 0 }, sizes);
  assert.equal(nearLaid.colorBlocks, false);
  assert.equal(nearLaid.codeFar, false);
  assert.equal(near.classes.has('code-blocks'), false);
  assert.equal(near.classes.has('code-far'), false);
  const midLaid = context.applyCodeCardLayout(layerFor(mid), { 'b.js': { x: 10, y: 10 } }, { k: 0.3, x: 0, y: 0 }, sizes);
  assert.equal(midLaid.colorBlocks, true);
  assert.equal(midLaid.codeFar, false);
  assert.equal(mid.classes.has('code-blocks'), true);
  assert.equal(mid.classes.has('code-far'), false);
  const farLaid = context.applyCodeCardLayout(layerFor(far), { 'c.js': { x: 10, y: 10 } }, { k: 0.1, x: 0, y: 0 }, sizes);
  assert.equal(farLaid.colorBlocks, true);
  assert.equal(farLaid.codeFar, true);
  assert.equal(far.classes.has('code-blocks'), true);
  assert.equal(far.classes.has('code-far'), true);
});

test('open Code cards replace their nodes', () => {
  const cards = new Set(['src/app.js']);
  assert.equal(context.nodeReplacedByCard('src/app.js', cards), true);
  assert.equal(context.nodeReplacedByCard('src/math.js', cards), false);
  assert.equal(context.nodeReplacedByCard('src/app.js', null), false);
});

test('remaining Code nodes are pushed out from under cards', () => {
  const cards = new Set(['src/app.js']);
  const sizes = { 'src/app.js': { width: 400, height: 200 } };
  const nodes = [
    { id: 'src/app.js', x: 100, y: 100 },
    { id: 'src/math.js', x: 110, y: 105 }
  ];
  context.unburyNodesFromCards(nodes, cards, sizes, 20);
  assert.equal(nodes[0].x, 100);
  assert.equal(nodes[0].y, 100);
  const buried = Math.abs(nodes[1].x - 100) < 220 && Math.abs(nodes[1].y - 100) < 120;
  assert.equal(buried, false);
  assert.ok(Math.abs(nodes[1].x - 100) >= 220 || Math.abs(nodes[1].y - 100) >= 120);
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
  const visible = context.collectVisibleCodeFiles('a.js', data, 'src');
  assert.deepEqual(J(visible).map((f) => f.path), ['a.js', 'b.js']);
});

test('visible code files are not capped at four', () => {
  const files = ['a.js', 'b.js', 'c.js', 'd.js', 'e.js', 'f.js'].map((name) => ({
    path: name,
    folder: 'src',
    name,
    content: '',
    functions: []
  }));
  const connections = files.slice(1).map((file) => ({ source: 'a.js', target: file.path, fn: 'a' }));
  const visible = context.collectVisibleCodeFiles('a.js', { files, connections }, 'src');
  assert.deepEqual(J(visible).map((f) => f.path), ['a.js', 'b.js', 'c.js', 'd.js', 'e.js', 'f.js']);
  const seeded = context.collectVisibleCodeFiles(null, { files, connections }, 'src');
  assert.equal(seeded[0].path, 'a.js');
  assert.equal(seeded.length, 6);
});

test('root file count ignores nested files including a lone top-level directory', () => {
  const flat = {
    files: [
      { path: 'a.js', folder: 'root' },
      { path: 'b.js', folder: 'root' },
      { path: 'src/c.js', folder: 'src' }
    ]
  };
  assert.equal(context.codeViewAnalysisRootFolder(flat), 'root');
  assert.equal(context.countCodeViewRootFiles(flat), 2);
  assert.equal(context.isCodeViewRootFile(flat.files[0], 'root'), true);
  assert.equal(context.isCodeViewRootFile(flat.files[2], 'root'), false);
  const wrapped = {
    files: [
      { path: 'repo/a.js', folder: 'repo' },
      { path: 'repo/b.js', folder: 'repo' },
      { path: 'repo/src/c.js', folder: 'repo/src' }
    ]
  };
  assert.equal(context.codeViewAnalysisRootFolder(wrapped), 'root');
  assert.equal(context.countCodeViewRootFiles(wrapped), 0);
  const nested = {
    files: [
      { path: 'src/a.js', folder: 'src' },
      { path: 'lib/b.js', folder: 'lib' }
    ]
  };
  assert.equal(context.codeViewAnalysisRootFolder(nested), 'root');
  assert.equal(context.countCodeViewRootFiles(nested), 0);
  assert.equal(context.countCodeViewRootFiles({ files: [] }), 0);
  const loneTop = {
    files: Array.from({ length: 60 }, (_, i) => ({
      path: 'src/f' + i + '.js',
      folder: 'src',
      name: 'f' + i + '.js'
    }))
  };
  assert.equal(context.codeViewAnalysisRootFolder(loneTop), 'root');
  assert.equal(context.countCodeViewRootFiles(loneTop), 0);
  assert.equal(context.codeViewRootGateActive(loneTop, null, null, [], 50), false);
});

test('Code root gate waits for a folder or file when the root is crowded', () => {
  const files = Array.from({ length: 60 }, (_, i) => ({
    path: i < 50 ? 'f' + i + '.js' : 'src/n' + i + '.js',
    folder: i < 50 ? 'root' : 'src',
    name: i < 50 ? 'f' + i + '.js' : 'n' + i + '.js'
  }));
  const data = { files };
  assert.equal(context.countCodeViewRootFiles(data), 50);
  assert.equal(context.clampCodeViewRootGate(undefined), 50);
  assert.equal(context.clampCodeViewRootGate(40), 50);
  assert.equal(context.clampCodeViewRootGate(70), 75);
  assert.equal(context.codeViewRootGateActive(data, null, null, [], 50), true);
  assert.equal(context.codeViewRootGateActive(data, 'src', null, [], 50), false);
  assert.equal(context.codeViewRootGateActive(data, null, 'f0.js', [], 50), false);
  assert.equal(context.codeViewRootGateActive(data, null, null, ['f0.js'], 50), false);
  assert.equal(context.codeViewRootGateActive(data, null, null, [], 75), false);
  assert.equal(context.codeViewRootGateActive(data, null, null, [], 25), true);
  assert.equal(context.shouldSeedOpenedCodeCards(true, false, [], true), false);
  assert.equal(context.shouldSeedOpenedCodeCards(true, false, [], false), true);
  assert.match(context.codeViewRootGateMessage(50, 50), /Pick a folder or file/);
  const small = { files: files.slice(0, 10) };
  assert.equal(context.codeViewRootGateActive(small, null, null, [], 50), false);
});

test('Code view seeds the filtered folder when the selection is outside it', () => {
  const data = {
    files: [
      { path: 'src/hub.js', folder: 'src', name: 'hub.js', functions: [] },
      { path: 'src/leaf.js', folder: 'src', name: 'leaf.js', functions: [] },
      { path: 'lib/out.js', folder: 'lib', name: 'out.js', functions: [] }
    ],
    connections: [
      { source: 'src/hub.js', target: 'src/leaf.js', fn: 'h' },
      { source: 'lib/out.js', target: 'src/hub.js', fn: 'o' }
    ]
  };
  const visible = context.collectVisibleCodeFiles('lib/out.js', data, 'src');
  assert.equal(visible[0].path, 'src/hub.js');
  assert.ok(visible.every((file) => file.folder === 'src'));
  assert.equal(visible.some((file) => file.path === 'lib/out.js'), false);
});

test('Code view seeds cards without waiting for a click', () => {
  const files = [
    { path: 'leaf.js', folder: 'src', name: 'leaf.js', functions: [] },
    { path: 'hub.js', folder: 'src', name: 'hub.js', functions: [] },
    { path: 'other.js', folder: 'lib', name: 'other.js', functions: [] }
  ];
  const connections = [
    { source: 'hub.js', target: 'leaf.js', fn: 'h' },
    { source: 'hub.js', target: 'other.js', fn: 'h' }
  ];
  const data = { files, connections };
  assert.equal(context.defaultCodeViewSeed(data, 'src'), 'hub.js');
  assert.equal(context.codeViewSeedPath(null, data, 'src'), 'hub.js');
  assert.equal(context.codeViewSeedPath('leaf.js', data, 'src'), 'leaf.js');
  assert.equal(context.codeViewSeedPath('other.js', data, 'src'), 'hub.js');
  const visible = context.collectVisibleCodeFiles(null, data, 'src');
  assert.deepEqual(J(visible).map((f) => f.path), ['hub.js', 'leaf.js']);
  assert.equal(context.defaultCodeViewSeed({ files: [], connections: [] }, null), null);
  assert.equal(context.codeViewSeedPath('leaf.js', { files: [], connections: [] }, null), null);
  assert.equal(context.codeFileNavOpensCard('code'), true);
  assert.equal(context.codeFileNavOpensCard('graph'), false);
  assert.equal(context.codeFileNavOpensCard(null), false);
  assert.equal(context.graphSvgExportEnabled('graph'), true);
  assert.equal(context.graphSvgExportEnabled('graph3d'), true);
  assert.equal(context.graphSvgExportEnabled('code'), false);
});

test('out-of-filter Code nav clears the folder filter so the target card can render', () => {
  const files = [
    { path: 'src/a.js', folder: 'src', name: 'a.js' },
    { path: 'src/b.js', folder: 'src', name: 'b.js' },
    { path: 'lib/out.js', folder: 'lib', name: 'out.js' }
  ];
  const data = { files };
  assert.equal(context.fileMatchesFolderFilter(files[0], 'src'), true);
  assert.equal(context.fileMatchesFolderFilter(files[2], 'src'), false);
  assert.equal(context.pathMatchesFolderFilter('src/a.js', data, 'src'), true);
  assert.equal(context.pathMatchesFolderFilter('lib/out.js', data, 'src'), false);
  assert.equal(context.folderFilterAfterCodeNav('src/a.js', data, 'src'), 'src');
  assert.equal(context.folderFilterAfterCodeNav('lib/out.js', data, 'src'), null);
  assert.equal(context.folderFilterAfterCodeNav('lib/out.js', data, null), null);
  assert.deepEqual(
    J(context.filesForOpenedCodePaths(['src/a.js', 'lib/out.js'], data, 'src')).map((f) => f.path),
    ['src/a.js']
  );
  assert.deepEqual(
    J(context.filesForOpenedCodePaths(['src/a.js', 'lib/out.js'], data, null)).map((f) => f.path),
    ['src/a.js', 'lib/out.js']
  );
});

test('returning to Code opens the current selection without dropping old cards', () => {
  const data = {
    files: [
      { path: 'leaf.js', folder: 'src', name: 'leaf.js', functions: [] },
      { path: 'hub.js', folder: 'src', name: 'hub.js', functions: [] },
      { path: 'other.js', folder: 'src', name: 'other.js', functions: [] }
    ],
    connections: [
      { source: 'hub.js', target: 'leaf.js', fn: 'h' },
      { source: 'hub.js', target: 'other.js', fn: 'h' }
    ]
  };
  assert.equal(context.shouldSeedOpenedCodeCards(false, false, ['hub.js']), false);
  assert.equal(context.shouldSeedOpenedCodeCards(true, false, ['hub.js']), true);
  assert.equal(context.shouldSeedOpenedCodeCards(true, true, ['hub.js']), false);
  assert.equal(context.shouldSeedOpenedCodeCards(true, true, []), true);
  const reenter = context.ensureCodeViewOpenedPaths(['hub.js'], 'leaf.js', data, 'src');
  assert.deepEqual(J(reenter.paths), ['hub.js', 'leaf.js']);
  assert.equal(reenter.seed, 'leaf.js');
  assert.equal(reenter.inserted, true);
  assert.equal(reenter.opened, true);
  const already = context.ensureCodeViewOpenedPaths(['hub.js', 'leaf.js'], 'leaf.js', data, 'src');
  assert.deepEqual(J(already.paths), ['hub.js', 'leaf.js']);
  assert.equal(already.inserted, false);
  assert.equal(already.opened, true);
  const empty = context.ensureCodeViewOpenedPaths([], null, data, 'src');
  assert.deepEqual(J(empty.paths), ['hub.js']);
  assert.equal(empty.seed, 'hub.js');
  const capped = Array.from({ length: context.CODE_CARD_MAX }, (_, i) => 'f' + i + '.js');
  const replaced = context.ensureCodeViewOpenedPaths(capped, 'leaf.js', data, 'src');
  assert.equal(replaced.opened, true);
  assert.equal(replaced.inserted, true);
  assert.equal(replaced.paths.length, context.CODE_CARD_MAX);
  assert.equal(replaced.paths[replaced.paths.length - 1], 'leaf.js');
  assert.equal(replaced.paths.indexOf('f0.js'), -1);
  assert.equal(replaced.paths.indexOf('f1.js'), 0);
});

test('high-degree neighborhoods stay within the card cap', () => {
  const files = Array.from({ length: 30 }, (_, i) => ({
    path: i === 0 ? 'hub.js' : 'n' + i + '.js',
    folder: 'src',
    name: i === 0 ? 'hub.js' : 'n' + i + '.js',
    functions: []
  }));
  files[20].content = 'export const kept = 1;\n';
  const connections = files.slice(1).map((file) => ({ source: 'hub.js', target: file.path, fn: 'hub' }));
  const visible = context.collectVisibleCodeFiles('hub.js', { files, connections }, 'src');
  assert.equal(visible.length, context.CODE_CARD_MAX);
  assert.equal(visible[0].path, 'hub.js');
  assert.ok(visible.some((file) => file.path === 'n20.js'));
  assert.equal(context.countVisibleCodeFiles('hub.js', { files, connections }, 'src'), 30);
  assert.ok(context.countVisibleCodeFiles('hub.js', { files, connections }, 'src') > visible.length);
});

test('a drag does not select the card on the leftover click', () => {
  assert.deepEqual(J(context.noteCodeCardPointerEnd(true)), { select: false, ignoreNextClick: true });
  assert.deepEqual(J(context.noteCodeCardPointerEnd(false)), { select: true, ignoreNextClick: false });
  assert.deepEqual(J(context.consumeCodeCardClick(true)), { ignore: true, ignoreNextClick: false });
  assert.deepEqual(J(context.consumeCodeCardClick(false)), { ignore: false, ignoreNextClick: false });
});

test('card drag activation uses screen pixels, not zoomed graph units', () => {
  const far = context.codeCardDragDelta(101, 100, 100, 100, 0.08, 3);
  assert.equal(far.moved, false);
  assert.ok(Math.abs(far.x) > 3);
  const near = context.codeCardDragDelta(104, 100, 100, 100, 5, 3);
  assert.equal(near.moved, true);
  assert.ok(Math.abs(near.x) < 3);
  const still = context.codeCardDragDelta(100, 100, 100, 100, 1, 3);
  assert.equal(still.moved, false);
  assert.equal(still.x, 0);
});

test('code cards use a uniform width and grow with line count', () => {
  const empty = context.codeCardSize(null);
  assert.equal(empty.width, context.CODE_CARD_WIDTH);
  assert.equal(empty.height, context.CODE_CARD_MIN_HEIGHT);
  assert.equal(empty.clipped, false);
  const short = context.codeCardSize({ content: 'const x = 1;\n' });
  const tall = context.codeCardSize({ content: Array(40).fill('const value = 1;').join('\n') });
  assert.equal(short.width, context.CODE_CARD_WIDTH);
  assert.equal(tall.width, context.CODE_CARD_WIDTH);
  assert.ok(tall.height > short.height);
  const huge = context.codeCardSize({ content: Array(400).fill('x'.repeat(120)).join('\n') });
  assert.equal(huge.width, context.CODE_CARD_WIDTH);
  assert.equal(huge.height, context.CODE_CARD_MAX_HEIGHT);
  assert.equal(huge.clipped, true);
  const wide = context.codeCardSize({ content: 'x'.repeat(200) });
  assert.equal(wide.width, context.CODE_CARD_WIDTH);
  assert.ok(wide.height < context.CODE_CARD_MAX_HEIGHT);
  assert.equal(wide.clipped, true);
  const expanded = context.codeCardSize({ content: Array(400).fill('x'.repeat(120)).join('\n') }, { expand: true });
  assert.ok(expanded.height > context.CODE_CARD_MAX_HEIGHT);
  assert.equal(expanded.expand, true);
  assert.equal(expanded.clipped, true);
  const expandedWrap = context.codeCardSize({ content: Array(400).fill('x'.repeat(120)).join('\n') }, { expand: true, wrap: true });
  assert.ok(expandedWrap.height > context.CODE_CARD_MAX_HEIGHT);
  assert.equal(expandedWrap.clipped, false);
  const wrapped = context.codeCardSize({ content: 'x'.repeat(200) }, { wrap: true });
  assert.equal(wrapped.clipped, false);
  assert.equal(wrapped.wrap, true);
  const manyWide = context.codeCardSize({ content: Array(8).fill('x'.repeat(200)).join('\n') });
  const manyWrapped = context.codeCardSize({ content: Array(8).fill('x'.repeat(200)).join('\n') }, { wrap: true });
  assert.ok(manyWrapped.height > manyWide.height);
  const wrapCols = context.codeCardWrapColumns();
  assert.ok(wrapCols >= 20);
  assert.equal(context.codeCardWrappedLineCount({ lines: 1, lineChars: [200] }, { wrap: true }), Math.ceil(200 / wrapCols));
  assert.equal(context.codeCardVisualLineIndex({ content: 'short\n' + 'x'.repeat(200) }, 2, { wrap: true }), 2);
  const wrappedTwo = { content: 'short\n' + 'x'.repeat(200) };
  assert.equal(context.codeCardVisualLineEndIndex(wrappedTwo, 1, { wrap: true }), 1);
  assert.equal(
    context.codeCardVisualLineEndIndex(wrappedTwo, 2, { wrap: true }),
    1 + Math.ceil(200 / wrapCols)
  );
  assert.equal(context.codeCardVisualLineEndIndex(wrappedTwo, 2, {}), 2);
});

test('opened code paths append without reshuffling the set', () => {
  assert.deepEqual(J(context.openCodeCardPaths(['a.js'], 'b.js')), ['a.js', 'b.js']);
  assert.deepEqual(J(context.openCodeCardPaths(['a.js', 'b.js'], 'a.js')), ['a.js', 'b.js']);
  const capped = Array.from({ length: context.CODE_CARD_MAX }, (_, i) => 'f' + i + '.js');
  assert.deepEqual(J(context.openCodeCardPaths(capped, 'extra.js')), capped);
  const rejected = context.resolveOpenCodeCard(capped, 'extra.js');
  assert.equal(rejected.opened, false);
  assert.equal(rejected.inserted, false);
  assert.deepEqual(J(rejected.paths), capped);
  const already = context.resolveOpenCodeCard(['a.js', 'b.js'], 'a.js');
  assert.equal(already.opened, true);
  assert.equal(already.inserted, false);
  const added = context.resolveOpenCodeCard(['a.js'], 'b.js');
  assert.equal(added.opened, true);
  assert.equal(added.inserted, true);
  assert.deepEqual(J(added.paths), ['a.js', 'b.js']);
  const evicted = context.openCodeCardPaths(capped, 'extra.js', null, true);
  assert.equal(evicted.length, context.CODE_CARD_MAX);
  assert.equal(evicted[0], 'f1.js');
  assert.equal(evicted[evicted.length - 1], 'extra.js');
  const replaced = context.resolveOpenCodeCard(capped, 'extra.js', null, true);
  assert.equal(replaced.opened, true);
  assert.equal(replaced.inserted, true);
  assert.deepEqual(J(replaced.paths), evicted);
});

test('opened code files ignore the current selection', () => {
  const data = {
    files: [
      { path: 'a.js', folder: 'src' },
      { path: 'b.js', folder: 'src' },
      { path: 'c.js', folder: 'lib' }
    ]
  };
  const opened = context.filesForOpenedCodePaths(['a.js', 'c.js'], data, null);
  assert.deepEqual(J(opened).map((f) => f.path), ['a.js', 'c.js']);
  const still = context.filesForOpenedCodePaths(['a.js', 'c.js'], data, null);
  assert.deepEqual(J(still).map((f) => f.path), ['a.js', 'c.js']);
});

test('appending a code card keeps existing cards in place', () => {
  const a = { path: 'src/a.js', folder: 'src' };
  const b = { path: 'src/b.js', folder: 'src' };
  const c = { path: 'lib/c.js', folder: 'lib' };
  const size = { width: 440, height: 200 };
  const opts = { originX: 80, originY: 72, gapX: 88, gapY: 36 };
  let placed = context.appendCodeCardPlacement({}, a, size, opts);
  const first = J(placed['src/a.js']);
  placed = context.appendCodeCardPlacement(placed, b, size, opts);
  assert.deepEqual(J(placed['src/a.js']), first);
  assert.equal(placed['src/b.js'].left, first.left);
  assert.ok(placed['src/b.js'].top >= first.top + first.height);
  const beforeLib = J(placed['src/a.js']);
  const beforeB = J(placed['src/b.js']);
  placed = context.appendCodeCardPlacement(placed, c, size, opts);
  assert.deepEqual(J(placed['src/a.js']), beforeLib);
  assert.deepEqual(J(placed['src/b.js']), beforeB);
  assert.ok(placed['lib/c.js'].left >= beforeLib.left + beforeLib.width);
  assert.equal(placed['lib/c.js'].top, opts.originY);
  const grown = context.appendCodeCardPlacement(placed, a, { width: 440, height: 400 }, opts);
  assert.equal(grown['src/a.js'].left, first.left);
  assert.equal(grown['src/a.js'].top, first.top);
  assert.ok(grown['src/b.js'].top >= grown['src/a.js'].top + grown['src/a.js'].height);
  assert.ok(grown['src/b.js'].top > beforeB.top);
  const pinned = context.appendCodeCardPlacement(placed, a, { width: 440, height: 400 }, Object.assign({ pinnedPaths: { 'src/b.js': true } }, opts));
  assert.equal(pinned['src/b.js'].top, beforeB.top);
});

test('hidden-but-open cards keep their placements across folder filters', () => {
  const placements = {
    'src/a.js': { left: 12, top: 40, x: 232, y: 140, width: 440, height: 200, folder: 'src' },
    'lib/b.js': { left: 540, top: 40, x: 760, y: 140, width: 440, height: 200, folder: 'lib' }
  };
  const keep = context.codeCardPlacementKeepSet(['src/a.js', 'lib/b.js'], [{ path: 'lib/b.js' }]);
  assert.equal(keep['src/a.js'], true);
  assert.equal(keep['lib/b.js'], true);
  const departed = context.pruneCodeCardPlacements(placements, keep);
  assert.equal(departed['src/a.js'], undefined);
  assert.deepEqual(J(placements['src/a.js']).top, 40);
  assert.deepEqual(J(placements['lib/b.js']).left, 540);
  const closed = context.pruneCodeCardPlacements(placements, context.codeCardPlacementKeepSet(['lib/b.js'], [{ path: 'lib/b.js' }]));
  assert.equal(closed['src/a.js'], true);
  assert.equal(placements['src/a.js'], undefined);
  assert.ok(placements['lib/b.js']);
});

test('hydration height growth reflows unpinned cards in the same folder', () => {
  const a = { path: 'src/a.js', folder: 'src' };
  const b = { path: 'src/b.js', folder: 'src' };
  const opts = { originY: 72, gapY: 36 };
  let placed = context.appendCodeCardPlacement({}, a, { width: 440, height: 160 }, opts);
  placed = context.appendCodeCardPlacement(placed, b, { width: 440, height: 160 }, opts);
  const beforeB = placed['src/b.js'].top;
  placed = context.reflowUnpinnedCodeCards(
    context.appendCodeCardPlacement(placed, a, { width: 440, height: 400 }, opts),
    null,
    opts
  );
  assert.equal(placed['src/a.js'].top, 72);
  assert.equal(placed['src/b.js'].top, 72 + 400 + 36);
  assert.ok(placed['src/b.js'].top > beforeB);
});

test('source reads skip paths that are already in flight', () => {
  assert.deepEqual(J(context.nextCodeSourceReads(['a.js', 'b.js', 'a.js'], { 'a.js': true })), ['b.js']);
  assert.deepEqual(J(context.nextCodeSourceReads(['a.js'], { 'a.js': true })), []);
});

test('failed source reads leave a retryable state instead of loading forever', () => {
  const file = { path: 'src/a.js', name: 'a.js' };
  assert.equal(context.fileSourceDisplayState(file, true), 'loading');
  const failed = context.recordCodeSourceFailure(null, 'src/a.js');
  assert.equal(context.fileSourceDisplayState(file, true, failed), 'failed');
  assert.equal(context.fileSourceDisplayState(file, false, failed), 'unavailable');
  assert.deepEqual(J(context.nextCodeSourceReads(['src/a.js', 'src/b.js'], {}, failed)), ['src/b.js']);
  const cleared = context.clearCodeSourceFailure(failed, 'src/a.js');
  assert.equal(context.fileSourceDisplayState(file, true, cleared), 'loading');
  assert.deepEqual(J(context.nextCodeSourceReads(['src/a.js'], {}, cleared)), ['src/a.js']);
});

test('filtered-out cards do not consume the open-card cap', () => {
  const files = Array.from({ length: context.CODE_CARD_MAX }, (_, i) => ({
    path: 'src/f' + i + '.js',
    folder: 'src',
    name: 'f' + i + '.js'
  }));
  files.push({ path: 'lib/new.js', folder: 'lib', name: 'new.js' });
  files.push({ path: 'src/extra.js', folder: 'src', name: 'extra.js' });
  const data = { files };
  const capped = files.slice(0, context.CODE_CARD_MAX).map((file) => file.path);
  const hidden = context.hiddenOpenedCodePaths(capped, data, 'lib');
  assert.equal(Object.keys(hidden).length, context.CODE_CARD_MAX);
  const opened = context.resolveOpenCodeCard(capped, 'lib/new.js', null, false, hidden);
  assert.equal(opened.opened, true);
  assert.equal(opened.inserted, true);
  assert.equal(opened.paths.length, context.CODE_CARD_MAX);
  assert.equal(opened.paths[opened.paths.length - 1], 'lib/new.js');
  assert.equal(opened.paths.indexOf('src/f0.js'), -1);
  const visibleHidden = context.hiddenOpenedCodePaths(capped, data, 'src');
  assert.equal(Object.keys(visibleHidden).length, 0);
  const refused = context.resolveOpenCodeCard(capped, 'src/extra.js', null, false, visibleHidden);
  assert.equal(refused.opened, false);
  assert.deepEqual(J(refused.paths), capped);
});

test('out-of-filter Code nav at the card cap replaces so the target opens', () => {
  const files = Array.from({ length: context.CODE_CARD_MAX }, (_, i) => ({
    path: 'src/f' + i + '.js',
    folder: 'src',
    name: 'f' + i + '.js'
  }));
  files.push({ path: 'lib/new.js', folder: 'lib', name: 'new.js' });
  const data = { files };
  const capped = files.slice(0, context.CODE_CARD_MAX).map((file) => file.path);
  const nextFilter = context.folderFilterAfterCodeNav('lib/new.js', data, 'src');
  assert.equal(nextFilter, null);
  const keptHidden = context.hiddenOpenedCodePaths(capped, data, 'src');
  const refused = context.resolveOpenCodeCard(capped, 'lib/new.js', null, false, keptHidden);
  assert.equal(refused.opened, false);
  const hidden = context.hiddenOpenedCodePaths(capped, data, nextFilter);
  const opened = context.resolveOpenCodeCard(capped, 'lib/new.js', null, true, hidden);
  assert.equal(opened.opened, true);
  assert.equal(opened.inserted, true);
  assert.equal(opened.paths[opened.paths.length - 1], 'lib/new.js');
  assert.equal(
    context.filesForOpenedCodePaths(opened.paths, data, nextFilter).some((file) => file.path === 'lib/new.js'),
    true
  );
});

test('wheel pan deltas stay screen-pixel based across zoom', () => {
  assert.deepEqual(J(context.codeViewWheelPanDelta(40, 80, 1)), { x: -40, y: -80 });
  assert.deepEqual(J(context.codeViewWheelPanDelta(40, 80, 2)), { x: -20, y: -40 });
  assert.deepEqual(J(context.codeViewWheelPanDelta(40, 80, 0.5)), { x: -80, y: -160 });
  assert.equal(context.codeViewWheelAction({}), 'pan');
});

test('line-level code edges use bezier anchors, not card centers', () => {
  const file = {
    path: 'src/a.js',
    content: 'export function shared(){}\n',
    functions: [{ name: 'shared', line: 1, isExported: true }]
  };
  assert.equal(context.codeCardSymbolLine(file, 'shared'), 1);
  const d = context.codeEdgeBezier(0, 10, 200, 40);
  assert.equal(d, 'M0,10C90,10 110,40 200,40');
  const reverse = context.codeEdgeBezier(200, 10, 0, 40);
  assert.equal(reverse, 'M200,10C110,10 90,40 0,40');
  const src = { id: 'src/a.js', x: 220, y: 200 };
  const tgt = { id: 'src/b.js', x: 800, y: 240 };
  const sizes = {
    'src/a.js': { width: 440, height: 200 },
    'src/b.js': { width: 440, height: 200 }
  };
  const files = {
    'src/a.js': file,
    'src/b.js': { path: 'src/b.js', content: 'import { shared } from "./a.js";\n', functions: [] }
  };
  const cards = new Set(['src/a.js', 'src/b.js']);
  const path = context.codeCardLinkPath({ source: src, target: tgt, fn: 'shared' }, sizes, files, cards);
  assert.match(path, /^M/);
  assert.ok(!path.includes(String(src.x) + ',' + String(src.y)));
  const leftover = { id: 'src/c.js', x: 1100, y: 260 };
  const fromCard = context.codeCardLinkPath({ source: src, target: leftover, fn: 'shared' }, sizes, files, new Set(['src/a.js']));
  assert.match(fromCard, /^M440,/);
  assert.match(fromCard, / 1100,260$/);
  assert.ok(!fromCard.includes('220,200'));
  const toCard = context.codeCardLinkPath({ source: leftover, target: tgt, fn: 'shared' }, sizes, files, new Set(['src/b.js']));
  assert.match(toCard, /^M1100,260C/);
  assert.ok(!toCard.includes('800,240'));
  assert.equal(context.codeCardLinkPath({ source: src, target: leftover, fn: 'shared' }, sizes, files, new Set()), null);
  assert.equal(context.codeViewWheelAction({ ctrlKey: true }), 'zoom');
  assert.equal(context.codeViewWheelAction({}), 'pan');
});

test('same-folder stacked cards route links through top and bottom edges', () => {
  const upper = { id: 'src/a.js', x: 300, y: 200 };
  const lower = { id: 'src/b.js', x: 300, y: 500 };
  const sizes = {
    'src/a.js': { width: 440, height: 200 },
    'src/b.js': { width: 440, height: 200 }
  };
  const files = {
    'src/a.js': { path: 'src/a.js', content: 'export function shared(){}\n', functions: [{ name: 'shared', line: 1 }] },
    'src/b.js': { path: 'src/b.js', content: 'import { shared } from "./a.js";\n', functions: [] }
  };
  const cards = new Set(['src/a.js', 'src/b.js']);
  assert.equal(context.codeLinkPrefersVertical(upper, lower), true);
  assert.equal(context.codeLinkPrefersVertical({ x: 220, y: 200 }, { x: 800, y: 240 }), false);
  const stacked = context.codeEdgeBezier(300, 300, 300, 400);
  assert.equal(stacked, 'M300,300C300,380 300,320 300,400');
  const path = context.codeCardLinkPath({ source: upper, target: lower, fn: 'shared' }, sizes, files, cards);
  assert.equal(path, 'M300,300C300,380 300,320 300,400');
  const reverse = context.codeCardLinkPath({ source: lower, target: upper, fn: 'shared' }, sizes, files, cards);
  assert.equal(reverse, 'M300,400C300,320 300,380 300,300');
  assert.ok(!path.includes('520,'));
  assert.ok(!reverse.includes('80,'));
});

test('opened code cards auto-align by directory', () => {
  const files = [
    { path: 'src/a.js', folder: 'src' },
    { path: 'src/b.js', folder: 'src' },
    { path: 'lib/c.js', folder: 'lib' }
  ];
  const sizes = {
    'src/a.js': { width: 320, height: 200 },
    'src/b.js': { width: 320, height: 200 },
    'lib/c.js': { width: 320, height: 200 }
  };
  const layout = context.layoutCodeCardsByFolder(files, sizes, { originX: 0, originY: 0, gapX: 40, groupGapX: 80 });
  assert.ok(layout['src/a.js']);
  assert.ok(layout['src/b.js']);
  assert.ok(layout['lib/c.js']);
  assert.equal(layout['src/a.js'].folder, 'src');
  assert.equal(layout['lib/c.js'].folder, 'lib');
  assert.ok(Math.abs(layout['src/a.js'].x - layout['src/b.js'].x) >= 320 || Math.abs(layout['src/a.js'].y - layout['src/b.js'].y) >= 200);
  assert.ok(layout['lib/c.js'].x !== layout['src/a.js'].x);
  const bounds = context.codeFolderCardBounds([
    { id: 'src/a.js', x: layout['src/a.js'].x, y: layout['src/a.js'].y },
    { id: 'src/b.js', x: layout['src/b.js'].x, y: layout['src/b.js'].y }
  ], sizes, 10);
  assert.ok(bounds.width >= 320);
  assert.ok(bounds.height >= 200);
  const before = context.codeFolderCardBounds([{ id: 'src/a.js', x: 220, y: 100 }], sizes, 10);
  const after = context.codeFolderCardBounds([{ id: 'src/a.js', x: 800, y: 400 }], sizes, 10);
  assert.ok(after.x > before.x);
  assert.ok(after.y > before.y);
  const stale = context.codeFolderCardBounds([{ id: 'src/a.js', x: 220, y: 100, fx: 800, fy: 400 }], sizes, 10);
  assert.ok(Math.abs(stale.x - after.x) < 1);
  assert.ok(Math.abs(stale.y - after.y) < 1);
  const xy = context.liveGraphNodeXY({ x: 10, y: 20, fx: 90, fy: 40 });
  assert.equal(xy.x, 90);
  assert.equal(xy.y, 40);
  const layer = {
    querySelectorAll: () => [{
      getAttribute: () => 'src/a.js',
      style: { left: '580px', top: '240px', width: '320px', height: '200px' }
    }]
  };
  const boxes = context.readCodeCardWorldBoxes(layer);
  assert.equal(boxes['src/a.js'].x, 580);
  const fromBox = context.codeFolderCardBounds([{ id: 'src/a.js', x: 0, y: 0 }], sizes, 10, boxes);
  assert.ok(fromBox.x > 500);
  const nearUnion = context.codeFolderHullBounds(
    [{ id: 'src/a.js', x: 800, y: 400 }],
    [{ id: 'src/near.js', x: 820, y: 390 }],
    sizes,
    10
  );
  assert.ok(nearUnion.width > 320);
  const farUnion = context.codeFolderHullBounds(
    [{ id: 'src/a.js', x: 800, y: 400 }],
    [{ id: 'src/old.js', x: 220, y: 100 }],
    sizes,
    10
  );
  assert.ok(farUnion.x > 400);
  const dragged = context.codeFolderHullBounds([{ id: 'src/a.js', x: 1400, y: 900 }], [], sizes, 10);
  assert.ok(dragged.x > farUnion.x);
  assert.ok(dragged.y > farUnion.y);
  const hullsBefore = context.codeFolderHullsByFolder({
    src: { cards: [{ id: 'src/a.js', x: 800, y: 400 }], leftover: [] },
    lib: { cards: [{ id: 'lib/c.js', x: 200, y: 100 }], leftover: [] }
  }, sizes, 10);
  const hullsAfter = context.codeFolderHullsByFolder({
    src: { cards: [{ id: 'src/a.js', x: 1400, y: 900 }], leftover: [] },
    lib: { cards: [{ id: 'lib/c.js', x: 200, y: 100 }], leftover: [] }
  }, sizes, 10);
  assert.ok(hullsAfter.src.x > hullsBefore.src.x);
  assert.equal(hullsAfter.lib.x, hullsBefore.lib.x);
  assert.equal(hullsAfter.lib.y, hullsBefore.lib.y);
});

test('Code folder centers space hulls like Graph and park leftover nodes', () => {
  const centers = context.graphFolderCenters(['src', 'lib', 'test', 'docs'], 800, 600, { minCellW: 660, minCellH: 360 });
  assert.ok(centers.src);
  assert.ok(centers.lib);
  assert.ok(Math.abs(centers.src.x - centers.lib.x) >= 200 || Math.abs(centers.src.y - centers.lib.y) >= 200);
  const nodes = [
    { id: 'src/a.js', folder: 'src', x: 10, y: 10 },
    { id: 'lib/b.js', folder: 'lib', x: 10, y: 10 }
  ];
  context.parkLeftoverCodeNodes(nodes, new Set(), centers);
  assert.equal(nodes[0].x, centers.src.x);
  assert.equal(nodes[1].x, centers.lib.x);
  const pinned = { id: 'src/c.js', folder: 'src', x: 12, y: 14, fx: 12, fy: 14 };
  context.parkLeftoverCodeNodes([pinned], new Set(), centers);
  assert.equal(pinned.x, 12);
});

test('leftover Code nodes in one folder spread instead of stacking', () => {
  const grid = context.leftoverCodeNodeGrid(4, 56);
  assert.equal(grid.length, 4);
  assert.equal(grid[0].x, grid[1].x - 56);
  const seen = new Set(grid.map((p) => p.x + ',' + p.y));
  assert.equal(seen.size, 4);
  const centers = { src: { x: 400, y: 300 } };
  const nodes = [
    { id: 'src/a.js', folder: 'src', x: 10, y: 10 },
    { id: 'src/b.js', folder: 'src', x: 10, y: 10 },
    { id: 'src/c.js', folder: 'src', x: 10, y: 10 }
  ];
  context.parkLeftoverCodeNodes(nodes, new Set(), centers);
  const spots = new Set(nodes.map((n) => n.x + ',' + n.y));
  assert.equal(spots.size, 3);
  assert.ok(nodes.every((n) => Math.abs(n.x - 400) < 80 && Math.abs(n.y - 300) < 80));
  assert.equal(nodes[0].fx, nodes[0].x);
});

test('same-folder leftover siblings translate together', () => {
  const nodes = [
    { id: 'src/a.js', folder: 'src', x: 100, y: 80, fx: 100, fy: 80 },
    { id: 'src/b.js', folder: 'src', x: 160, y: 80, fx: 160, fy: 80 },
    { id: 'lib/c.js', folder: 'lib', x: 400, y: 80, fx: 400, fy: 80 },
    { id: 'src/card.js', folder: 'src', x: 200, y: 200, fx: 200, fy: 200 }
  ];
  const cards = new Set(['src/card.js']);
  const siblings = context.translateCodeViewSiblings(nodes, nodes[0], 40, -10, cards);
  assert.equal(siblings.length, 1);
  assert.equal(siblings[0].id, 'src/b.js');
  assert.equal(nodes[1].x, 200);
  assert.equal(nodes[1].y, 70);
  assert.equal(nodes[2].x, 400);
  assert.equal(nodes[3].x, 200);
});

test('last-dragged Code card wins the stack order', () => {
  assert.deepEqual(J(context.raiseCodeCardStack(['a.js', 'b.js'], 'a.js')), ['b.js', 'a.js']);
  assert.equal(context.codeCardZIndex(['b.js', 'a.js'], 'a.js'), 3);
  assert.equal(context.codeCardZIndex(['b.js', 'a.js'], 'b.js'), 2);
  assert.equal(context.codeCardZIndex(['b.js', 'a.js'], 'missing.js'), 1);
  const a = { getAttribute: () => 'a.js', style: {} };
  const b = { getAttribute: () => 'b.js', style: {} };
  const layer = { querySelectorAll: () => [a, b] };
  assert.equal(context.applyCodeCardStackOrder(layer, ['b.js', 'a.js']), 2);
  assert.equal(a.style.zIndex, '3');
  assert.equal(b.style.zIndex, '2');
});

test('dropped Code cards bump off other cards and leftover hulls move aside', () => {
  const sizes = {
    'src/a.js': { width: 200, height: 120 },
    'src/b.js': { width: 200, height: 120 }
  };
  const cards = new Set(['src/a.js', 'src/b.js']);
  const stacked = [
    { id: 'src/a.js', folder: 'src', x: 100, y: 80, fx: 100, fy: 80 },
    { id: 'src/b.js', folder: 'src', x: 110, y: 85, fx: 110, fy: 85 }
  ];
  context.bumpOverlappingCodeCards(stacked, 'src/b.js', cards, sizes, 20);
  const aBox = context.nodeWorldBox(stacked[0], sizes['src/a.js']);
  const bBox = context.nodeWorldBox(stacked[1], sizes['src/b.js']);
  assert.equal(context.boxesOverlap(aBox, bBox, 20), false);

  const buried = [
    { id: 'src/card.js', folder: 'src', x: 200, y: 200, fx: 200, fy: 200 },
    { id: 'src/left.js', folder: 'src', x: 200, y: 200, fx: 200, fy: 200 },
    { id: 'src/also.js', folder: 'src', x: 220, y: 200, fx: 220, fy: 200 }
  ];
  const cardPaths = new Set(['src/card.js']);
  const cardSizes = { 'src/card.js': { width: 200, height: 140 } };
  context.settleCodeViewAfterDrag(buried, cardPaths, cardSizes, 'src/card.js');
  const cardBox = context.cardWorldBox(buried[0], cardSizes);
  buried.slice(1).forEach((node) => {
    const leftover = { x: node.x - 16, y: node.y - 16, width: 32, height: 32 };
    assert.equal(context.boxesOverlap(cardBox, leftover, 20), false);
  });
  assert.ok(Math.abs(buried[1].x - buried[2].x) >= 20 || Math.abs(buried[1].y - buried[2].y) >= 20);

  const tall = [
    { id: 'src/big.js', folder: 'src', x: 200, y: 400, fx: 200, fy: 400 },
    { id: 'src/under.js', folder: 'src', x: 200, y: 900, fx: 200, fy: 900 }
  ];
  const tallSizes = { 'src/big.js': { width: 200, height: 1200 } };
  const tallCards = new Set(['src/big.js']);
  context.settleCodeViewAfterDrag(tall, tallCards, tallSizes, 'src/big.js');
  const tallBox = context.cardWorldBox(tall[0], tallSizes);
  const under = { x: tall[1].x - 16, y: tall[1].y - 16, width: 32, height: 32 };
  assert.equal(context.boxesOverlap(tallBox, under, 20), false);
  assert.ok(context.leftoverHullObstacles(tall, tallCards).length >= 1);
});

test('cardWorldBox keeps snapshot size but follows a live node after bump', () => {
  const node = { id: 'src/b.js', x: 321, y: 50, fx: 321, fy: 50 };
  const sizes = { 'src/b.js': { width: 180, height: 90 } };
  const stale = { 'src/b.js': { x: 120, y: 0, width: 200, height: 100 } };
  const live = context.cardWorldBox(node, sizes, stale);
  assert.deepEqual(J(live), { x: 221, y: 0, width: 200, height: 100 });
  const same = context.cardWorldBox(node, sizes, {
    'src/b.js': { x: 221, y: 0, width: 200, height: 100 }
  });
  assert.deepEqual(J(same), { x: 221, y: 0, width: 200, height: 100 });
});

test('settleCodeViewAfterDrag uses bumped card coords when boxesByPath is stale', () => {
  const sizes = {
    'src/a.js': { width: 200, height: 100 },
    'src/b.js': { width: 200, height: 100 }
  };
  const cards = new Set(['src/a.js', 'src/b.js']);
  const cardA = { id: 'src/a.js', folder: 'src', x: 100, y: 50, fx: 100, fy: 50 };
  const cardB = { id: 'src/b.js', folder: 'src', x: 220, y: 50, fx: 220, fy: 50 };
  const leftover = { id: 'lib/c.js', folder: 'lib', x: 450, y: 50, fx: 450, fy: 50 };
  const staleBoxes = {
    'src/a.js': { x: 0, y: 0, width: 200, height: 100 },
    'src/b.js': { x: 120, y: 0, width: 200, height: 100 }
  };
  const leftoverStartBox = { x: leftover.x - 22, y: leftover.y - 22, width: 44, height: 44 };
  assert.equal(context.boxesOverlap(staleBoxes['src/b.js'], leftoverStartBox, 40), false);
  const beforeB = { x: cardB.x, y: cardB.y };
  context.settleCodeViewAfterDrag([cardA, cardB, leftover], cards, sizes, 'src/b.js', {
    boxesByPath: staleBoxes,
    cardGap: 20,
    hullPad: 40,
    nodePad: 48
  });
  assert.notDeepEqual({ x: cardB.x, y: cardB.y }, beforeB);
  const bumpedBox = context.nodeWorldBox(cardB, sizes['src/b.js']);
  const leftoverBox = { x: leftover.x - 22, y: leftover.y - 22, width: 44, height: 44 };
  assert.equal(context.boxesOverlap(bumpedBox, leftoverBox, 0), false);
});

test('leftoverSpatialCellKey buckets leftover centers into coarse cells', () => {
  assert.equal(context.leftoverSpatialCellKey(10, 10, 40), '0\t0');
  assert.equal(context.leftoverSpatialCellKey(39.9, 0, 40), '0\t0');
  assert.equal(context.leftoverSpatialCellKey(40, 0, 40), '1\t0');
  assert.equal(context.leftoverSpatialCellKey(-1, -1, 40), '-1\t-1');
});

test('leftoverSeparationBuckets groups leftover nodes by spatial cell', () => {
  const leftovers = [
    { id: 'a', x: 5, y: 5 },
    { id: 'b', x: 8, y: 6 },
    { id: 'c', x: 80, y: 5 }
  ];
  const buckets = context.leftoverSeparationBuckets(leftovers, 40);
  assert.deepEqual(J(buckets['0\t0']), [0, 1]);
  assert.deepEqual(J(buckets['2\t0']), [2]);
});

test('leftoverSeparationNeighbors pushes only overlapping leftover pairs', () => {
  const a = { id: 'src/a.js', x: 100, y: 80, fx: 100, fy: 80 };
  const b = { id: 'src/b.js', x: 102, y: 80, fx: 102, fy: 80 };
  const far = { id: 'lib/far.js', x: 800, y: 80, fx: 800, fy: 80 };
  assert.equal(context.leftoverSeparationNeighbors(a, b, 36), true);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 36);
  assert.equal(context.leftoverSeparationNeighbors(a, far, 36), false);
  assert.equal(far.x, 800);
});

test('separateLeftoverCodeNodes still separates nearby leftovers after spatial bucketing', () => {
  const a = { id: 'src/a.js', folder: 'src', x: 100, y: 80, fx: 100, fy: 80 };
  const b = { id: 'src/b.js', folder: 'src', x: 102, y: 80, fx: 102, fy: 80 };
  const far = { id: 'lib/far.js', folder: 'lib', x: 800, y: 80, fx: 800, fy: 80 };
  context.separateLeftoverCodeNodes([a, b, far], new Set(), 36);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 36);
  assert.equal(far.x, 800);
  assert.equal(far.y, 80);
});

test('separateLeftoverCodeNodes leaves a sparse leftover field in place', () => {
  const leftovers = [];
  for (let col = 0; col < 8; col += 1) {
    leftovers.push({ id: `src/n${col}.js`, folder: 'src', x: col * 200, y: 40, fx: col * 200, fy: 40 });
  }
  const before = leftovers.map((node) => ({ x: node.x, y: node.y }));
  context.separateLeftoverCodeNodes(leftovers, new Set(), 36);
  leftovers.forEach((node, index) => {
    assert.equal(node.x, before[index].x);
    assert.equal(node.y, before[index].y);
  });
});

test('expensive Code layout waits until drag release', () => {
  assert.equal(context.codeViewDragRefresh('move'), false);
  assert.equal(context.codeViewDragRefresh('release'), true);
  assert.equal(context.codeViewDragRefresh('start'), false);
  const card = {
    getAttribute: () => 'src/a.js',
    style: { left: '0px', top: '0px' }
  };
  const layer = { querySelectorAll: () => [card] };
  assert.equal(context.applyCodeCardDragFrame(layer, 'src/a.js', { x: 400, y: 300 }, { width: 200, height: 100 }), true);
  assert.equal(card.style.left, '300px');
  assert.equal(card.style.top, '250px');
});

test('Code cards can be resized from the right or bottom edge', () => {
  const base = context.codeCardSize({ content: 'const x = 1;\n' });
  const grown = context.applyCodeCardUserSize(base, { width: 620, height: 280 });
  assert.equal(grown.width, 620);
  assert.equal(grown.height, 280);
  const clamped = context.clampCodeCardResize(80, 40, {});
  assert.equal(clamped.width, context.CODE_CARD_MIN_WIDTH);
  assert.equal(clamped.height, context.CODE_CARD_MIN_HEIGHT);
  const delta = context.codeCardResizeDelta(140, 160, 100, 100, 440, 200, 1, 'se');
  assert.equal(delta.width, 480);
  assert.equal(delta.height, 260);
  const east = context.codeCardResizeDelta(140, 160, 100, 100, 440, 200, 1, 'e');
  assert.equal(east.width, 480);
  assert.equal(east.height, 200);
});

test('Code camera fits only when it has not been armed yet', () => {
  assert.equal(context.shouldFitCodeCamera(false, 'code'), true);
  assert.equal(context.shouldFitCodeCamera(true, 'code'), false);
  assert.equal(context.shouldFitCodeCamera(false, 'graph'), false);
  assert.equal(context.clampCodeViewFitScale(0.05), context.CODE_VIEW_MIN_FIT_SCALE);
  assert.equal(context.clampCodeViewFitScale(8), context.CODE_VIEW_MAX_FIT_SCALE);
  assert.equal(context.clampCodeViewFitScale(0.7), 0.7);
});

test('hydrating file contents does not change the graph structure key', () => {
  const before = {
    files: [{ path: 'a.js' }, { path: 'b.js' }],
    connections: [{ source: 'a.js', target: 'b.js' }]
  };
  const after = {
    files: [{ path: 'a.js', content: 'export function a(){}' }, { path: 'b.js', content: 'import { a } from "./a.js"' }],
    connections: [{ source: 'a.js', target: 'b.js' }]
  };
  assert.equal(context.graphStructureKey(before, null), context.graphStructureKey(after, null));
  assert.notEqual(context.graphStructureKey(before, null), context.graphStructureKey(before, 'src'));
  const swapped = {
    files: [{ path: 'a.js' }, { path: 'b.js' }],
    connections: [{ source: 'b.js', target: 'a.js' }]
  };
  const heavier = {
    files: [{ path: 'a.js' }, { path: 'b.js' }],
    connections: [{ source: 'a.js', target: 'b.js', count: 4 }]
  };
  assert.notEqual(context.graphStructureKey(before, null), context.graphStructureKey(swapped, null));
  assert.notEqual(context.graphStructureKey(before, null), context.graphStructureKey(heavier, null));
  assert.equal(
    context.codeViewSceneKey(before, null, 'code'),
    context.codeViewSceneKey(after, null, 'code')
  );
  assert.notEqual(
    context.codeViewSceneKey(before, null, 'code'),
    context.codeViewSceneKey(swapped, null, 'code')
  );
  assert.notEqual(
    context.codeViewSceneKey(before, null, 'code', { sourceType: 'github', sourceKey: 'owner/alpha' }),
    context.codeViewSceneKey(before, null, 'code', { sourceType: 'github', sourceKey: 'owner/beta' })
  );
  assert.notEqual(
    context.analysisHydrationId({ sourceType: 'github', sourceKey: 'owner/alpha' }, before, null),
    context.analysisHydrationId({ sourceType: 'github', sourceKey: 'owner/beta' }, before, null)
  );
  const source = { sourceType: 'github', sourceKey: 'owner/repo' };
  assert.equal(context.analysisHydrationId(source, before, null), context.analysisHydrationId(source, before, 'src'));
  assert.equal(context.analysisGraphKey(before), context.analysisGraphKey(after));
  assert.notEqual(
    context.codeViewSceneKey(before, null, 'code', source),
    context.codeViewSceneKey(before, 'src', 'code', source)
  );
  const moved = {
    files: [{ path: 'a.js', folder: 'src', layer: 'utils', churn: 0, functions: [] }, { path: 'b.js' }],
    connections: [{ source: 'a.js', target: 'b.js' }]
  };
  const restyled = {
    files: [{ path: 'a.js', folder: 'lib', layer: 'ui', churn: 3, functions: [{ name: 'a' }] }, { path: 'b.js' }],
    connections: [{ source: 'a.js', target: 'b.js' }]
  };
  assert.notEqual(context.graphStructureKey(moved, null), context.graphStructureKey(restyled, null));
  assert.equal(
    context.fileGraphIdentity({ path: 'a.js', content: 'x', folder: 'src', layer: 'utils', functions: [] }),
    context.fileGraphIdentity({ path: 'a.js', content: 'y', folder: 'src', layer: 'utils', functions: [] })
  );
});

test('preserved graph nodes keep the user camera positions', () => {
  const nodes = [{ id: 'a.js', x: 0, y: 0 }, { id: 'b.js', x: 1, y: 1 }];
  context.preserveGraphNodeState(nodes, { 'a.js': { x: 40, y: 80, fx: 40, fy: 80 } });
  assert.equal(nodes[0].x, 40);
  assert.equal(nodes[0].fx, 40);
  assert.equal(nodes[1].x, 1);
});

test('code cards sit on the canvas transform, not a split pane', () => {
  assert.ok(context.codeCardCollisionRadius({ width: 320, height: 220 }) > 100);
  assert.equal(context.codeCanvasTransformStyle({ k: 0.5, x: 10, y: 20 }), 'translate(10px,20px) scale(0.5)');
  assert.deepEqual(J(context.codeCardAnchorStyle({ x: 400, y: 300 }, { width: 320, height: 220 })), {
    visibility: 'visible',
    left: '240px',
    top: '190px'
  });
  const title = { style: {} };
  const card = {
    getAttribute(name) { return name === 'data-code-card' ? 'a.js' : null; },
    style: {},
    classList: { add() {}, remove() {} },
    querySelector() { return title; }
  };
  const layer = {
    style: {},
    querySelectorAll() { return [card]; }
  };
  const sizes = { 'a.js': { width: 380, height: 280 } };
  const placed = context.applyCodeCardLayout(layer, { 'a.js': { x: 400, y: 300 } }, { k: 0.5, x: 12, y: 8 }, sizes);
  assert.equal(placed.placed, 1);
  assert.equal(placed.titleScale, 2);
  assert.equal(layer.style.transform, 'translate(12px,8px) scale(0.5)');
  assert.equal(card.style.left, '210px');
  assert.equal(title.style.transform, 'scale(2)');
});

test('recent delete requires a second confirm click', () => {
  assert.deepEqual(J(context.armRecentDelete(null, 'github:owner/repo')), { confirm: false, armedId: 'github:owner/repo' });
  assert.deepEqual(J(context.armRecentDelete('github:owner/repo', 'github:owner/repo')), { confirm: true, armedId: null });
  assert.deepEqual(J(context.armRecentDelete('github:owner/repo', 'zip:other')), { confirm: false, armedId: 'zip:other' });
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

test('loaded GitHub identity uses applied exclusions, not pending edits', () => {
  const loaded = { files: [{ path: 'src/a.js', name: 'a.js' }], connections: [], excludePatterns: ['tests/**'] };
  const pending = ['vendor/**'];
  const fromLoaded = context.githubSourceKeyForLoadedAnalysis('owner', 'repo', loaded, pending);
  const fromPending = context.githubSourceKeyForLoadedAnalysis('owner', 'repo', null, pending);
  const appliedKey = context.githubCacheSourceKey('owner', 'repo', ['tests/**']);
  const pendingKey = context.githubCacheSourceKey('owner', 'repo', pending);
  assert.equal(fromLoaded, appliedKey);
  assert.notEqual(fromLoaded, pendingKey);
  assert.equal(fromPending, pendingKey);
  assert.equal(
    context.githubSourceKeyForLoadedAnalysis('owner', 'repo', { excludePatterns: [] }, pending),
    context.githubCacheSourceKey('owner', 'repo', [])
  );
  const graph = context.analysisGraphKey(loaded);
  const before = context.loadedAnalysisSourceIdentity({
    githubOwner: 'owner',
    githubRepo: 'repo',
    githubKey: fromLoaded
  });
  const afterEdit = context.loadedAnalysisSourceIdentity({
    githubOwner: 'owner',
    githubRepo: 'repo',
    githubKey: context.githubSourceKeyForLoadedAnalysis('owner', 'repo', loaded, ['docs/**'])
  });
  assert.equal(
    context.analysisHydrationIdFromParts(before, graph),
    context.analysisHydrationIdFromParts(afterEdit, graph)
  );
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
  assert.equal(context.fileSourceDisplayState(cached.files[0], true, { 'src/a.js': true }), 'failed');
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

test('obsolete hydration results do not replace a new analysis file', () => {
  const repoA = { sourceType: 'github', sourceKey: 'owner/alpha' };
  const repoB = { sourceType: 'github', sourceKey: 'owner/beta' };
  const data = { files: [{ path: 'src/index.js', name: 'index.js' }], connections: [] };
  const idA = context.analysisHydrationId(repoA, data, null);
  const idB = context.analysisHydrationId(repoB, data, null);
  assert.notEqual(idA, idB);
  assert.equal(context.hydratedSourceIsCurrent({ path: 'src/index.js', content: 'A', hydrationId: idA }, idB), false);
  const rejected = context.mergeHydratedFileSources(data, [{ path: 'src/index.js', content: 'from-alpha', hydrationId: idA }], idB);
  assert.equal(Object.prototype.hasOwnProperty.call(rejected.files[0], 'content'), false);
  const accepted = context.mergeHydratedFileSources(data, [{ path: 'src/index.js', content: 'from-beta', hydrationId: idB }], idB);
  assert.equal(accepted.files[0].content, 'from-beta');
});

test('obsolete source failures do not mark a new analysis path as failed', () => {
  const repoA = { sourceType: 'github', sourceKey: 'owner/alpha' };
  const repoB = { sourceType: 'github', sourceKey: 'owner/beta' };
  const data = { files: [{ path: 'src/index.js', name: 'index.js' }], connections: [] };
  const idA = context.analysisHydrationId(repoA, data);
  const idB = context.analysisHydrationId(repoB, data);
  assert.equal(context.hydrationRequestIsCurrent(idA, idB), false);
  assert.equal(context.hydrationRequestIsCurrent(idB, idB), true);
  const stale = context.recordCodeSourceFailureIfCurrent(null, 'src/index.js', idA, idB);
  assert.equal(Object.keys(stale).length, 0);
  const current = context.recordCodeSourceFailureIfCurrent(null, 'src/index.js', idB, idB);
  assert.equal(current['src/index.js'], true);
  const kept = context.clearCodeSourceFailureIfCurrent(current, 'src/index.js', idA, idB);
  assert.equal(kept['src/index.js'], true);
  const cleared = context.clearCodeSourceFailureIfCurrent(current, 'src/index.js', idB, idB);
  assert.equal(Object.prototype.hasOwnProperty.call(cleared, 'src/index.js'), false);
});

test('symbol pills track scroll and hide when clipped away', () => {
  const visible = context.codeCardPillViewTop(80, 0, 400, 42);
  assert.equal(visible, 80);
  assert.equal(context.codeCardPillViewTop(80, 20, 400, 42), 60);
  assert.equal(context.codeCardPillViewTop(2000, 0, 1840, 42), null);
  assert.equal(context.codeCardPillViewTop(2000, 1600, 1840, 42), 400);
  assert.equal(context.codeCardPillViewTop(30, 0, 400, 42), null);
});

test('selection reads the live body scrollTop of a previously scrolled card', () => {
  const layer = {
    querySelectorAll(sel) {
      if (sel !== '[data-code-card]') return [];
      return [
        {
          getAttribute(name) { return name === 'data-code-card' ? 'src/other.js' : null; },
          querySelector() { return { scrollTop: 999 }; }
        },
        {
          getAttribute(name) { return name === 'data-code-card' ? 'src/app.js' : null; },
          querySelector(sel) { return sel === '.code-card-body' ? { scrollTop: 240 } : null; }
        }
      ];
    }
  };
  assert.equal(context.readCodeCardBodyScroll(layer, 'src/app.js'), 240);
  assert.equal(context.readCodeCardBodyScroll(layer, 'src/missing.js'), 0);
  assert.equal(context.readCodeCardBodyScroll(null, 'src/app.js'), 0);
  assert.equal(context.readCodeCardBodyScroll(layer, ''), 0);
});

test('hydration IDs follow the loaded analysis, not a live CLI session', () => {
  const data = { files: [{ path: 'src/index.js', name: 'index.js' }], connections: [] };
  const graph = context.analysisGraphKey(data);
  const watchingGithub = {
    localSourceKind: null,
    cliOk: true,
    cliRoot: '/watch',
    githubOwner: 'owner',
    githubRepo: 'alpha',
    githubKey: 'owner/alpha'
  };
  const alpha = context.loadedAnalysisSourceIdentity(watchingGithub);
  const beta = context.loadedAnalysisSourceIdentity(Object.assign({}, watchingGithub, {
    githubRepo: 'beta',
    githubKey: 'owner/beta'
  }));
  assert.equal(alpha.sourceType, 'github');
  assert.equal(alpha.sourceKey, 'owner/alpha');
  assert.equal(beta.sourceKey, 'owner/beta');
  assert.notEqual(
    context.analysisHydrationIdFromParts(alpha, graph),
    context.analysisHydrationIdFromParts(beta, graph)
  );
  const cli = context.loadedAnalysisSourceIdentity({
    localSourceKind: 'cli',
    cliOk: true,
    cliRoot: '/watch',
    githubOwner: 'owner',
    githubRepo: 'alpha',
    githubKey: 'owner/alpha'
  });
  assert.equal(cli.sourceType, 'cli');
  assert.equal(cli.sourceKey, '/watch');
});

test('symbol list wheel stays native instead of panning the canvas', () => {
  const list = { closest(sel) { return sel === '.code-sym-list' ? this : null; } };
  const chip = { closest(sel) { return sel === '.code-sym-list' ? list : null; } };
  const body = { closest(sel) { return sel === '.code-card.clipped .code-card-body' ? this : null; } };
  const canvas = { closest() { return null; } };
  assert.equal(context.isCodeCanvasNativeScrollTarget(list), true);
  assert.equal(context.isCodeCanvasNativeScrollTarget(chip), true);
  assert.equal(context.isCodeCanvasNativeScrollTarget(body), true);
  assert.equal(context.isCodeCanvasNativeScrollTarget(canvas), false);
  assert.equal(context.isCodeCanvasNativeScrollTarget(null), false);
});

test('modifier-wheel over a clipped card still zooms the canvas', () => {
  const body = { closest(sel) { return sel === '.code-card.clipped .code-card-body' ? this : null; } };
  const list = { closest(sel) { return sel === '.code-sym-list' ? this : null; } };
  const canvas = { closest() { return null; } };
  assert.equal(context.codeViewWheelUsesNativeScroll({}, body), true);
  assert.equal(context.codeViewWheelUsesNativeScroll({ ctrlKey: true }, body), false);
  assert.equal(context.codeViewWheelUsesNativeScroll({ metaKey: true }, body), false);
  assert.equal(context.codeViewWheelUsesNativeScroll({}, list), true);
  assert.equal(context.codeViewWheelUsesNativeScroll({ ctrlKey: true }, list), false);
  assert.equal(context.codeViewWheelUsesNativeScroll({ ctrlKey: true }, canvas), false);
  assert.equal(context.codeViewWheelUsesNativeScroll({}, canvas), false);
  assert.equal(context.codeViewWheelAction({ ctrlKey: true }), 'zoom');
  assert.equal(context.codeViewWheelAction({ metaKey: true }), 'zoom');
});

test('far-zoom clipped cards let unmodified wheel pan the canvas', () => {
  const farBody = {
    closest(sel) {
      if (sel === '.code-card.clipped .code-card-body') return this;
      if (sel === '.code-card.code-far') return this;
      return null;
    }
  };
  const nearBody = { closest(sel) { return sel === '.code-card.clipped .code-card-body' ? this : null; } };
  assert.equal(context.isCodeCanvasNativeScrollTarget(farBody), false);
  assert.equal(context.codeViewWheelUsesNativeScroll({}, farBody), false);
  assert.equal(context.codeViewWheelUsesNativeScroll({}, nearBody), true);
  assert.equal(context.codeViewWheelAction({}), 'pan');
});

test('folder frames count as canvas background for deselect', () => {
  const svg = { id: 'svg' };
  const hull = {
    getAttribute(name) { return name === 'data-code-bg' ? '1' : null; },
    closest(sel) { return sel === '[data-code-bg="1"]' ? this : null; }
  };
  const hullChild = {
    getAttribute() { return null; },
    closest(sel) { return sel === '[data-code-bg="1"]' ? hull : null; }
  };
  const node = {
    getAttribute() { return null; },
    closest() { return null; }
  };
  assert.equal(context.isCodeCanvasDeselectTarget(svg, svg), true);
  assert.equal(context.isCodeCanvasDeselectTarget(hull, svg), true);
  assert.equal(context.isCodeCanvasDeselectTarget(hullChild, svg), true);
  assert.equal(context.isCodeCanvasDeselectTarget(node, svg), false);
  assert.equal(context.isCodeCanvasDeselectTarget(null, svg), false);
  assert.equal(context.isCodeCanvasDeselectTarget(svg, null), false);
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
  assert.match(htmlSource, /className:'code-canvas'/);
  assert.doesNotMatch(htmlSource, /className:'code-split'/);
  assert.match(htmlSource, /data-code-card/);
  assert.match(htmlSource, /applyCodeCardLayout/);
  assert.match(htmlSource, /layoutCodeCardsByFolder/);
  assert.match(htmlSource, /appendCodeCardPlacement/);
  assert.match(htmlSource, /reflowUnpinnedCodeCards/);
  assert.match(htmlSource, /nextCodeSourceReads/);
  assert.match(htmlSource, /recordCodeSourceFailure/);
  assert.match(htmlSource, /recordCodeSourceFailureIfCurrent/);
  assert.match(htmlSource, /hydrationRequestIsCurrent/);
  assert.match(htmlSource, /analysisGraphKey/);
  assert.match(htmlSource, /analysisGraphIdentity/);
  assert.match(htmlSource, /analysisHydrationIdFromParts/);
  assert.match(htmlSource, /loadedAnalysisSourceIdentity/);
  assert.match(htmlSource, /isCodeCanvasNativeScrollTarget/);
  assert.match(htmlSource, /codeViewWheelUsesNativeScroll/);
  assert.match(htmlSource, /codeViewWheelUsesNativeScroll\(e,e\.target\)/);
  assert.doesNotMatch(htmlSource, /analysisHydrationId\(currentAnalysisSource\(\),data\)/);
  assert.match(htmlSource, /retryCodeSource/);
  assert.match(htmlSource, /sourceState==='failed'/);
  assert.match(htmlSource, /hiddenOpenedCodePaths/);
  assert.match(htmlSource, /codeCardPlacementKeepSet/);
  assert.match(htmlSource, /pruneCodeCardPlacements/);
  assert.match(htmlSource, /codeCardPlacementKeepSet\(openedCodePaths,codeViewFiles\)/);
  assert.match(htmlSource, /code-card\.code-far/);
  assert.match(htmlSource, /zoomShowsColorBlocks/);
  assert.match(htmlSource, /zoomHidesCodeText/);
  assert.match(htmlSource, /codeColorBlockSections/);
  assert.match(htmlSource, /vizHasZoomColorBlocks/);
  assert.match(htmlSource, /applyCanvasColorBlocks/);
  assert.match(htmlSource, /graphColorBlockSize/);
  assert.match(htmlSource, /graphColorBlockScale/);
  assert.match(htmlSource, /graphColorBlockFill/);
  assert.match(htmlSource, /colorBlockLooksLikeDiff/);
  assert.match(htmlSource, /graphColorBlockFill\(getC\(d\)\)/);
  assert.doesNotMatch(htmlSource, /function codeColorBlockKindColor[\s\S]*#98c379/);
  assert.doesNotMatch(htmlSource, /function codeColorBlockKindColor[\s\S]*#e06c75/);
  assert.match(htmlSource, /className:'code-color-blocks'/);
  assert.match(htmlSource, /className:'code-color-block /);
  assert.match(htmlSource, /attr\('class','nb'\)/);
  assert.match(htmlSource, /svg\.color-blocks/);
  assert.match(htmlSource, /COLOR_BLOCK_ZOOM/);
  assert.match(htmlSource, /selectAll\('\.nc,\.nb'\)/);
  assert.match(htmlSource, /evictHiddenCodeCards/);
  assert.match(htmlSource, /updateHullsRef\.current/);
  assert.match(htmlSource, /codeViewWheelPanDelta/);
  assert.match(htmlSource, /codeSourceInFlightRef/);
  assert.match(htmlSource, /analysisHydrationId/);
  assert.match(htmlSource, /currentHydrationId/);
  assert.match(htmlSource, /openedSceneRef\.current=currentHydrationId/);
  assert.match(htmlSource, /hydratedSourceIsCurrent/);
  assert.match(htmlSource, /codeCardDragDelta/);
  assert.match(htmlSource, /openCodeFileRef\.current\(seed,true\)/);
  assert.match(htmlSource, /codeCardPillViewTop/);
  assert.match(htmlSource, /readCodeCardBodyScroll/);
  assert.match(htmlSource, /readCodeCardBodyScroll\(codeCardsLayerRef\.current/);
  assert.match(htmlSource, /isCodeCanvasDeselectTarget/);
  assert.match(htmlSource, /isCodeCanvasDeselectTarget\(e\.target/);
  assert.match(htmlSource, /data-code-bg/);
  assert.match(htmlSource, /attr\('pointer-events','none'\)/);
  assert.match(htmlSource, /openCodeCardPaths/);
  assert.match(htmlSource, /filesForOpenedCodePaths/);
  assert.match(htmlSource, /applyOpenedCardPlacements/);
  assert.match(htmlSource, /codeCardLinkPath/);
  assert.match(htmlSource, /codeCardLinkEndpoint/);
  assert.match(htmlSource, /codeLinkPrefersVertical/);
  assert.match(htmlSource, /code-line-pill/);
  assert.match(htmlSource, /defaultCodeViewSeed/);
  assert.match(htmlSource, /codeViewSeedPath/);
  assert.match(htmlSource, /codeViewSeedPath\(selected&&selected\.path/);
  assert.match(htmlSource, /codeFileNavOpensCard/);
  assert.match(htmlSource, /graphSvgExportEnabled/);
  assert.match(htmlSource, /if\(!graphSvgExportEnabled\(graphConfig\.vizType\)\)/);
  assert.match(htmlSource, /Code cards are HTML overlays, not SVG/);
  assert.match(htmlSource, /export-option.*disabled/);
  assert.match(htmlSource, /function goToFile\(/);
  assert.match(htmlSource, /React\.createElement\(TreeNode,\{node:data\.tree,selected:selected,onSelect:goToFile,expanded:expandedPaths,toggle:togglePath,filterFolder:filterByFolder,activeFilter:folderFilter\}\)/);
  assert.doesNotMatch(htmlSource, /onSelect:goToFile\},expanded/);
  assert.match(htmlSource, /className:'blast-file',onClick:function\(\)\{goToFile\(path\);\}/);
  assert.match(htmlSource, /className:'conn-goto',onClick:function\(\)\{goToFile\(conn\.file\);\}/);
  assert.match(htmlSource, /currentHydrationId,/);
  assert.match(htmlSource, /shouldSeedOpenedCodeCards/);
  assert.match(htmlSource, /ensureCodeViewOpenedPaths/);
  assert.match(htmlSource, /codeViewSessionRef/);
  assert.match(htmlSource, /x2<x1/);
  assert.match(htmlSource, /shouldFitCodeCamera/);
  assert.match(htmlSource, /codeViewCameraReadyRef/);
  assert.match(htmlSource, /graphRebuildKey/);
  assert.match(htmlSource, /connectionIdentity/);
  assert.match(htmlSource, /fileGraphIdentity/);
  assert.match(htmlSource, /resolveOpenCodeCard/);
  assert.match(htmlSource, /codeViewSceneKey/);
  assert.match(htmlSource, /naturalWidth>width/);
  assert.match(htmlSource, /!byPath\[selectedPath\]/);
  assert.match(htmlSource, /nodeReplacedByCard/);
  assert.match(htmlSource, /unburyNodesFromCards/);
  assert.match(htmlSource, /\.has-code-card\{display:none/);
  assert.doesNotMatch(htmlSource, /\.code-faded \.nc\{opacity:0\.18/);
  assert.doesNotMatch(htmlSource, /if\(firstOpen&&codeViewFiles\.length/);
  assert.match(htmlSource, /className:'code-sym-list'/);
  assert.doesNotMatch(htmlSource, /className:'code-sym-row'/);
  assert.match(htmlSource, /CODE_CARD_MAX/);
  assert.match(htmlSource, /CODE_CARD_WIDTH/);
  assert.match(htmlSource, /consumeCodeCardClick/);
  assert.match(htmlSource, /Open cards stay put/);
  assert.doesNotMatch(htmlSource, /shift the set/);
  assert.match(htmlSource, /vizType==='code'/);
  assert.match(htmlSource, /readableLabelScale/);
  assert.match(htmlSource, /listRecentAnalyses/);
  assert.match(htmlSource, /armRecentDelete/);
  assert.match(htmlSource, /Confirm\?/);
  assert.match(htmlSource, /__codeflow\/status/);
  assert.match(htmlSource, /analyzeFromCli\(false,status\)/);
  assert.match(htmlSource, /retainedFolderMatchesRecord/);
  assert.match(htmlSource, /retainedZipMatchesRecord/);
  assert.match(htmlSource, /cliRecordMatchesStatus/);
  assert.match(htmlSource, /githubCacheSourceKey/);
  assert.match(htmlSource, /githubSourceKeyForLoadedAnalysis/);
  assert.match(htmlSource, /folderFilterAfterCodeNav/);
  assert.match(htmlSource, /setFolderFilter\(nextFilter\)/);
  assert.match(htmlSource, /allowReplace=!!\(replace\|\|reveal\)/);
  assert.match(htmlSource, /filterAnalyzableLocalFiles\(/);
  assert.match(htmlSource, /asCodeLines\(highlightSyntax/);
  assert.match(htmlSource, /zipArchiveCacheMeta/);
  assert.match(htmlSource, /compactAnalysisForCache/);
  assert.match(htmlSource, /fileHasLoadedSource/);
  assert.match(htmlSource, /onPointerDown/);
  assert.match(htmlSource, /__codeflow\/file\?path=/);
  assert.match(htmlSource, /The folder picker is faster when the API is rate-limited/);
  assert.match(htmlSource, /className:'panel-tab-pill'/);
  assert.match(htmlSource, /\.panel-tab\{[^}]*flex-wrap:nowrap/);
  assert.match(htmlSource, /\.panel-tabs\{[^}]*flex-wrap:nowrap/);
  assert.match(htmlSource, /className:'sidebar-tabs'/);
  assert.match(htmlSource, /className:'sidebar-tab'/);
  assert.match(htmlSource, /useState\('overview'\),leftTab=/);
  assert.match(htmlSource, /setLeftTab\('overview'\)/);
  assert.match(htmlSource, /setLeftTab\('files'\)/);
  assert.match(htmlSource, /setLeftTab\('recents'\)/);
  assert.doesNotMatch(htmlSource, /if\(data&&!hadAnalysisRef\.current\)setLeftTab\('files'\)/);
  assert.match(htmlSource, /function renderColorByControl\(/);
  assert.match(htmlSource, /className:'color-by'/);
  assert.match(htmlSource, /function renderCodeViewPrefs\(/);
  assert.match(htmlSource, /className:'color-by code-view-prefs'/);
  assert.match(htmlSource, /Expand All/);
  assert.match(htmlSource, /Wrap Text/);
  assert.match(htmlSource, /setCodeViewExpand\(!codeViewExpand\)/);
  assert.match(htmlSource, /setCodeViewWrap\(!codeViewWrap\)/);
  assert.match(htmlSource, /'aria-pressed':codeViewExpand/);
  assert.match(htmlSource, /'aria-pressed':codeViewWrap/);
  assert.match(htmlSource, /CODE_VIEW_ROOT_GATE_DEFAULT/);
  assert.match(htmlSource, /CODE_VIEW_ROOT_GATE_STEPS/);
  assert.match(htmlSource, /function countCodeViewRootFiles\(/);
  assert.match(htmlSource, /function codeViewRootGateActive\(/);
  assert.match(htmlSource, /function codeViewRootGateMessage\(/);
  assert.match(htmlSource, /function persistCodeViewRootGate\(/);
  assert.match(htmlSource, /className:'code-root-gate'/);
  assert.match(htmlSource, /className:'code-view-prefs-row'/);
  assert.match(htmlSource, /Load Files/);
  assert.match(htmlSource, /persistCodeViewRootGate\(n\)/);
  assert.doesNotMatch(htmlSource, /className:'code-view-gate-select'/);
  assert.doesNotMatch(htmlSource, /code-view-prefs[\s\S]{0,400}createElement\('select'/);
  assert.match(htmlSource, /Pick a folder or file/);
  assert.match(htmlSource, /codeRootGateActive/);
  assert.match(htmlSource, /shouldSeedOpenedCodeCards\(true,codeViewSessionRef\.current,openedCodePaths,codeRootGateActive\)/);
  assert.match(htmlSource, /if\(!data\|\|codeRootGateActive\)return\[\]/);
  assert.match(htmlSource, /useState\(readUiPrefs\(\)\.codeViewRootGate\)/);
  assert.match(htmlSource, /persistUiPrefs\(\{codeViewRootGate:value\}\)/);
  assert.match(htmlSource, /normalizeCodeCardPrefs/);
  assert.match(htmlSource, /codeCardWrapColumns/);
  assert.match(htmlSource, /codeCardVisualLineEndIndex/);
  assert.match(htmlSource, /liveGraphNodeXY/);
  assert.match(htmlSource, /readCodeCardWorldBoxes/);
  assert.match(htmlSource, /codeFolderHullBounds/);
  assert.match(htmlSource, /codeFolderHullsByFolder/);
  assert.match(htmlSource, /graphFolderCenters/);
  assert.match(htmlSource, /parkLeftoverCodeNodes/);
  assert.match(htmlSource, /leftoverCodeNodeGrid/);
  assert.match(htmlSource, /codeViewSiblingNodes/);
  assert.match(htmlSource, /translateCodeViewSiblings/);
  assert.match(htmlSource, /settleCodeViewAfterDrag/);
  assert.match(htmlSource, /codeViewDragRefresh\('move'\)/);
  assert.match(htmlSource, /codeViewDragRefresh\('release'\)/);
  assert.match(htmlSource, /raiseCodeCardStack/);
  assert.match(htmlSource, /applyCodeCardStackOrder/);
  assert.match(htmlSource, /applyCodeCardDragFrame/);
  assert.match(htmlSource, /bumpOverlappingCodeCards/);
  assert.match(htmlSource, /nudgeLeftoverGroupsFromCards/);
  assert.match(htmlSource, /separateLeftoverCodeNodes/);
  assert.match(htmlSource, /leftoverSpatialCellKey/);
  assert.match(htmlSource, /leftoverSeparationNeighbors/);
  assert.match(htmlSource, /leftoverSeparationBuckets/);
  assert.match(htmlSource, /leftoverHullObstacles/);
  assert.match(htmlSource, /cardWorldBox/);
  assert.match(htmlSource, /boxesByPath:readCodeCardWorldBoxes/);
  assert.match(htmlSource, /beginCodeCardResize/);
  assert.match(htmlSource, /data-code-resize/);
  assert.match(htmlSource, /code-card-resize-e/);
  assert.match(htmlSource, /code-card-resize-s/);
  assert.match(htmlSource, /applyCodeCardUserSize/);
  assert.match(htmlSource, /liveNodesByFolder/);
  assert.match(htmlSource, /readCodeCardWorldBoxes\(codeCardsLayerRef\.current\)/);
  assert.match(htmlSource, /codeFolderHullBounds\(cardNodes,leftover/);
  assert.match(htmlSource, /if\(updateHullsRef\.current\)updateHullsRef\.current\(\)/);
  assert.match(htmlSource, /codeViewExpand,codeViewWrap/);
  assert.match(htmlSource, /cardSize\.expand\?' expand'/);
  assert.match(htmlSource, /cardSize\.wrap\?' wrap'/);
  assert.match(htmlSource, /\.code-card\.wrap \.file-preview-text/);
  assert.match(htmlSource, /white-space:pre-wrap/);
  assert.match(htmlSource, /\.code-card\.expand:not\(\.wrap\) \.code-card-body\{overflow-x:auto/);
  assert.doesNotMatch(htmlSource, /sidebar-title'\},'Color By'/);
  assert.doesNotMatch(htmlSource, /sidebar-title'\},'Explorer'/);
  assert.match(htmlSource, /function persistLineThickness\(/);
  assert.match(htmlSource, /function persistUiPrefs\(/);
  assert.match(htmlSource, /function resolveUiPrefsStorage\(/);
  assert.match(htmlSource, /function applyLinkThickness\(/);
  assert.match(htmlSource, /'aria-label':'Line thickness'/);
  assert.match(htmlSource, /config-label'\},'Thickness'/);
  assert.match(htmlSource, /persistLineThickness\(e\.target\.value\)/);
  assert.match(htmlSource, /useState\(readUiPrefs\(\)\.lineThickness\)/);
  assert.match(htmlSource, /persistUiPrefs\(\{lineThickness:value\}\)/);
  assert.doesNotMatch(htmlSource, /readUiPrefs\(window\.localStorage\)/);
  assert.doesNotMatch(htmlSource, /writeUiPrefs\(window\.localStorage/);
  assert.match(htmlSource, /graphLinkStrokeWidth\(d\.count,lineThicknessRef\.current\)/);
  assert.match(htmlSource, /graph3dLinkWidth\(link,selected&&selected\.path,lineThicknessRef\.current\)/);
  assert.match(htmlSource, /scaleStrokeWidth\(1\.5,lineThickness\)/);
  assert.match(htmlSource, /scaleStrokeWidth\(Math\.max\(2,d\.width\),lineThickness\)/);
  assert.match(htmlSource, /UI_PREFS_STORAGE_KEY/);
  assert.match(htmlSource, /function vizUsesLineThickness\(/);
  assert.match(htmlSource, /vizUsesLineThickness\(graphConfig\.vizType\)&&React\.createElement\('div',\{className:'canvas-toolbar'/);
  assert.match(htmlSource, /vizUsesLineThickness\(graphConfig\.vizType\)&&showGraphConfig/);
  assert.doesNotMatch(htmlSource, /\(graphConfig\.vizType==='graph'\|\|graphConfig\.vizType==='graph3d'\|\|graphConfig\.vizType==='code'\)&&React\.createElement\('div',\{className:'canvas-toolbar'/);
});

test('thickness control is offered on every view that draws links', () => {
  ['graph', 'code', 'graph3d', 'dendro', 'sankey', 'disjoint', 'bundle'].forEach((viz) => {
    assert.equal(context.vizUsesLineThickness(viz), true, viz);
  });
  ['treemap', 'matrix', 'architecture', 'none', ''].forEach((viz) => {
    assert.equal(context.vizUsesLineThickness(viz), false, viz);
  });
  assert.equal(context.vizHasGraphToolbar('graph'), true);
  assert.equal(context.vizHasGraphToolbar('dendro'), false);
  assert.equal(context.vizHasGraphToolbar('bundle'), false);
});

test('canvas mini-map is wired for Graph and Code only', () => {
  assert.equal(context.vizHasCanvasMinimap('graph'), true);
  assert.equal(context.vizHasCanvasMinimap('code'), true);
  ['graph3d', 'treemap', 'matrix', 'dendro', 'sankey', 'disjoint', 'bundle', 'architecture', ''].forEach((viz) => {
    assert.equal(context.vizHasCanvasMinimap(viz), false, viz);
  });
  assert.match(htmlSource, /function vizHasCanvasMinimap\(/);
  assert.match(htmlSource, /vizHasCanvasMinimap\(graphConfig\.vizType\)&&React\.createElement\('div',\{/);
  assert.match(htmlSource, /className:'canvas-minimap'/);
  assert.match(htmlSource, /Click or drag to pan/);
  assert.match(htmlSource, /tabIndex:0/);
  assert.match(htmlSource, /role:'application'/);
  assert.match(htmlSource, /Arrow keys pan the view/);
  assert.match(htmlSource, /onKeyDown:handleMinimapKeyDown/);
  assert.match(htmlSource, /\.canvas-minimap:focus-visible\{outline:2px solid var\(--acc\)/);
  assert.match(htmlSource, /function zoomTransformFromMinimapPoint\(/);
  assert.match(htmlSource, /function zoomTransformNudgeWorld\(/);
  assert.match(htmlSource, /function panTransformByViewportFraction\(/);
  assert.match(htmlSource, /function panTransformToWorldMidpoint\(/);
  assert.match(htmlSource, /function drawCanvasMinimap\(/);
  assert.match(htmlSource, /function minimapCardInputs\(/);
  assert.match(htmlSource, /function clampMinimapPoint\(/);
  assert.match(htmlSource, /minimapCardInputs\(graphConfig\.vizType,codeCardSizesRef\.current,codeCardPathsRef\.current\)/);
  assert.doesNotMatch(htmlSource, /minimapWorldFromBoxes\(Object\.keys\(folders\)\.reduce/);
  assert.match(htmlSource, /world:minimapWorldFromBoxes\(boxes,pad\)/);
  assert.match(htmlSource, /if\(drawMinimapRef\.current\)drawMinimapRef\.current\(\)/);
  assert.doesNotMatch(htmlSource, /minimap-drag-handle|drag indicator/);
  assert.match(htmlSource, /'aria-label':'Line thickness'/);
  assert.match(htmlSource, /config-label'\},'Thickness'/);
});

test('mini-map world bounds include nodes and code cards', () => {
  const nodes = [
    { id: 'src/a.js', folder: 'src', x: 0, y: 0 },
    { id: 'src/b.js', folder: 'src', x: 200, y: 40 }
  ];
  const world = context.collectMinimapWorldBounds(nodes, null, null, 0);
  assert.ok(world);
  assert.equal(world.minX, -16);
  assert.equal(world.maxX, 216);
  const cards = new Set(['src/a.js']);
  const sizes = { 'src/a.js': { width: 400, height: 200 } };
  const cardWorld = context.collectMinimapWorldBounds(nodes, sizes, cards, 0);
  assert.ok(cardWorld.minX <= -200);
  assert.ok(cardWorld.maxX >= 216);
  const content = context.collectMinimapContent(nodes, sizes, cards, (n) => n.id === 'src/a.js' ? '#4d9fff' : '#22c55e', 0);
  assert.equal(content.marks.some((m) => m.kind === 'card'), true);
  assert.equal(content.marks.some((m) => m.kind === 'node'), true);
  assert.equal(content.hulls.length, 1);
  assert.equal(content.hulls[0].folder, 'src');
  const stale = context.minimapCardInputs('graph', sizes, cards);
  assert.equal(stale.sizesByPath, null);
  assert.equal(stale.cardPaths, null);
  const graphWorld = context.collectMinimapWorldBounds(nodes, stale.sizesByPath, stale.cardPaths, 0);
  assert.equal(graphWorld.minX, -16);
  assert.equal(graphWorld.maxX, 216);
  const graphContent = context.collectMinimapContent(nodes, stale.sizesByPath, stale.cardPaths, (n) => n.id === 'src/a.js' ? '#4d9fff' : '#22c55e', 0);
  assert.equal(graphContent.marks.some((m) => m.kind === 'card'), false);
  const live = context.minimapCardInputs('code', sizes, cards);
  assert.equal(live.sizesByPath, sizes);
  assert.equal(live.cardPaths, cards);

  const many = [];
  for (let i = 0; i < 24; i += 1) {
    many.push({ id: `f${i}/n.js`, folder: `f${i}`, x: i * 80, y: i * 10 });
  }
  const manyWorld = context.collectMinimapWorldBounds(many, null, null, 0);
  const manyContent = context.collectMinimapContent(many, null, null, () => '#4d9fff', 0);
  assert.equal(manyContent.hulls.length, 24);
  assert.equal(manyContent.world.minX, manyWorld.minX);
  assert.equal(manyContent.world.maxX, manyWorld.maxX);
  assert.equal(manyContent.world.minY, manyWorld.minY);
  assert.equal(manyContent.world.maxY, manyWorld.maxY);
});

test('mini-map click centers the current camera on that world point', () => {
  const transform = { k: 2, x: 100, y: 50 };
  const view = context.viewportWorldRect(transform, 800, 600);
  assert.equal(view.x, -50);
  assert.equal(view.y, -25);
  assert.equal(view.width, 400);
  assert.equal(view.height, 300);
  const world = { minX: 0, minY: 0, maxX: 400, maxY: 300, width: 400, height: 300 };
  const fit = context.minimapFitRect(world, 200, 150, 0);
  assert.ok(fit);
  assert.equal(fit.scale, 0.5);
  const mid = context.worldToMinimap(200, 150, world, fit);
  assert.equal(mid.x, 100);
  assert.equal(mid.y, 75);
  const back = context.minimapToWorld(mid.x, mid.y, world, fit);
  assert.equal(back.x, 200);
  assert.equal(back.y, 150);
  const centered = context.zoomTransformToCenterWorld(150, 125, 2, 800, 600);
  assert.equal(centered.k, 2);
  assert.equal(centered.x, 100);
  assert.equal(centered.y, 50);
  const jumped = context.zoomTransformFromMinimapPoint(100, 75, world, fit, transform, 800, 600);
  assert.equal(jumped.k, 2);
  assert.equal(jumped.x, 400 - 200 * 2);
  assert.equal(jumped.y, 300 - 150 * 2);
  const ptr = J(context.minimapPointerXY(120, 80, { left: 20, top: 30 }));
  assert.deepEqual(ptr, { x: 100, y: 50 });
  assert.equal(context.colorWithAlpha('#00ff9d', 0.1), 'rgba(0,255,157,0.1)');

  const wide = { minX: 0, minY: 0, maxX: 400, maxY: 100, width: 400, height: 100 };
  const letterbox = context.minimapFitRect(wide, 200, 150, 0);
  assert.ok(letterbox);
  assert.equal(letterbox.scale, 0.5);
  assert.equal(letterbox.ox, 0);
  assert.equal(letterbox.oy, 50);
  const unclampedY = (0 - letterbox.oy) / letterbox.scale + wide.minY;
  assert.ok(unclampedY < wide.minY);
  const clampedTop = context.clampMinimapPoint(100, 0, wide, letterbox);
  assert.deepEqual(J(clampedTop), { x: 100, y: 50 });
  const edge = context.minimapToWorld(100, 0, wide, letterbox);
  assert.equal(edge.x, 200);
  assert.equal(edge.y, 0);
  const bottom = context.minimapToWorld(100, 149, wide, letterbox);
  assert.equal(bottom.x, 200);
  assert.equal(bottom.y, 100);
  const left = context.minimapToWorld(-20, 75, wide, letterbox);
  assert.equal(left.x, 0);
  assert.equal(left.y, 50);
  const right = context.minimapToWorld(300, 75, wide, letterbox);
  assert.equal(right.x, 400);
  assert.equal(right.y, 50);
  const jumpedEdge = context.zoomTransformFromMinimapPoint(100, 0, wide, letterbox, transform, 800, 600);
  assert.equal(jumpedEdge.k, 2);
  assert.equal(jumpedEdge.x, 400 - 200 * 2);
  assert.equal(jumpedEdge.y, 300 - 0 * 2);
});

test('mini-map keyboard pans the viewport by a fraction of the view', () => {
  const transform = { k: 2, x: 100, y: 50 };
  const before = context.viewportWorldRect(transform, 800, 600);
  assert.equal(before.x, -50);
  assert.equal(before.y, -25);
  assert.equal(before.width, 400);
  assert.equal(before.height, 300);

  const right = context.panTransformByViewportFraction(transform, 0.25, 0, 800, 600);
  assert.equal(right.k, 2);
  const afterRight = context.viewportWorldRect(right, 800, 600);
  assert.equal(afterRight.x, before.x + before.width * 0.25);
  assert.equal(afterRight.y, before.y);
  assert.equal(afterRight.width, before.width);

  const left = context.panTransformByViewportFraction(transform, -0.25, 0, 800, 600);
  assert.equal(left.k, 2);
  assert.equal(context.viewportWorldRect(left, 800, 600).x, before.x - before.width * 0.25);

  const down = context.panTransformByViewportFraction(transform, 0, 0.25, 800, 600);
  assert.equal(down.k, 2);
  assert.equal(context.viewportWorldRect(down, 800, 600).y, before.y + before.height * 0.25);

  const up = context.panTransformByViewportFraction(transform, 0, -0.25, 800, 600);
  assert.equal(up.k, 2);
  assert.equal(context.viewportWorldRect(up, 800, 600).y, before.y - before.height * 0.25);

  const far = context.panTransformByViewportFraction(transform, 0.5, 0, 800, 600);
  assert.equal(far.k, 2);
  assert.equal(context.viewportWorldRect(far, 800, 600).x, before.x + before.width * 0.5);

  const nudged = context.zoomTransformNudgeWorld(transform, before.width * 0.25, 0);
  assert.equal(nudged.k, 2);
  assert.deepEqual(J(nudged), J(right));

  const world = { minX: 0, minY: 0, maxX: 400, maxY: 300, width: 400, height: 300 };
  const home = context.panTransformToWorldMidpoint(transform, world, 800, 600);
  const centered = context.zoomTransformToCenterWorld(200, 150, 2, 800, 600);
  assert.equal(home.k, 2);
  assert.deepEqual(J(home), J(centered));
  const missing = context.panTransformToWorldMidpoint(transform, null, 800, 600);
  assert.deepEqual(J(missing), J(context.snapshotZoomTransform(transform)));
});

function memoryStorage(seed) {
  const data = Object.assign({}, seed || {});
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      data[key] = String(value);
    },
    _data: data
  };
}

test('line thickness defaults match current graph edges and stay in range', () => {
  assert.equal(context.LINE_THICKNESS_DEFAULT, 1);
  assert.equal(context.LINE_THICKNESS_MIN, 1);
  assert.equal(context.LINE_THICKNESS_MAX, 6);
  assert.equal(context.clampLineThickness(undefined), 1);
  assert.equal(context.clampLineThickness('nope'), 1);
  assert.equal(context.clampLineThickness(0), 1);
  assert.equal(context.clampLineThickness(9), 6);
  assert.equal(context.clampLineThickness(3.6), 4);
  const thin = context.graphLinkStrokeWidth(1, 1);
  const thick = context.graphLinkStrokeWidth(1, 4);
  assert.equal(thin, Math.max(1, Math.min(2, Math.sqrt(1) * 0.3)));
  assert.equal(thick, thin * 4);
  assert.equal(context.scaleStrokeWidth(1.5, 1), 1.5);
  assert.equal(context.scaleStrokeWidth(1.5, 2), 3);
  const idle = context.graph3dLinkWidth({ count: 1, source: 'a.js', target: 'b.js' }, null, 1);
  const selected = context.graph3dLinkWidth({ count: 1, source: 'a.js', target: 'b.js' }, 'a.js', 1);
  assert.ok(selected > idle);
});

test('UI prefs persist line thickness in localStorage', () => {
  const storage = memoryStorage();
  assert.equal(context.readUiPrefs(storage).lineThickness, 1);
  assert.equal(context.readUiPrefs(storage).codeViewRootGate, 50);
  assert.equal(context.readUiPrefs(null).lineThickness, 1);
  const written = context.writeUiPrefs(storage, { lineThickness: 5 });
  assert.equal(written.lineThickness, 5);
  assert.equal(written.codeViewRootGate, 50);
  assert.equal(context.readUiPrefs(storage).lineThickness, 5);
  assert.equal(context.writeUiPrefs(storage, { lineThickness: 99 }).lineThickness, 6);
  const gated = context.writeUiPrefs(storage, { codeViewRootGate: 75 });
  assert.equal(gated.codeViewRootGate, 75);
  assert.equal(context.writeUiPrefs(storage, { codeViewRootGate: 40 }).codeViewRootGate, 50);
  storage.setItem(context.UI_PREFS_STORAGE_KEY, '{not-json');
  assert.equal(context.readUiPrefs(storage).lineThickness, 1);
  assert.equal(context.readUiPrefs(storage).codeViewRootGate, 50);
  const other = memoryStorage({ [context.UI_PREFS_STORAGE_KEY]: JSON.stringify({ lineThickness: 2, extra: true }) });
  const merged = context.writeUiPrefs(other, { lineThickness: 3 });
  assert.equal(merged.lineThickness, 3);
  assert.equal(merged.codeViewRootGate, 50);
  context.window = { localStorage: storage };
  try {
    assert.equal(context.persistUiPrefs({ lineThickness: 4 }).lineThickness, 4);
    assert.equal(context.readUiPrefs().lineThickness, 4);
    assert.equal(context.persistUiPrefs({ codeViewRootGate: 25 }).codeViewRootGate, 25);
    assert.equal(context.readUiPrefs().codeViewRootGate, 25);
  } finally {
    delete context.window;
  }
});

function throwingLocalStorageWindow() {
  return {
    get localStorage() {
      const err = new Error('Access is denied for this document.');
      err.name = 'SecurityError';
      throw err;
    }
  };
}

test('UI prefs keep the default when localStorage access throws', () => {
  context.window = throwingLocalStorageWindow();
  try {
    assert.equal(context.resolveUiPrefsStorage(undefined), null);
    assert.doesNotThrow(() => context.readUiPrefs());
    assert.equal(context.readUiPrefs().lineThickness, context.LINE_THICKNESS_DEFAULT);
    const rendered = context.readUiPrefs().lineThickness;
    assert.equal(rendered, 1);
    assert.doesNotThrow(() => context.persistUiPrefs({ lineThickness: 5 }));
    const inSession = context.persistUiPrefs({ lineThickness: 5 });
    assert.equal(inSession.lineThickness, 5);
    assert.equal(context.readUiPrefs().lineThickness, 1);
  } finally {
    delete context.window;
  }
});
