// Static file serving over dist/ — extracted from the Commit 2 placeholder
// server/index.js, unchanged, as part of MOO-67 Commit 5's restructuring
// into namespaced modules.
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
};

function contentTypeFor(filePath) {
  return MIME_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream';
}

async function resolveRequestedFile(distDir, requestPath) {
  const decoded = decodeURIComponent(requestPath.split('?')[0]);
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const resolved = normalize(join(distDir, relative));
  // Reject any path that escapes distDir (e.g. via `..` segments).
  if (!resolved.startsWith(distDir + sep) && resolved !== join(distDir, 'index.html')) {
    return null;
  }
  return resolved;
}

/** @param {string} distDir */
export function createStaticHandler(distDir) {
  return async function handleStatic(req, res) {
    try {
      const filePath = await resolveRequestedFile(distDir, req.url || '/');
      if (!filePath) {
        res.writeHead(400).end('Bad request');
        return;
      }
      const info = await stat(filePath).catch(() => null);
      const servedPath = info && info.isFile() ? filePath : join(distDir, 'index.html');
      const body = await readFile(servedPath);
      res.writeHead(200, { 'Content-Type': contentTypeFor(servedPath) });
      res.end(body);
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        res.writeHead(404).end('Not found — run `npm run build` first');
        return;
      }
      res.writeHead(500).end('Internal server error');
    }
  };
}
