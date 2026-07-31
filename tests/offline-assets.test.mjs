import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const vendorRoot = join(repoRoot, 'vendor');
const html = await readFile(join(repoRoot, 'index.html'), 'utf8');
const manifest = JSON.parse(await readFile(join(vendorRoot, 'manifest.json'), 'utf8'));

test('browser runtime dependencies are local', () => {
  const scriptSources = Array.from(html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi), (match) => match[1]);
  const stylesheetSources = Array.from(html.matchAll(/<link\b[^>]*\brel=["']stylesheet["'][^>]*\bhref=["']([^"']+)["']/gi), (match) => match[1]);

  assert.equal(scriptSources.length, 12);
  assert.equal(scriptSources.every((source) => source.startsWith('./vendor/')), true);
  assert.equal(stylesheetSources.some((source) => /^https?:/i.test(source)), false);
  assert.doesNotMatch(html, /importScripts\(\\?["']https?:\/\//i);
  assert.doesNotMatch(html, /treeSitterWasmBase\s*:\s*["']https?:\/\//i);
});

test('vendored asset hashes match the recorded manifest', async () => {
  assert.equal(manifest.version, 1);
  assert.equal(manifest.assets.length, 35);

  for (const asset of manifest.assets) {
    const bytes = await readFile(join(vendorRoot, asset.file));
    const digest = createHash('sha256').update(bytes).digest('hex');
    assert.equal(digest, asset.sha256, asset.file);
  }
});

test('every vendored package has a checked-in license', async () => {
  const packageNames = new Set(manifest.assets.map((asset) => asset.package));
  const notices = await readFile(join(vendorRoot, 'THIRD_PARTY_NOTICES.md'), 'utf8');

  for (const packageName of packageNames) {
    assert.match(notices, new RegExp('`' + packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '`'));
  }
});
