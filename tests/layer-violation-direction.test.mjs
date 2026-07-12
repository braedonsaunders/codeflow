import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
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
vm.runInContext(`${htmlSource.slice(parserStart, parserEnd)}\nthis.Parser = Parser;`, context);
const { Parser } = context;

// Convention (index.html): connection {source: fileDefiningFn (imported), target: fileCallingFn (importer)}.
// layerOrder: lower number = higher/topmost layer. services=2, utils/lib=4. utils importing UP from services = violation.
const files = [
  { path: 'src/services/userService.ts', layer: 'services' },
  { path: 'src/lib/helper.ts', layer: 'utils' },
];

test('healthy downward dependency (service uses a util) is NOT a violation', () => {
  // userService (services) calls a function defined in lib/helper (utils):
  // caller = userService, definition = helper => {source: helper, target: userService}
  const violations = Parser.detectLayerViolations(files, [
    { source: 'src/lib/helper.ts', target: 'src/services/userService.ts', fn: 'formatDate' },
  ]);
  assert.equal(violations.length, 0);
});

test('genuine upward dependency (util reaches into a service) IS a violation, correctly attributed', () => {
  // helper (utils) calls a function defined in userService (services):
  // caller = helper, definition = userService => {source: userService, target: helper}
  const violations = Parser.detectLayerViolations(files, [
    { source: 'src/services/userService.ts', target: 'src/lib/helper.ts', fn: 'fetchUser' },
  ]);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].from, 'src/lib/helper.ts');
  assert.equal(violations[0].to, 'src/services/userService.ts');
  assert.match(violations[0].suggestion, /utils should not import from services/);
});

test('detectLayer classifies root-level layer folders, not just nested ones', () => {
  // Root-level folders (no leading path segment) must match the same as nested ones.
  assert.equal(Parser.detectLayer('services/userService.ts'), 'services');
  assert.equal(Parser.detectLayer('ui/Button.tsx'), 'ui');
  assert.equal(Parser.detectLayer('lib/helper.ts'), 'utils');
  // Nested paths keep their existing classification (regression guard).
  assert.equal(Parser.detectLayer('src/services/userService.ts'), 'services');
  assert.equal(Parser.detectLayer('src/lib/helper.ts'), 'utils');
  // A file with no recognizable layer folder still falls through to the default.
  assert.equal(Parser.detectLayer('src/app.js'), 'utils');
});

test('a test file importing a util or service is NOT flagged as a layer violation', () => {
  const testFiles = [
    { path: 'tests/userService.test.ts', layer: Parser.detectLayer('tests/userService.test.ts') },
    { path: 'src/lib/helper.ts', layer: Parser.detectLayer('src/lib/helper.ts') },
    { path: 'src/services/userService.ts', layer: Parser.detectLayer('src/services/userService.ts') },
  ];
  // The test file calls helper() and createUser() — conns point {source: definition, target: caller=the test file}.
  const conns = [
    { source: 'src/lib/helper.ts', target: 'tests/userService.test.ts', fn: 'formatDate' },
    { source: 'src/services/userService.ts', target: 'tests/userService.test.ts', fn: 'createUser' },
  ];
  const violations = Parser.detectLayerViolations(testFiles, conns);
  assert.equal(violations.length, 0);
});

test('coupling issue label describes fan-out (files it imports), not fan-in', () => {
  const start = htmlSource.indexOf("title:highCoup.length+' Highly Coupled'");
  assert.ok(start > 0, 'Highly Coupled issue builder not found in analyzer source');
  const snippet = htmlSource.slice(start, start + 200);
  // The stale fan-in wording ("imported by 8+ others") must be gone...
  assert.equal(/imported by 8\+ others/.test(snippet), false, 'stale fan-in wording still present');
  // ...replaced by wording that describes fan-out (this file imports others).
  assert.match(snippet, /import 8\+ other/);
});

test('Python test files and test-folder importers are not flagged (layer=test), and .spec files outside tests/ stay excluded', () => {
  // Python test file (detectLayer -> 'test', but isArchitectureTestFile does NOT match .py)
  const pyFiles = [
    { path: 'myapp/test_service.py', layer: Parser.detectLayer('myapp/test_service.py') },
    { path: 'myapp/services/foo.py', layer: Parser.detectLayer('myapp/services/foo.py') },
  ];
  const pyViolations = Parser.detectLayerViolations(pyFiles, [
    { source: 'myapp/services/foo.py', target: 'myapp/test_service.py', fn: 'createUser' },
  ]);
  assert.equal(pyViolations.length, 0);

  // A .spec file outside a tests/ dir: detectLayer -> 'utils' (NOT test), but isArchitectureTestFile matches it.
  // This guards that the isArchitectureTestFile half of the condition still covers such files.
  const specFiles = [
    { path: 'src/utils/user.spec.ts', layer: Parser.detectLayer('src/utils/user.spec.ts') },
    { path: 'src/services/user.ts', layer: Parser.detectLayer('src/services/user.ts') },
  ];
  const specViolations = Parser.detectLayerViolations(specFiles, [
    { source: 'src/services/user.ts', target: 'src/utils/user.spec.ts', fn: 'createUser' },
  ]);
  assert.equal(specViolations.length, 0);
});
