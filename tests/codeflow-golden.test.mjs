import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';
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
vm.runInContext(`${htmlSource.slice(parserStart, parserEnd)}\nthis.Parser = Parser; this.buildAnalysisData = buildAnalysisData;`, context);

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

test('golden mixed-language fixture stays stable', async () => {
  const data = await analyzeFixture('golden-world');

  assert.equal(data.stats.files, 6);
  assert.equal(data.stats.functions, 7);
  assert.equal(data.stats.dead, 1);
  assert.equal(data.deadFunctions[0].name, 'unusedHelper');
  assert.equal(data.stats.connections, 6);

  assert.deepEqual(
    data.files.map((file) => file.path).sort(),
    ['README.md', 'service.md', 'src/app.js', 'src/main.py', 'src/math.js', 'src/service.py']
  );

  assert.deepEqual(
    data.functions.map((fn) => fn.name).sort(),
    ['add', 'boot', 'double', 'hydrate', 'normalize', 'run', 'unusedHelper']
  );

  const connectionPairs = data.connections.map((conn) => `${conn.source}->${conn.target}:${conn.fn}`).sort();
  assert(connectionPairs.includes('README.md->src/math.js:[math](src/math.js)'));
  assert(connectionPairs.includes('service.md->src/service.py:[Python service](src/service.py)'));
  assert(connectionPairs.includes('src/math.js->src/app.js:add'));
  assert(connectionPairs.includes('src/service.py->src/main.py:hydrate'));

  const parserModes = Object.fromEntries(data.stats.parserModes.map((mode) => [mode.mode, mode.files]));
  assert.equal(parserModes['heuristic-regex'], 4);
  assert.equal(parserModes['markdown-link-parser'], 2);
});
