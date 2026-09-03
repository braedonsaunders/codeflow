import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';
import { isWatchableFile } from '../cli/codeflow.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
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

const { Parser } = context;

// README Supported Languages lists these extensions. Until they are in
// codeExts they are neither code nor text, so folder/GitHub/ZIP analysis
// drops them even though the CLI already watches them for live diffs.
const advertisedCodeExts = [
  'util.cxx',
  'types.hh',
  'types.hxx',
  'scratch.sc',
  'build.gvy',
  'records.hrl',
  'Guide.lhs',
  'Api.fsi',
  'api.mli',
  'app.cljs',
  'shared.cljc',
  'Config.psd1',
];

test('README-advertised language extensions are analyzed as code', () => {
  for (const name of advertisedCodeExts) {
    assert.equal(Parser.isCode(name), true, name);
    assert.equal(Parser.isIncluded(name), true, name);
  }
});

test('CLI already watches the advertised extensions the analyzer used to drop', () => {
  for (const name of advertisedCodeExts) {
    assert.equal(isWatchableFile(name), true, name);
  }
});

test('C++ helpers on .cxx/.hh extract the same way as .cpp/.hpp', () => {
  const cxx = [
    'int add_pair(int a, int b) {',
    '  return a + b;',
    '}',
  ].join('\n');
  const names = Parser.extract(cxx, 'math.cxx').map((fn) => fn.name);
  assert.ok(names.includes('add_pair'), names.join(','));

  const header = [
    'inline int times_two(int n) {',
    '  return n * 2;',
    '}',
  ].join('\n');
  const headerNames = Parser.extract(header, 'math.hh').map((fn) => fn.name);
  assert.ok(headerNames.includes('times_two'), headerNames.join(','));
});

test('Scala scripts and Groovy sources extract advertised routines', () => {
  const scala = Parser.extract('def greet(name: String) = s"hi $name"\n', 'scratch.sc').map((fn) => fn.name);
  assert.ok(scala.includes('greet'), scala.join(','));

  const groovy = Parser.extract('public String shout(String word) {\n  return word.toUpperCase()\n}\n', 'build.gvy').map((fn) => fn.name);
  assert.ok(groovy.includes('shout'), groovy.join(','));
});

test('tree-sitter C++/Scala configs include the advertised extra extensions', () => {
  assert.equal(Parser.getTreeSitterConfig('math.cxx').grammar, 'cpp');
  assert.equal(Parser.getTreeSitterConfig('types.hh').grammar, 'cpp');
  assert.equal(Parser.getTreeSitterConfig('types.hxx').grammar, 'cpp');
  assert.equal(Parser.getTreeSitterConfig('scratch.sc').grammar, 'scala');
});
