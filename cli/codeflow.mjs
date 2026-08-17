#!/usr/bin/env node
// Thin local entry point. Serves the same index.html UI and watches a folder.
// The public app stays one HTML file in the browser.

import { createReadStream, existsSync, promises as fs, watch } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const IGNORE = new Set([
  'node_modules', '.git', 'vendor', 'dist', 'build', 'out', 'coverage',
  '.next', '.nuxt', '.cache', '.parcel-cache', '.turbo', '.vercel', '.local',
  '.artifacts', '.playwright-cli', 'playwright-report', 'test-results',
  '.claude', '.codex', '.idea', '.vscode', '.pnpm-store', '.yarn', 'tmp',
  'temp', 'target', 'bin', 'obj', '__pycache__', '.venv', 'venv', 'env',
  '.tox', '.mypy_cache', '.pytest_cache', '.ruff_cache', '__pypackages__',
  '.eggs', '__macosx'
]);

const TEXT_EXT = new Set([
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'py', 'java', 'go', 'rb', 'php',
  'vue', 'svelte', 'rs', 'c', 'h', 'cpp', 'cc', 'cxx', 'hpp', 'hh', 'hxx',
  'cs', 'swift', 'kt', 'kts', 'scala', 'sc', 'groovy', 'gvy', 'ex', 'exs',
  'erl', 'hrl', 'hs', 'lhs', 'lua', 'r', 'jl', 'dart', 'pl', 'pm', 'sh',
  'bash', 'zsh', 'fish', 'ps1', 'psm1', 'psd1', 'fs', 'fsi', 'fsx', 'ml',
  'mli', 'clj', 'cljs', 'cljc', 'elm', 'vba', 'bas', 'cls', 'pas', 'pp',
  'dpr', 'dpk', 'lpr', 'inc', 'html', 'htm', 'xhtml', 'md', 'markdown',
  'json', 'yml', 'yaml', 'toml', 'css', 'scss', 'sql'
]);

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function pathStaysInRoot(root, candidate) {
  const rootPath = path.resolve(String(root || ''));
  const full = path.resolve(String(candidate || ''));
  const prefix = rootPath.endsWith(path.sep) ? rootPath : rootPath + path.sep;
  return full === rootPath || full.startsWith(prefix);
}

export function resolveSafeCliPath(root, relPath) {
  const rootPath = path.resolve(String(root || ''));
  const rel = String(relPath || '').replace(/\\/g, '/');
  if (!rel || rel.startsWith('/') || rel.split('/').includes('..')) return null;
  const full = path.resolve(rootPath, rel);
  if (!pathStaysInRoot(rootPath, full)) return null;
  return full;
}

export async function resolveSafeExistingPath(root, relPath) {
  const lexical = resolveSafeCliPath(root, relPath);
  if (!lexical) return null;
  try {
    const realRoot = await fs.realpath(root);
    const realFile = await fs.realpath(lexical);
    if (!pathStaysInRoot(realRoot, realFile)) return null;
    return realFile;
  } catch {
    return null;
  }
}

export function loopbackHostName(hostHeader) {
  let host = String(hostHeader || '').trim().toLowerCase();
  if (!host) return '';
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    if (end < 0) return '';
    host = host.slice(1, end);
  } else {
    const colon = host.lastIndexOf(':');
    if (colon > 0 && host.indexOf(':') === colon) host = host.slice(0, colon);
  }
  if (host.endsWith('.')) host = host.slice(0, -1);
  return host;
}

export function isLoopbackHost(hostHeader) {
  return LOOPBACK_HOSTS.has(loopbackHostName(hostHeader));
}

export function isAllowedCliRequest(req) {
  const headers = req && req.headers ? req.headers : (req || {});
  if (!isLoopbackHost(headers.host || headers.Host)) return false;
  const origin = headers.origin || headers.Origin;
  if (origin == null || origin === '') return true;
  try {
    return isLoopbackHost(new URL(String(origin)).host);
  } catch {
    return false;
  }
}

export function shouldSkipName(name) {
  const base = String(name || '').toLowerCase();
  return !base || base === '.ds_store' || IGNORE.has(base);
}

