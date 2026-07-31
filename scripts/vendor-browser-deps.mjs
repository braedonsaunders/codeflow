#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, '..');
const vendorRoot = join(repoRoot, 'vendor');

const packages = [
  { name: 'react', version: '18.2.0', license: 'MIT', licenseUrl: 'https://unpkg.com/react@18.2.0/LICENSE' },
  { name: 'react-dom', version: '18.2.0', license: 'MIT', licenseUrl: 'https://unpkg.com/react-dom@18.2.0/LICENSE' },
  { name: '@babel/standalone', version: '7.23.5', license: 'MIT', licenseUrl: 'https://unpkg.com/@babel/standalone@7.23.5/LICENSE' },
  { name: 'd3', version: '7.8.5', license: 'ISC', licenseUrl: 'https://unpkg.com/d3@7.8.5/LICENSE' },
  { name: 'd3-sankey', version: '0.12.3', license: 'BSD-3-Clause', licenseUrl: 'https://unpkg.com/d3-sankey@0.12.3/LICENSE' },
  { name: 'acorn', version: '8.11.3', license: 'MIT', licenseUrl: 'https://unpkg.com/acorn@8.11.3/LICENSE' },
  { name: 'jsrsasign', version: '11.1.0', license: 'MIT', licenseUrl: 'https://raw.githubusercontent.com/kjur/jsrsasign/11.1.0/LICENSE.txt' },
  { name: 'jszip', version: '3.10.1', license: 'MIT OR GPL-3.0-or-later', licenseUrl: 'https://unpkg.com/jszip@3.10.1/LICENSE.markdown' },
  { name: 'web-tree-sitter', version: '0.20.8', license: 'MIT', licenseUrl: 'https://unpkg.com/web-tree-sitter@0.20.8/LICENSE' },
  { name: 'jspdf', version: '2.5.1', license: 'MIT', licenseUrl: 'https://unpkg.com/jspdf@2.5.1/LICENSE' },
  { name: 'mermaid', version: '10.9.1', license: 'MIT', licenseUrl: 'https://unpkg.com/mermaid@10.9.1/LICENSE' },
  { name: '3d-force-graph', version: '1.80.0', license: 'MIT', licenseUrl: 'https://unpkg.com/3d-force-graph@1.80.0/LICENSE' },
  { name: 'tree-sitter-wasms', version: '0.1.13', license: 'MIT', licenseUrl: 'https://unpkg.com/tree-sitter-wasms@0.1.13/LICENSE' },
  { name: '@fontsource/jetbrains-mono', version: '5.3.0', license: 'OFL-1.1', licenseUrl: 'https://unpkg.com/@fontsource/jetbrains-mono@5.3.0/LICENSE' },
];

