// Source of truth for markdown link extraction. Mirror into index.html's
// `Parser.extractMarkdownLinks` and `Parser.resolveMarkdownLink`. If you edit
// one, edit the other — the copy lives inside a single-file static app.

export function extractMarkdownLinks(content) {
  if (!content) return [];
  // Strip fenced code blocks (backtick + tilde) and inline code.
  const stripped = content
    .replace(/```[\s\S]*?```/g, '')
    .replace(/~~~[\s\S]*?~~~/g, '')
    .replace(/`[^`\n]*`/g, '');
  const links = [];

  // Wiki-link: [[Target]] | [[Target|alias]] | [[Target#heading]] | [[Target#heading|alias]]
  // Capture the bare target (before #heading and |alias).
  const wikiRe = /\[\[([^\]|#]+?)(?:#[^\]|]*)?(?:\|[^\]]+)?\]\]/g;
  let m;
  while ((m = wikiRe.exec(stripped)) !== null) {
    links.push({ kind: 'wikilink', raw: m[0], target: m[1].trim() });
  }

  // Markdown link: [text](url "optional title").
  // Text may contain one level of nested brackets: [foo [bar] baz](url).
  // Reject external schemes, anchor-only, and image links (preceded by `!`).
  const mdRe = /(!?)\[((?:[^\[\]]|\[[^\[\]]*\])*)\]\(([^)\s]+?)(?:\s+"[^"]*")?\)/g;
  while ((m = mdRe.exec(stripped)) !== null) {
    if (m[1] === '!') continue; // image
    const url = m[3].trim();
    if (!url) continue;
    if (/^(?:https?:|mailto:|ftp:|file:|tel:|#)/i.test(url)) continue;
    const clean = url.split('#')[0].split('?')[0];
    if (!clean) continue;
    links.push({ kind: 'mdlink', raw: m[0], target: url });
  }
  return links;
}

export function resolveMarkdownLink(rawTarget, fromPath, allPaths, kind) {
  if (!rawTarget) return null;
  const allLower = allPaths.map(p => p.toLowerCase());

  function findExact(candidate) {
    const c = candidate.toLowerCase();
    const i = allLower.indexOf(c);
    return i >= 0 ? allPaths[i] : null;
  }
  function findWithMd(candidate) {
    const hit = findExact(candidate);
    if (hit) return hit;
    if (!/\.(md|markdown)$/i.test(candidate)) {
      const mdHit = findExact(candidate + '.md');
      if (mdHit) return mdHit;
      return findExact(candidate + '.markdown');
    }
    return null;
  }

  // For md-links, resolve relative to fromPath first.
  if (kind === 'mdlink') {
    const cleanTarget = rawTarget.split('#')[0].split('?')[0];
    let resolved;
    if (cleanTarget.startsWith('/')) {
      resolved = cleanTarget.slice(1);
    } else {
      const fromDir = fromPath.includes('/')
        ? fromPath.split('/').slice(0, -1).join('/')
        : '';
      const parts = (fromDir ? fromDir.split('/') : []).concat(cleanTarget.split('/'));
      const out = [];
      for (const p of parts) {
        if (p === '' || p === '.') continue;
        if (p === '..') { out.pop(); continue; }
        out.push(p);
      }
      resolved = out.join('/');
    }
    const direct = findWithMd(resolved);
    if (direct) return direct;
    // Fall through to basename match.
  }

  // Wikilink or md-link fallback: basename match (case-insensitive).
  const baseName = rawTarget.split('#')[0].split('?')[0].split('/').pop();
  if (!baseName) return null;
  for (let i = 0; i < allPaths.length; i++) {
    const pname = allPaths[i].split('/').pop().toLowerCase();
    if (/\.(md|markdown)$/i.test(baseName)) {
      if (pname === baseName.toLowerCase()) return allPaths[i];
    } else if (pname === baseName.toLowerCase() + '.md' || pname === baseName.toLowerCase() + '.markdown') {
      return allPaths[i];
    }
  }
  return null;
}
