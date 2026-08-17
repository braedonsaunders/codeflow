import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  isWatchableFile,
  listWatchFiles,
  parseCliArgs,
  resolveSafeCliPath,
  shouldSkipName,
  createCodeflowServer
} from '../cli/codeflow.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

test('CLI argument parser accepts a folder and port', () => {
  assert.deepEqual(parseCliArgs(['node', 'codeflow', '.', '--port', '4199']), { port: 4199, target: '.' });
  assert.equal(parseCliArgs(['node', 'codeflow', '--help']).help, true);
});

test('CLI skips junk directories and binary-looking names', () => {
  assert.equal(shouldSkipName('node_modules'), true);
  assert.equal(shouldSkipName('.git'), true);
  assert.equal(isWatchableFile('app.js'), true);
  assert.equal(isWatchableFile('photo.png'), false);
});

test('CLI path resolver stays inside the watch root', () => {
  assert.equal(resolveSafeCliPath('/tmp/proj', '../secret'), null);
  assert.ok(resolveSafeCliPath('/tmp/proj', 'src/app.js').endsWith('/src/app.js'));
});

test('CLI lists source files from a folder', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'codeflow-cli-'));
  await mkdir(join(root, 'src'));
  await mkdir(join(root, 'node_modules', 'left-pad'), { recursive: true });
  await writeFile(join(root, 'src', 'app.js'), 'export function go(){}\n');
  await writeFile(join(root, 'node_modules', 'left-pad', 'index.js'), 'export default 1\n');
  const files = await listWatchFiles(root);
  assert.deepEqual(files.map((f) => f.path), ['src/app.js']);
});

test('CLI server serves the same UI and folder files', async (t) => {
  const fixture = join(__dirname, 'fixtures', 'golden-world');
  const { server, close } = createCodeflowServer({ uiRoot: repoRoot, watchRoot: fixture });
  t.after(() => close());
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', resolve);
    server.once('error', reject);
  });
  const { port } = server.address();
  const base = 'http://127.0.0.1:' + port;
  const status = await (await fetch(base + '/__codeflow/status')).json();
  assert.equal(status.ok, true);
  const ui = await fetch(base + '/');
  assert.equal(ui.status, 200);
  const html = await ui.text();
  assert.match(html, /CODEFLOW/);
  const files = await (await fetch(base + '/__codeflow/files')).json();
  assert.ok(files.files.some((f) => f.path === 'src/app.js'));
  const file = await fetch(base + '/__codeflow/file?path=src/app.js');
  assert.equal(file.status, 200);
  assert.match(await file.text(), /function/);
  const denied = await fetch(base + '/__codeflow/file?path=../package.json');
  assert.equal(denied.status, 404);
});
