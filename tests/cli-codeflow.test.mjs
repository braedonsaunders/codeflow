import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm, symlink, readFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  isAllowedCliRequest,
  isLoopbackHost,
  isWatchableFile,
  listWatchFiles,
  parseCliArgs,
  resolveSafeCliPath,
  resolveSafeExistingPath,
  shouldSkipName,
  createCodeflowServer,
  openBrowser,
  safeRequestPath,
  startFileWatchers,
  CLI_FILE_MAX_BYTES,
  isMissingFsError,
  bumpWatchRev,
  currentWatchRev,
  readOpenedSnapshot
} from '../cli/codeflow.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

test('CLI file errors distinguish missing files from read failures', () => {
  assert.equal(CLI_FILE_MAX_BYTES, 2 * 1024 * 1024);
  const revs = new Map();
  assert.equal(bumpWatchRev(revs, 'src/app.js'), 1);
  assert.equal(bumpWatchRev(revs, 'src/app.js'), 2);
  assert.equal(currentWatchRev(revs, '/src/app.js'), 2);
  assert.equal(isMissingFsError({ code: 'ENOENT' }), true);
  assert.equal(isMissingFsError({ code: 'ENOTDIR' }), true);
  assert.equal(isMissingFsError({ code: 'EISDIR' }), true);
  assert.equal(isMissingFsError({ code: 'EACCES' }), false);
  assert.equal(isMissingFsError({ code: 'EIO' }), false);
  assert.equal(isMissingFsError(null), false);
});

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

test('CLI request guard only allows loopback Host and Origin', () => {
  assert.equal(isLoopbackHost('127.0.0.1:4173'), true);
  assert.equal(isLoopbackHost('localhost:4173'), true);
  assert.equal(isLoopbackHost('[::1]:4173'), true);
  assert.equal(isLoopbackHost('evil.example'), false);
  assert.equal(isAllowedCliRequest({ headers: { host: '127.0.0.1:4173' } }), true);
  assert.equal(isAllowedCliRequest({ headers: { host: '127.0.0.1:4173', origin: 'http://127.0.0.1:4173' } }), true);
  assert.equal(isAllowedCliRequest({ headers: { host: 'evil.example', origin: 'http://evil.example' } }), false);
  assert.equal(isAllowedCliRequest({ headers: { host: '127.0.0.1:4173', origin: 'http://evil.example' } }), false);
});

