import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
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
  const sources = {};
  for (const entry of entries) {
    if (!entry.isFile() || !Parser.isIncluded(entry.name)) continue;
    sources[entry.name] = await readFile(join(fixtureRoot, entry.name), 'utf8');
  }
  return analyzePascalSources(sources);
}

async function analyzePascalSources(sources) {
  const analyzed = [];
  const allFns = [];
  for (const [filePath, content] of Object.entries(sources)) {
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

test('Pascal extraction ignores routine-like declarations inside comments', () => {
  const content = `program CommentedRoutines;

{
procedure CurlyGhost;
}

(*
function ParenGhost: Integer;
*)

procedure RealRoutine;
begin
end;

begin
  RealRoutine;
end.
`;
  const functions = Parser.extract(content, 'CommentedRoutines.lpr');

  assert.deepEqual(Array.from(functions, (fn) => fn.name), ['RealRoutine']);
});

test('Pascal call graph is case-insensitive, follows uses units, and ignores non-code', async () => {
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

test('Pascal case-folded calls resolve only to the imported unit', async () => {
  const data = await analyzePascalSources({
    'UnitA.pas': `unit UnitA;
interface
procedure Render;
implementation
procedure Render;
begin
end;
end.
`,
    'UnitB.pas': `unit UnitB;
interface
procedure render;
implementation
procedure render;
begin
end;
end.
`,
    'app.lpr': `program CaseFoldedCalls;
uses UnitA;
begin
  RENDER;
end.
`,
  });

  const appConnections = data.connections.filter((connection) => connection.target === 'app.lpr');
  assert.deepEqual(
    Array.from(appConnections, (connection) => connection.source + ':' + connection.fn),
    ['UnitA.pas:Render']
  );
  assert.equal(data.connections.some((connection) => connection.source === 'UnitB.pas'), false);
});

test('Pascal unit-qualified calls select the named unit from case-folded definitions', async () => {
  const data = await analyzePascalSources({
    'UnitA.pas': `unit UnitA;
interface
procedure Render;
implementation
procedure Render;
begin
end;
end.
`,
    'UnitB.pas': `unit UnitB;
interface
procedure render;
implementation
procedure render;
begin
end;
end.
`,
    'app.lpr': `program QualifiedCaseFoldedCalls;
uses UnitA, UnitB;
begin
  UnitA . RENDER;
  UnitA.
    RENDER;
end.
`,
  });

  const appConnections = data.connections.filter((connection) => connection.target === 'app.lpr');
  assert.deepEqual(
    Array.from(appConnections, (connection) => connection.source + ':' + connection.fn),
    ['UnitA.pas:Render']
  );
  assert.equal(appConnections[0].count, 2);
  assert.equal(data.connections.some((connection) => connection.source === 'UnitB.pas'), false);
});

test('Pascal unqualified calls use the last matching unit in the uses clause', async () => {
  const data = await analyzePascalSources({
    'UnitA.pas': `unit UnitA;
interface
procedure Render;
implementation
procedure Render;
begin
end;
end.
`,
    'UnitB.pas': `unit UnitB;
interface
procedure render;
implementation
procedure render;
begin
end;
end.
`,
    'app-ab.lpr': `program UsesAThenB;
uses UnitA, UnitB;
begin
  RENDER;
end.
`,
    'app-ba.lpr': `program UsesBThenA;
uses UnitB, UnitA;
begin
  render;
end.
`,
  });

  const sourceByCaller = Object.fromEntries(
    data.connections
      .filter((connection) => connection.target.startsWith('app-'))
      .map((connection) => [connection.target, connection.source])
  );
  assert.deepEqual(sourceByCaller, {
    'app-ab.lpr': 'UnitB.pas',
    'app-ba.lpr': 'UnitA.pas',
  });
});

test('Pascal qualified routine declarations are not counted as calls', async () => {
  const data = await analyzePascalSources({
    'Thing.pas': `unit Thing;
interface
type
  TThing = class
    procedure Render;
  end;
implementation
procedure TThing.Render;
begin
end;
end.
`,
  });

  const renderStats = Object.values(data.fnStats).find((stats) => stats.name === 'Render');
  assert.ok(renderStats);
  assert.equal(renderStats.internal, 0);
  assert.equal(renderStats.external, 0);
  assert.equal(renderStats.count, 0);
});

test('Pascal member calls do not use unit import precedence', async () => {
  const data = await analyzePascalSources({
    'UnitA.pas': `unit UnitA;
interface
type
  TThing = class
    procedure Render;
  end;
implementation
procedure TThing.Render;
begin
end;
end.
`,
    'UnitB.pas': `unit UnitB;
interface
procedure render;
implementation
procedure render;
begin
end;
end.
`,
    'app.lpr': `program MemberCall;
uses UnitA, UnitB;
var
  Obj: UnitA.TThing;
  Items: array of UnitA.TThing;
begin
  Obj.Render;
  GetThing().Render();
  Items[0].Render();
end.
`,
  });

  const appConnections = data.connections.filter((connection) => connection.target === 'app.lpr');
  assert.deepEqual(Array.from(appConnections), []);
});