export function isWatchableFile(name) {
  const ext = String(name || '').split('.').pop().toLowerCase();
  return TEXT_EXT.has(ext);
}

export function parseCliArgs(argv) {
  const args = argv.slice(2);
  let port = 4173;
  let target = '.';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      port = Number(args[++i]);
    } else if (args[i] === '--help' || args[i] === '-h') {
      return { help: true };
    } else if (!args[i].startsWith('-')) {
      target = args[i];
    }
  }
  return { port, target };
}

export async function listWatchFiles(root) {
  const files = [];
  async function walk(dir, rel) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const entry of entries) {
      if (shouldSkipName(entry.name)) continue;
      const childRel = rel ? rel + '/' + entry.name : entry.name;
      const childPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(childPath, childRel);
      } else if (entry.isFile() && isWatchableFile(entry.name)) {
        let size = 0;
        try {
          size = (await fs.stat(childPath)).size;
        } catch (e) {}
        files.push({
          path: childRel,
          name: entry.name,
          folder: rel || 'root',
          size
        });
      }
    }
  }
  await walk(root, '');
  return files;
}

function mimeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.wasm': 'application/wasm',
    '.woff2': 'font/woff2',
    '.png': 'image/png',
    '.svg': 'image/svg+xml'
  }[ext] || 'application/octet-stream';
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(payload);
}

function sendPublicError(res, status, message) {
  sendJson(res, status, { error: message });
}

function pipeSafeFile(res, filePath, contentType) {
  return fs.stat(filePath).then((st) => {
    if (!st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store'
    });
    const stream = createReadStream(filePath);
    stream.on('error', () => {
      if (res.writableEnded) return;
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      res.end('Read failed');
    });
    stream.pipe(res);
  }).catch(() => {
    if (res.headersSent) return;
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  });
}

export function safeRequestPath(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl || '/', 'http://127.0.0.1');
  } catch {
    return { ok: false, status: 400 };
  }
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return { ok: false, status: 400 };
  }
  return { ok: true, url, pathname };
}

export function startFileWatchers(root, onRelPath, watchFn) {
  const run = typeof watchFn === 'function' ? watchFn : watch;
  const watched = new Map();
  let watching = false;
  let closed = false;

  function emit(rel) {
    if (closed || !rel) return;
    const norm = String(rel).replace(/\\/g, '/');
    if (norm.split('/').some(shouldSkipName)) return;
    onRelPath(norm);
  }

  function forgetTree(dir) {
    const key = path.resolve(String(dir || ''));
    const prefix = key + path.sep;
    for (const childKey of [...watched.keys()]) {
      if (childKey !== key && !childKey.startsWith(prefix)) continue;
      const rec = watched.get(childKey);
      try { if (rec && rec.watcher) rec.watcher.close(); } catch {}
      watched.delete(childKey);
    }
  }

  function add(dir, rel, recursive) {
    if (closed) return false;
    const key = path.resolve(String(dir || ''));
    if (watched.has(key)) return true;
    try {
      const w = run(dir, recursive ? { recursive: true } : {}, (_event, filename) => {
        if (!filename) return;
        const childRel = rel ? rel + '/' + String(filename).replace(/\\/g, '/') : String(filename).replace(/\\/g, '/');
        emit(childRel);
        if (!recursive) {
          const childPath = path.join(dir, String(filename));
          fs.stat(childPath).then((st) => {
            if (closed || shouldSkipName(path.basename(childPath))) return;
            if (!st.isDirectory()) return;
            forgetTree(childPath);
            add(childPath, childRel, false);
            watchExistingTree(childPath, childRel);
          }).catch((err) => {
            if (closed) return;
            if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) forgetTree(childPath);
          });
        }
      });
      watched.set(key, { watcher: w, rel });
      watching = true;
      return true;
    } catch {
      return false;
    }
  }

  async function watchExistingTree(dir, rel) {
    if (closed || !dir) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (closed) return;
      if (!entry.isDirectory() || shouldSkipName(entry.name)) continue;
      const childRel = rel ? rel + '/' + entry.name : entry.name;
      const childPath = path.join(dir, entry.name);
      add(childPath, childRel, false);
      await watchExistingTree(childPath, childRel);
    }
  }

  if (!add(root, '', true)) {
    add(root, '', false);
    watchExistingTree(root, '');
  }

  return {
    get watching() {
      return watching && !closed;
    },
    close() {
      closed = true;
      for (const rec of watched.values()) {
        try { if (rec && rec.watcher) rec.watcher.close(); } catch {}
      }
      watched.clear();
      watching = false;
    }
  };
}

