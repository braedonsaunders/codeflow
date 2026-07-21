// Minimal static-file server entry point (MOO-67 Commit 2).
//
// Serves the Vite production build from dist/. This is intentionally a
// placeholder: namespaced analysis endpoints, health/readiness checks,
// structured request IDs, and the request-workspace abstraction are
// Commit 5's job. Commit 2 only needs an explicit server entry point to
// exist so later commits have somewhere to add to, rather than a browser
// entry point with no server counterpart.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');
const distDir = join(repoRoot, 'dist');

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

async function resolveRequestedFile(requestPath) {
  const decoded = decodeURIComponent(requestPath.split('?')[0]);
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const resolved = normalize(join(distDir, relative));
  // Reject any path that escapes distDir (e.g. via `..` segments).
  if (!resolved.startsWith(distDir + sep) && resolved !== join(distDir, 'index.html')) {
    return null;
  }
  return resolved;
}

const server = createServer(async (req, res) => {
  try {
    const filePath = await resolveRequestedFile(req.url || '/');
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
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, () => {
  process.stdout.write(`[codeflow-server] serving ${distDir} on http://localhost:${port}\n`);
});
