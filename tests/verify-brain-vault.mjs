// End-to-end verification: run the same extractor pipeline Phase 2.5 runs in
// index.html, against the real Brain vault, and emit the same export shape
// that exportJSON produces. Proves the parser works on the real-world fixture.

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractMarkdownLinks, resolveMarkdownLink } from './md-extractors.mjs';

const IGNORE = new Set(['node_modules', '.git', '.obsidian', '__pycache__', '.DS_Store']);

function walk(root, base = root, out = []) {
  for (const name of readdirSync(root)) {
    if (IGNORE.has(name)) continue;
    const full = join(root, name);
    const s = statSync(full);
    if (s.isDirectory()) walk(full, base, out);
    else if (s.isFile()) out.push(relative(base, full).split(sep).join('/'));
  }
  return out;
}

function analyzeVault(vaultPath) {
  const paths = walk(vaultPath).sort();
  const mdPaths = paths.filter(p => /\.(md|markdown)$/i.test(p));
  const analyzed = paths.map(p => ({
    path: p,
    name: p.split('/').pop(),
    content: readFileSync(join(vaultPath, p), 'utf8'),
    functions: [],
    dependencies: [],
    layer: 'utils',
    lines: 0,
  }));
  analyzed.forEach(f => { f.lines = f.content.split('\n').length; });
  const conns = [];
  const allPaths = analyzed.map(f => f.path);
  analyzed.forEach(file => {
    if (!/\.(md|markdown)$/i.test(file.name)) return;
    const links = extractMarkdownLinks(file.content);
    const deps = [];
    for (const link of links) {
      const resolved = resolveMarkdownLink(link.target, file.path, allPaths, link.kind);
      deps.push({ kind: link.kind, raw: link.raw, target: link.target, resolved });
      if (resolved && resolved !== file.path) {
        conns.push({ source: file.path, target: resolved, fn: link.raw, count: 1, kind: link.kind });
      }
    }
    file.dependencies = deps;
    file.layer = 'note';
  });
  return { analyzed, conns, mdPaths };
}

function exportShape(analyzed, conns) {
  return {
    stats: { files: analyzed.length, connections: conns.length },
    files: analyzed.map(f => ({
      path: f.path,
      fns: f.functions.length,
      layer: f.layer,
      lines: f.lines,
      dependencies: f.dependencies || [],
    })),
    connections: conns,
  };
}

const DEFAULT_BRAIN_VAULT = '/Users/malcolm/Documents/Claude/Projects/Brain';
const FIXTURE_VAULT = fileURLToPath(new URL('./fixtures/vault', import.meta.url));

function resolveTargets() {
  const targets = [{ label: 'Test fixtures', path: FIXTURE_VAULT }];
  if (process.env.BRAIN_VAULT) {
    if (!existsSync(process.env.BRAIN_VAULT)) {
      throw new Error(`BRAIN_VAULT does not exist: ${process.env.BRAIN_VAULT}`);
    }
    targets.unshift({ label: 'Brain vault', path: process.env.BRAIN_VAULT });
    return targets;
  }
  if (existsSync(DEFAULT_BRAIN_VAULT)) {
    targets.unshift({ label: 'Brain vault', path: DEFAULT_BRAIN_VAULT });
  }
  return targets;
}

const targets = resolveTargets();

let outPath = process.env.OUT || '/tmp/codeflow-verify.json';
const results = {};

for (const t of targets) {
  const r = analyzeVault(t.path);
  const exp = exportShape(r.analyzed, r.conns);
  const wiki = r.conns.filter(c => c.kind === 'wikilink');
  const md = r.conns.filter(c => c.kind === 'mdlink');
  const totalLinks = r.analyzed.reduce((s, f) => s + (f.dependencies?.length || 0), 0);
  const resolvedLinks = r.analyzed.reduce(
    (s, f) => s + (f.dependencies?.filter(d => d.resolved).length || 0), 0);
  results[t.label] = {
    vault: t.path,
    mdFiles: r.mdPaths.length,
    totalLinks,
    resolvedLinks,
    wikilinkEdges: wiki.length,
    mdlinkEdges: md.length,
    sampleWikilink: wiki[0] || null,
    sampleMdlink: md[0] || null,
    export: exp,
  };
}

writeFileSync(outPath, JSON.stringify(results, null, 2));

for (const [label, r] of Object.entries(results)) {
  console.log(`\n=== ${label} (${r.vault}) ===`);
  console.log(`  .md files scanned: ${r.mdFiles}`);
  console.log(`  links extracted:   ${r.totalLinks}`);
  console.log(`  links resolved:    ${r.resolvedLinks}`);
  console.log(`  wikilink edges:    ${r.wikilinkEdges}`);
  console.log(`  mdlink edges:      ${r.mdlinkEdges}`);
  if (r.sampleWikilink) {
    console.log(`  sample wikilink:   ${r.sampleWikilink.source} -> ${r.sampleWikilink.target} (${r.sampleWikilink.fn})`);
  }
  if (r.sampleMdlink) {
    console.log(`  sample mdlink:     ${r.sampleMdlink.source} -> ${r.sampleMdlink.target} (${r.sampleMdlink.fn})`);
  }
}
console.log(`\nFull report written to ${outPath}`);
