// Static file serving over dist/ — extracted from the Commit 2 placeholder
// server/index.js, unchanged, as part of MOO-67 Commit 5's restructuring
// into namespaced modules.
//
// Path containment rewritten after GitHub code scanning (CodeQL
// js/path-injection, high severity x2) flagged the original
// `resolved.startsWith(distDir + sep)` check: a raw string-prefix
// comparison isn't a pattern static analysis can verify as a real
// sanitizer barrier, unlike `path.relative()` + a `..`/absolute check --
// the same pattern server/routes/analyze.js's resolveWithinRepo uses,
// which CodeQL did not flag. Deliberately NOT adding realpath() here the
// way that fix did: dist/ is build output the operator controls, not
// arbitrary externally-sourced content, so the symlink-escape risk
// realpath() guards against doesn't apply the same way -- and realpath()
// throws for anything not on disk, which would break the existing
// SPA-style fallback (an unmatched client-side route path legitimately
// doesn't exist under dist/ and should serve index.html, not 400).
import { readFile, stat } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';

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

/** Reject any path that resolves outside distDir, whether or not it exists. */
export function resolveRequestedFile(distDir, requestPath) {
  const decoded = decodeURIComponent(requestPath.split('?')[0]);
  const relativeRequest = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const lexicalTarget = join(distDir, relativeRequest);
  const rel = relative(distDir, lexicalTarget);
  if (rel === '' || rel.startsWith('..' + sep) || rel === '..' || join(distDir, rel) !== lexicalTarget) {
    return null;
  }
  return lexicalTarget;
}

/** @param {string} distDir */
export function createStaticHandler(distDir) {
  return async function handleStatic(req, res) {
    try {
      const filePath = resolveRequestedFile(distDir, req.url || '/');
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
