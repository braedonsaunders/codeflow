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
