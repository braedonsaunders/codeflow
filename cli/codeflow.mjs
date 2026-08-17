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

export function resolveSafeCliPath(root, relPath) {
  const rootPath = path.resolve(String(root || ''));
  const rel = String(relPath || '').replace(/\\/g, '/');
  if (!rel || rel.startsWith('/') || rel.split('/').includes('..')) return null;
  const full = path.resolve(rootPath, rel);
  const prefix = rootPath.endsWith(path.sep) ? rootPath : rootPath + path.sep;
  if (full !== rootPath && !full.startsWith(prefix)) return null;
  return full;
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

function openBrowser(url) {
  const platform = process.platform;
  const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
  child.unref();
}

export function createCodeflowServer(options) {
  const uiRoot = options.uiRoot;
  const watchRoot = options.watchRoot;
  const name = path.basename(watchRoot);
  const clients = new Set();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (url.pathname === '/__codeflow/status') {
      sendJson(res, 200, { ok: true, root: watchRoot, name, watch: true });
      return;
    }
    if (url.pathname === '/__codeflow/files') {
      try {
        sendJson(res, 200, { files: await listWatchFiles(watchRoot) });
      } catch (e) {
        sendJson(res, 500, { error: e.message || String(e) });
      }
      return;
    }
    if (url.pathname === '/__codeflow/file') {
      const safe = resolveSafeCliPath(watchRoot, url.searchParams.get('path') || '');
      if (!safe || !existsSync(safe)) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      createReadStream(safe).pipe(res);
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

    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    const safeUi = resolveSafeCliPath(uiRoot, rel.replace(/^\//, ''));
    if (!safeUi || !existsSync(safeUi)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': mimeFor(safeUi) });
    createReadStream(safeUi).pipe(res);
  });

  let watcher;
  try {
    watcher = watch(watchRoot, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const rel = String(filename).replace(/\\/g, '/');
      if (rel.split('/').some(shouldSkipName)) return;
      const payload = `data: ${JSON.stringify({ type: 'change', path: rel })}\n\n`;
      for (const client of clients) client.write(payload);
    });
  } catch (e) {
    watcher = null;
  }

  return {
    server,
    close() {
      if (watcher) watcher.close();
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