const assets = [
  ['react', 'https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js', 'react/react.production.min.js'],
  ['react-dom', 'https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js', 'react-dom/react-dom.production.min.js'],
  ['@babel/standalone', 'https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.23.5/babel.min.js', 'babel/babel.min.js'],
  ['d3', 'https://cdnjs.cloudflare.com/ajax/libs/d3/7.8.5/d3.min.js', 'd3/d3.min.js'],
  ['d3-sankey', 'https://cdnjs.cloudflare.com/ajax/libs/d3-sankey/0.12.3/d3-sankey.min.js', 'd3-sankey/d3-sankey.min.js'],
  ['acorn', 'https://cdnjs.cloudflare.com/ajax/libs/acorn/8.11.3/acorn.min.js', 'acorn/acorn.min.js'],
  ['jsrsasign', 'https://cdnjs.cloudflare.com/ajax/libs/jsrsasign/11.1.0/jsrsasign-all-min.js', 'jsrsasign/jsrsasign-all-min.js'],
  ['jszip', 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', 'jszip/jszip.min.js'],
  ['web-tree-sitter', 'https://cdn.jsdelivr.net/npm/web-tree-sitter@0.20.8/tree-sitter.js', 'tree-sitter/tree-sitter.js'],
  ['web-tree-sitter', 'https://cdn.jsdelivr.net/npm/web-tree-sitter@0.20.8/tree-sitter.wasm', 'tree-sitter/tree-sitter.wasm'],
  ['jspdf', 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', 'jspdf/jspdf.umd.min.js'],
  ['mermaid', 'https://cdnjs.cloudflare.com/ajax/libs/mermaid/10.9.1/mermaid.min.js', 'mermaid/mermaid.min.js'],
  ['3d-force-graph', 'https://unpkg.com/3d-force-graph@1.80.0/dist/3d-force-graph.min.js', '3d-force-graph/3d-force-graph.min.js'],
  ['@fontsource/jetbrains-mono', 'https://unpkg.com/@fontsource/jetbrains-mono@5.3.0/files/jetbrains-mono-latin-400-normal.woff2', 'jetbrains-mono/jetbrains-mono-latin-400-normal.woff2'],
  ['@fontsource/jetbrains-mono', 'https://unpkg.com/@fontsource/jetbrains-mono@5.3.0/files/jetbrains-mono-latin-500-normal.woff2', 'jetbrains-mono/jetbrains-mono-latin-500-normal.woff2'],
  ['@fontsource/jetbrains-mono', 'https://unpkg.com/@fontsource/jetbrains-mono@5.3.0/files/jetbrains-mono-latin-600-normal.woff2', 'jetbrains-mono/jetbrains-mono-latin-600-normal.woff2'],
  ['@fontsource/jetbrains-mono', 'https://unpkg.com/@fontsource/jetbrains-mono@5.3.0/files/jetbrains-mono-latin-700-normal.woff2', 'jetbrains-mono/jetbrains-mono-latin-700-normal.woff2'],
];

const grammarNames = [
  'python', 'javascript', 'typescript', 'tsx', 'go', 'rust', 'java', 'ruby', 'php',
  'c', 'cpp', 'c_sharp', 'swift', 'kotlin', 'scala', 'elixir', 'lua', 'bash',
];

for (const grammar of grammarNames) {
  assets.push([
    'tree-sitter-wasms',
    'https://cdn.jsdelivr.net/npm/tree-sitter-wasms@0.1.13/out/tree-sitter-' + grammar + '.wasm',
    'tree-sitter-wasms/tree-sitter-' + grammar + '.wasm',
  ]);
}

function packageByName(name) {
  return packages.find((entry) => entry.name === name);
}

function safeName(name) {
  return name.replace(/^@/, '').replaceAll('/', '-');
}

async function download(url) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error('Download failed (' + response.status + '): ' + url);
  return Buffer.from(await response.arrayBuffer());
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

const licenseFiles = new Map();
for (const dependency of packages) {
  const bytes = await download(dependency.licenseUrl);
  const relativePath = 'licenses/' + safeName(dependency.name) + '-LICENSE.txt';
  const target = join(vendorRoot, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
  licenseFiles.set(dependency.name, relativePath);
}

const manifestAssets = [];
for (const [packageName, source, relativePath] of assets) {
  const dependency = packageByName(packageName);
  const bytes = await download(source);
  const target = join(vendorRoot, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
  manifestAssets.push({
    package: packageName,
    version: dependency.version,
    file: relativePath,
    source,
    sha256: sha256(bytes),
  });
}

manifestAssets.sort((a, b) => a.file.localeCompare(b.file));
await writeFile(
  join(vendorRoot, 'manifest.json'),
  JSON.stringify({ version: 1, assets: manifestAssets }, null, 2) + '\n'
);

const noticeLines = [
  '# Third-party browser dependencies',
  '',
  'CodeFlow vendors these pinned browser assets so local analysis can start without network access.',
  'The exact source URL and SHA-256 digest for every distributed asset are recorded in `manifest.json`.',
  '',
  '| Package | Version | License | License text |',
  '| --- | --- | --- | --- |',
];
for (const dependency of packages) {
  noticeLines.push(
    '| `' + dependency.name + '` | `' + dependency.version + '` | ' + dependency.license +
      ' | [`' + licenseFiles.get(dependency.name) + '`](./' + licenseFiles.get(dependency.name) + ') |'
  );
}
noticeLines.push('', 'Regenerate the checked-in files with `node scripts/vendor-browser-deps.mjs`.', '');
await writeFile(join(vendorRoot, 'THIRD_PARTY_NOTICES.md'), noticeLines.join('\n'));

process.stdout.write('Vendored ' + manifestAssets.length + ' browser assets from ' + packages.length + ' packages.\n');
