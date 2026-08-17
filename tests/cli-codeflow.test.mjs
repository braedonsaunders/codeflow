import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  isWatchableFile,
  listWatchFiles,
  parseCliArgs,
  resolveSafeCliPath,
  shouldSkipName,
  createCodeflowServer,
  openBrowser,
  safeRequestPath,
  startFileWatchers
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

test('openBrowser keeps running when the opener is missing', () => {
  const events = {};
  const fakeSpawn = () => ({
    on(name, fn) {
      events[name] = fn;
      return this;
    },
    unref() {}
  });
  assert.doesNotThrow(() => openBrowser('http://127.0.0.1:4173/?cli=1', fakeSpawn));
  assert.equal(typeof events.error, 'function');
  assert.doesNotThrow(() => events.error(Object.assign(new Error('spawn xdg-open ENOENT'), { code: 'ENOENT' })));
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
  const asDir = await fetch(base + '/__codeflow/file?path=src');
  assert.equal(asDir.status, 404);
  const stillUp = await fetch(base + '/__codeflow/status');
  assert.equal(stillUp.status, 200);
  assert.equal(typeof (await stillUp.json()).watch, 'boolean');
  const badEscape = await new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: '/%', method: 'GET' }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(badEscape, 400);
  const afterBad = await fetch(base + '/__codeflow/status');
  assert.equal(afterBad.status, 200);
});

test('safeRequestPath rejects malformed escapes', () => {
  assert.equal(safeRequestPath('/%').ok, false);
  assert.equal(safeRequestPath('/%').status, 400);
  assert.equal(safeRequestPath('/index.html').ok, true);
  assert.equal(safeRequestPath('/index.html').pathname, '/index.html');
});

test('file watchers fall back or report watch:false', async () => {
  const unavailable = startFileWatchers('/tmp', () => {}, () => {
    throw Object.assign(new Error('watch unavailable'), { code: 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM' });
  });
  assert.equal(unavailable.watching, false);
  unavailable.close();

  const watched = [];
  const fallback = startFileWatchers(join(__dirname, 'fixtures', 'golden-world'), () => {}, (dir, opts) => {
    if (opts && opts.recursive) {
      throw Object.assign(new Error('recursive unavailable'), { code: 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM' });
    }
    watched.push(dir);
    return { close() {} };
  });
  assert.equal(fallback.watching, true);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.ok(watched.some((dir) => dir.endsWith('golden-world')));
  assert.ok(watched.some((dir) => dir.endsWith(join('golden-world', 'src')) || dir.endsWith('golden-world/src')));
  fallback.close();
  assert.equal(fallback.watching, false);
});

test('Node 18 fallback watches nested dirs when a pre-populated tree appears', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codeflow-watch-'));
  const listeners = new Map();
  const fakeWatch = (dir, opts) => {
    if (opts && opts.recursive) {
      throw Object.assign(new Error('recursive unavailable'), { code: 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM' });
    }
    const rec = { dir, listener: null, close() {} };
    listeners.set(resolve(dir), rec);
    return rec;
  };
  const patchedWatch = (dir, opts, listener) => {
    const rec = fakeWatch(dir, opts);
    rec.listener = listener;
    return rec;
  };
  const watcher = startFileWatchers(root, () => {}, patchedWatch);
  assert.equal(watcher.watching, true);
  await mkdir(join(root, 'newTree', 'nested'), { recursive: true });
  await writeFile(join(root, 'newTree', 'nested', 'file.js'), 'export const x = 1;\n');
  const rootWatch = listeners.get(resolve(root));
  assert.equal(typeof rootWatch.listener, 'function');
  rootWatch.listener('rename', 'newTree');
  const deadline = Date.now() + 500;
  while (Date.now() < deadline && (!listeners.has(resolve(root, 'newTree')) || !listeners.has(resolve(root, 'newTree', 'nested')))) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  assert.ok(listeners.has(resolve(root, 'newTree')));
  assert.ok(listeners.has(resolve(root, 'newTree', 'nested')));
  watcher.close();
});