export function openBrowser(url, spawnFn) {
  const platform = process.platform;
  const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const run = typeof spawnFn === 'function' ? spawnFn : spawn;
  try {
    const child = run(cmd, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => {
      console.log('Could not open a browser automatically. Open this URL manually: ' + url);
    });
    if (typeof child.unref === 'function') child.unref();
  } catch {
    console.log('Could not open a browser automatically. Open this URL manually: ' + url);
  }
}

export function createCodeflowServer(options) {
  const uiRoot = options.uiRoot;
  const watchRoot = options.watchRoot;
  const name = path.basename(watchRoot);
  const clients = new Set();

  const watchSession = startFileWatchers(watchRoot, (rel) => {
    const payload = `data: ${JSON.stringify({ type: 'change', path: rel })}\n\n`;
    for (const client of clients) client.write(payload);
  });

  const server = http.createServer(async (req, res) => {
    try {
      if (!isAllowedCliRequest(req)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
      }
      const parsed = safeRequestPath(req.url);
      if (!parsed.ok) {
        res.writeHead(parsed.status, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(parsed.status === 400 ? 'Bad request' : 'Not found');
        return;
      }
      const url = parsed.url;
      if (url.pathname === '/__codeflow/status') {
        sendJson(res, 200, { ok: true, root: watchRoot, name, watch: !!watchSession.watching });
        return;
      }
      if (url.pathname === '/__codeflow/files') {
        try {
          sendJson(res, 200, { files: await listWatchFiles(watchRoot) });
        } catch {
          console.error('codeflow: failed to list watched files');
          sendPublicError(res, 500, 'Could not list files');
        }
        return;
      }
      if (url.pathname === '/__codeflow/file') {
        const safe = await resolveSafeExistingPath(watchRoot, url.searchParams.get('path') || '');
        if (!safe) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Not found');
          return;
        }
        await pipeSafeFile(res, safe, 'text/plain; charset=utf-8');
        return;
      }
      if (url.pathname === '/__codeflow/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive'
        });
        res.write(':\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }

      let rel = parsed.pathname;
      if (rel === '/') rel = '/index.html';
      const safeUi = await resolveSafeExistingPath(uiRoot, rel.replace(/^\//, ''));
      if (!safeUi) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }
      await pipeSafeFile(res, safeUi, mimeFor(safeUi));
    } catch {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      if (!res.writableEnded) res.end('Request failed');
    }
  });

  return {
    server,
    close() {
      watchSession.close();
      for (const client of clients) client.end();
      return new Promise((resolve) => server.close(resolve));
    }
  };
}

async function main() {
  const parsed = parseCliArgs(process.argv);
  if (parsed.help) {
    console.log('Usage: npx codeflow [folder] [--port 4173]\nOpens the same Codeflow UI and watches that folder.');
    process.exit(0);
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const uiRoot = path.resolve(here, '..');
  const watchRoot = path.resolve(process.cwd(), parsed.target || '.');
  const stat = await fs.stat(watchRoot).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    console.error('Watch path is not a directory: ' + watchRoot);
    process.exit(1);
  }
  if (!existsSync(path.join(uiRoot, 'index.html'))) {
    console.error('Could not find index.html next to the CLI. Run this from the Codeflow repo or installed package.');
    process.exit(1);
  }

  const { server } = createCodeflowServer({ uiRoot, watchRoot });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(parsed.port, '127.0.0.1', resolve);
  });
  const url = 'http://127.0.0.1:' + parsed.port + '/?cli=1';
  console.log('Codeflow UI: ' + url);
  console.log('Watching: ' + watchRoot);
  openBrowser(url);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