test('CLI rejects escaping symlinks after resolving the real path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codeflow-link-'));
  const outside = await mkdtemp(join(tmpdir(), 'codeflow-secret-'));
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'src', 'app.js'), 'export const ok = 1;\n');
  await writeFile(join(outside, 'id_rsa'), 'SECRET\n');
  await symlink(join(outside, 'id_rsa'), join(root, 'src', 'config.js'));
  await symlink(join(root, 'src', 'app.js'), join(root, 'src', 'alias.js'));
  assert.equal(await resolveSafeExistingPath(root, 'src/config.js'), null);
  const inside = await resolveSafeExistingPath(root, 'src/alias.js');
  assert.ok(inside && inside.endsWith('app.js'));
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
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
  const fileBody = await file.text();
  assert.match(fileBody, /function/);
  assert.equal(file.headers.get('content-length'), String(Buffer.byteLength(fileBody)));
  assert.equal(file.headers.get('x-codeflow-rev'), '0');
  // An atomic save after open would bump the live rev; the header must
  // still reflect the pre-open sample so retainCliWatchPathsAfterAnalysis
  // treats that SSE rev as newer than the snapshot.
  const cliSource = await readFile(join(repoRoot, 'cli/codeflow.mjs'), 'utf8');
  assert.match(cliSource, /function pipeSafeFile[\s\S]*?resolveSnapshotRev\(options\)[\s\S]*?fs\.open\(filePath, 'r'\)[\s\S]*?readOpenedSnapshot\(fh, st\.size\)/);
  assert.doesNotMatch(cliSource, /function pipeSafeFile[\s\S]*?fs\.open\(filePath, 'r'\)[\s\S]*?resolveSnapshotRev\(/);
  assert.match(cliSource, /isMissingFsError\(err\)[\s\S]*?sendFileError\(res, 404/);
  assert.match(cliSource, /sendFileError\(res, 500, 'Read failed'\)/);
  assert.match(cliSource, /X-Codeflow-Rev/);
  assert.doesNotMatch(cliSource, /createReadStream/);
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
  const rebound = await new Promise((resolveReq, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/__codeflow/files',
      headers: { Host: 'evil.example', Origin: 'http://evil.example' }
    }, (res) => {
      res.resume();
      res.on('end', () => resolveReq(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(rebound, 403);
  const crossOrigin = await new Promise((resolveReq, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/__codeflow/file?path=src/app.js',
      headers: { Host: '127.0.0.1:' + port, Origin: 'http://evil.example' }
    }, (res) => {
      res.resume();
      res.on('end', () => resolveReq(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(crossOrigin, 403);
});

test('CLI file endpoint does not follow escaping symlinks', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'codeflow-serve-'));
  const outside = await mkdtemp(join(tmpdir(), 'codeflow-secret-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'src', 'app.js'), 'export const ok = 1;\n');
  await writeFile(join(outside, 'id_rsa'), 'SECRET\n');
  await symlink(join(outside, 'id_rsa'), join(root, 'src', 'config.js'));
  const { server, close } = createCodeflowServer({ uiRoot: repoRoot, watchRoot: root });
  t.after(() => close());
  await new Promise((resolveListen, reject) => {
    server.listen(0, '127.0.0.1', resolveListen);
    server.once('error', reject);
  });
  const { port } = server.address();
  const escaped = await fetch('http://127.0.0.1:' + port + '/__codeflow/file?path=src/config.js');
  assert.equal(escaped.status, 404);
  assert.doesNotMatch(await escaped.text(), /SECRET/);
  const ok = await fetch('http://127.0.0.1:' + port + '/__codeflow/file?path=src/app.js');
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /export const ok/);
});

test('CLI file endpoint rejects oversized snapshots before buffering', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'codeflow-oversize-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(join(root, 'huge.js'), Buffer.alloc(CLI_FILE_MAX_BYTES + 1, 97));
  const { server, close } = createCodeflowServer({ uiRoot: repoRoot, watchRoot: root });
  t.after(() => close());
  await new Promise((resolveListen, reject) => {
    server.listen(0, '127.0.0.1', resolveListen);
    server.once('error', reject);
  });
  const { port } = server.address();
  const huge = await fetch('http://127.0.0.1:' + port + '/__codeflow/file?path=huge.js');
  assert.equal(huge.status, 413);
  assert.notEqual(huge.headers.get('content-length'), String(CLI_FILE_MAX_BYTES + 1));
  const ui = await fetch('http://127.0.0.1:' + port + '/');
  assert.equal(ui.status, 200);
});

test('CLI watch events tell the UI which file changed', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'codeflow-events-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'src', 'app.js'), 'export const ok = 1;\n');
  const { server, close } = createCodeflowServer({ uiRoot: repoRoot, watchRoot: root });
  t.after(() => close());
  await new Promise((resolveListen, reject) => {
    server.listen(0, '127.0.0.1', resolveListen);
    server.once('error', reject);
  });
  const { port } = server.address();
  const events = await new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/__codeflow/events',
      headers: { Accept: 'text/event-stream' }
    }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buf += chunk;
        if (buf.includes('data: ')) {
          res.destroy();
          resolve(buf);
        }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
    setTimeout(async () => {
      await writeFile(join(root, 'src', 'app.js'), 'export const ok = 2;\n');
    }, 40);
    setTimeout(() => reject(new Error('watch event timed out')), 3000);
  });
  assert.match(events, /"type":"change"/);
  assert.match(events, /"path":"src\/app.js"/);
  assert.match(events, /"rev":/);
});

test('CLI snapshot reads loop until the opened range is filled', async () => {
  const chunks = [4, 4, 2];
  const fh = {
    async read(buf, offset, length) {
      const n = Math.min(chunks.shift() || 0, length);
      buf.fill(65, offset, offset + n);
      return { bytesRead: n };
    }
  };
  const body = await readOpenedSnapshot(fh, 10);
  assert.equal(body.length, 10);
  assert.equal(body.toString(), 'A'.repeat(10));
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

test('Node 18 fallback re-watches a directory that is deleted and recreated', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codeflow-rewatch-'));
  const listeners = new Map();
  let watchCalls = 0;
  const patchedWatch = (dir, opts, listener) => {
    if (opts && opts.recursive) {
      throw Object.assign(new Error('recursive unavailable'), { code: 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM' });
    }
    watchCalls += 1;
    const rec = { dir, listener, closed: false, close() { rec.closed = true; } };
    listeners.set(resolve(dir), rec);
    return rec;
  };
  const watcher = startFileWatchers(root, () => {}, patchedWatch);
  const rootWatch = listeners.get(resolve(root));
  await mkdir(join(root, 'gone'));
  rootWatch.listener('rename', 'gone');
  const createdDeadline = Date.now() + 500;
  while (Date.now() < createdDeadline && !listeners.has(resolve(root, 'gone'))) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  const first = listeners.get(resolve(root, 'gone'));
  assert.ok(first);
  const callsAfterCreate = watchCalls;
  await rm(join(root, 'gone'), { recursive: true, force: true });
  rootWatch.listener('rename', 'gone');
  const goneDeadline = Date.now() + 500;
  while (Date.now() < goneDeadline && !first.closed) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  assert.equal(first.closed, true);
  await mkdir(join(root, 'gone', 'nested'), { recursive: true });
  await writeFile(join(root, 'gone', 'nested', 'file.js'), 'export const y = 2;\n');
  rootWatch.listener('rename', 'gone');
  const againDeadline = Date.now() + 500;
  while (Date.now() < againDeadline && (watchCalls <= callsAfterCreate || !listeners.has(resolve(root, 'gone', 'nested')))) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  const second = listeners.get(resolve(root, 'gone'));
  assert.ok(second);
  assert.notEqual(second, first);
  assert.equal(second.closed, false);
  assert.ok(watchCalls > callsAfterCreate);
  assert.ok(listeners.has(resolve(root, 'gone', 'nested')));
  watcher.close();
  await rm(root, { recursive: true, force: true });
});
