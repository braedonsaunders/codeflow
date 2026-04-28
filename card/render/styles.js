// Card style variants. Each style is a function that takes the same opts and
// returns an SVG string. Picked by the `style` input on the Action.

'use strict';

const { getTheme } = require('./theme.js');
const { sparkline } = require('./sparkline.js');

const ALL_STYLES = ['compact', 'row', 'minimal', 'hero', 'detailed'];

function escapeXml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function fmtNum(n) {
  if (n == null) return '—';
  if (typeof n !== 'number') return String(n);
  if (n >= 1_000_000) return Math.round(n / 100_000) / 10 + 'M';
  if (n >= 1_000) return Math.round(n / 100) / 10 + 'K';
  return String(n);
}

function gradeColor(theme, grade) {
  if (!grade) return theme.textDim;
  if (grade.startsWith('A')) return theme.green;
  if (grade.startsWith('B')) return theme.green;
  if (grade.startsWith('C')) return theme.amber;
  if (grade.startsWith('D')) return theme.amber;
  return theme.red;
}

function gradeArrow(curr, prev, theme) {
  if (!prev || !curr || curr === prev) return '';
  const order = ['F', 'D', 'C', 'B', 'A'];
  const ci = order.indexOf(curr[0]);
  const pi = order.indexOf(prev[0]);
  if (ci < 0 || pi < 0) return '';
  if (ci > pi) return '<tspan dx="6" font-size="14" fill="' + theme.green + '">▲</tspan>';
  if (ci < pi) return '<tspan dx="6" font-size="14" fill="' + theme.red + '">▼</tspan>';
  return '';
}

function svgWrap(width, height, theme, body, opts) {
  const rounded = opts && opts.radius != null ? opts.radius : 12;
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height +
    '" viewBox="0 0 ' + width + ' ' + height +
    '" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif">' +
    '<rect width="' + width + '" height="' + height + '" rx="' + rounded + '" fill="' + theme.bg + '" stroke="' + theme.border + '"/>' +
    body +
    '</svg>'
  );
}

const CODEFLOW_URL = 'https://github.com/braedonsaunders/codeflow';

function pinFooter(theme, x, y, showPin) {
  if (!showPin) return '';
  return (
    '<a href="' + CODEFLOW_URL + '" target="_blank">' +
    '<text x="' + x + '" y="' + y + '" text-anchor="end" font-size="9" fill="' + theme.textFaint + '">' +
    'powered by <tspan font-weight="600" fill="' + theme.accent + '">codeflow</tspan></text>' +
    '</a>'
  );
}

// ============================================================================
// Style: compact (default) — grade left, 4 scale stats right, single row
// ============================================================================

function renderCompact(opts) {
  const theme = getTheme(opts.theme, { accent: opts.accent });
  const snap = opts.snapshot;
  const prev = opts.prev;
  const repo = opts.repo || '';
  const sha = opts.sha ? opts.sha.slice(0, 7) : '';
  const showGrade = opts.showGrade !== false;
  const showScore = opts.showScore !== false && showGrade;
  const W = 720;
  const H = 140;
  const PAD = 18;

  const grade = snap.grade || '?';
  const score = typeof snap.score === 'number' ? snap.score : null;
  const color = gradeColor(theme, grade);
  const arrow = prev ? gradeArrow(grade, prev.grade, theme) : '';
  const history = (opts.history || []).concat([snap]);

  // When grade is hidden, we show 5 scale stats instead of 4 to fill the space.
  const stats = showGrade
    ? [
        { label: 'FILES', value: fmtNum(snap.files), key: 'files' },
        { label: 'FNS', value: fmtNum(snap.functions), key: 'functions' },
        { label: 'LOC', value: fmtNum(snap.loc), key: 'loc' },
        { label: 'LANGS', value: snap.languages, key: 'languages' },
      ]
    : [
        { label: 'FILES', value: fmtNum(snap.files), key: 'files' },
        { label: 'FNS', value: fmtNum(snap.functions), key: 'functions' },
        { label: 'LOC', value: fmtNum(snap.loc), key: 'loc' },
        { label: 'LANGS', value: snap.languages, key: 'languages' },
        { label: 'TESTS', value: snap.testFiles || 0, key: 'testFiles' },
      ];

  const gradeBoxW = showGrade ? 130 : 0;
  const statsAreaX = PAD + gradeBoxW + (showGrade ? 18 : 0);
  const statsAreaW = W - statsAreaX - PAD;
  const colW = statsAreaW / stats.length;

  const headerY = 26;
  const header =
    '<text x="' + PAD + '" y="' + headerY + '" font-size="13" font-weight="600" fill="' + theme.text + '">' + escapeXml(repo) + '</text>' +
    (sha ? '<text x="' + (W - PAD) + '" y="' + headerY + '" text-anchor="end" font-size="10" fill="' + theme.textFaint + '" font-family="ui-monospace,SFMono-Regular,Menlo,monospace">@' + escapeXml(sha) + '</text>' : '');

  const gradeBlock = showGrade
    ? '<g transform="translate(' + PAD + ',46)">' +
      '<text x="0" y="0" font-size="9" font-weight="600" fill="' + theme.textDim + '" letter-spacing="0.8">HEALTH</text>' +
      '<text x="0" y="58" font-size="56" font-weight="700" fill="' + color + '" font-family="ui-monospace,SFMono-Regular,Menlo,monospace">' + escapeXml(grade) + arrow + '</text>' +
      (showScore && score != null
        ? '<text x="84" y="58" font-size="20" font-weight="600" fill="' + theme.text + '">' + score + '</text>' +
          '<text x="84" y="74" font-size="8" fill="' + theme.textFaint + '" letter-spacing="0.6">/100</text>'
        : '') +
      '</g>'
    : '';

  const statCells = stats
    .map((s, i) => {
      const cx = statsAreaX + i * colW;
      const series = history.map((r) => r[s.key]).filter((v) => typeof v === 'number');
      const sp = series.length > 1 ? sparkline(series, { width: Math.min(64, colW - 12), height: 14, stroke: theme.spark, fill: theme.sparkBg }) : '';
      return (
        '<g transform="translate(' + cx + ',46)">' +
        '<text x="0" y="0" font-size="9" font-weight="600" fill="' + theme.textDim + '" letter-spacing="0.8">' + s.label + '</text>' +
        '<text x="0" y="28" font-size="22" font-weight="700" fill="' + theme.text + '">' + s.value + '</text>' +
        (sp ? '<g transform="translate(0,40)">' + sp + '</g>' : '') +
        '</g>'
      );
    })
    .join('');

  const footer = pinFooter(theme, W - PAD, H - 10, opts.pin !== false);

  return svgWrap(W, H, theme, header + gradeBlock + statCells + footer);
}

// ============================================================================
// Style: row — single horizontal status-bar
// ============================================================================

function renderRow(opts) {
  const theme = getTheme(opts.theme, { accent: opts.accent });
  const snap = opts.snapshot;
  const repo = opts.repo || '';
  const showGrade = opts.showGrade !== false;
  const showScore = opts.showScore !== false && showGrade;
  const W = 720;
  const H = 60;
  const PAD = 16;

  const grade = snap.grade || '?';
  const score = typeof snap.score === 'number' ? snap.score : null;
  const color = gradeColor(theme, grade);

  const gradePill = showGrade
    ? '<g transform="translate(' + PAD + ',16)">' +
      '<rect x="0" y="0" width="44" height="28" rx="6" fill="' + theme.accentSoft + '" stroke="' + color + '" stroke-width="1"/>' +
      '<text x="22" y="20" text-anchor="middle" font-size="16" font-weight="700" fill="' + color + '" font-family="ui-monospace,SFMono-Regular,Menlo,monospace">' + escapeXml(grade) + '</text>' +
      '</g>'
    : '';

  const repoX = showGrade ? PAD + 56 : PAD;
  const repoText =
    '<text x="' + repoX + '" y="36" font-size="13" font-weight="600" fill="' + theme.text + '">' + escapeXml(repo) + '</text>';

  const statsParts = [
    fmtNum(snap.files) + ' files',
    fmtNum(snap.functions) + ' fns',
    fmtNum(snap.loc) + ' LOC',
    snap.languages + ' langs',
  ];
  if (snap.testFiles) statsParts.push(snap.testFiles + ' tests');
  if (showScore && score != null) statsParts.push('score ' + score);
  const statsText = statsParts.join('  ·  ');

  const stats =
    '<text x="' + (W - PAD - 96) + '" y="36" text-anchor="end" font-size="11" fill="' + theme.textDim + '" font-family="ui-monospace,SFMono-Regular,Menlo,monospace">' + escapeXml(statsText) + '</text>';

  const pin = opts.pin !== false
    ? '<a href="' + CODEFLOW_URL + '" target="_blank">' +
      '<text x="' + (W - PAD) + '" y="36" text-anchor="end" font-size="10" fill="' + theme.textFaint + '">' +
      '<tspan font-weight="600" fill="' + theme.accent + '">codeflow</tspan></text>' +
      '</a>'
    : '';

  return svgWrap(W, H, theme, gradePill + repoText + stats + pin, { radius: 8 });
}

// ============================================================================
// Style: minimal — single text line, monospace
// ============================================================================

function renderMinimal(opts) {
  const theme = getTheme(opts.theme, { accent: opts.accent });
  const snap = opts.snapshot;
  const repo = opts.repo || '';
  const showGrade = opts.showGrade !== false;
  const W = 720;
  const H = 40;
  const PAD = 14;

  const grade = snap.grade || '?';
  const color = gradeColor(theme, grade);

  const gradeSpan = showGrade
    ? '<tspan fill="' + color + '" font-weight="700">' + escapeXml(grade) + '</tspan>' +
      '<tspan fill="' + theme.textFaint + '"> · </tspan>'
    : '';

  const line =
    '<text x="' + PAD + '" y="25" font-size="12" font-family="ui-monospace,SFMono-Regular,Menlo,monospace">' +
    '<tspan fill="' + theme.text + '">' + escapeXml(repo) + '</tspan>' +
    '<tspan fill="' + theme.textFaint + '"> · </tspan>' +
    gradeSpan +
    '<tspan fill="' + theme.text + '">' + fmtNum(snap.files) + '</tspan>' +
    '<tspan fill="' + theme.textDim + '"> files · </tspan>' +
    '<tspan fill="' + theme.text + '">' + fmtNum(snap.functions) + '</tspan>' +
    '<tspan fill="' + theme.textDim + '"> fns · </tspan>' +
    '<tspan fill="' + theme.text + '">' + fmtNum(snap.loc) + '</tspan>' +
    '<tspan fill="' + theme.textDim + '"> LOC · </tspan>' +
    '<tspan fill="' + theme.text + '">' + snap.languages + '</tspan>' +
    '<tspan fill="' + theme.textDim + '"> langs</tspan>' +
    '</text>' +
    (opts.pin !== false
      ? '<a href="' + CODEFLOW_URL + '" target="_blank">' +
        '<text x="' + (W - PAD) + '" y="25" text-anchor="end" font-size="10" fill="' + theme.accent + '" font-family="ui-monospace,SFMono-Regular,Menlo,monospace">codeflow</text>' +
        '</a>'
      : '');

  return svgWrap(W, H, theme, line, { radius: 6 });
}

// ============================================================================
// Style: hero — bigger, splashier, gradient
// ============================================================================

function renderHero(opts) {
  const theme = getTheme(opts.theme, { accent: opts.accent });
  const snap = opts.snapshot;
  const prev = opts.prev;
  const repo = opts.repo || '';
  const sha = opts.sha ? opts.sha.slice(0, 7) : '';
  const showGrade = opts.showGrade !== false;
  const showScore = opts.showScore !== false && showGrade;
  const W = 720;
  const H = 200;
  const PAD = 24;

  const grade = snap.grade || '?';
  const score = typeof snap.score === 'number' ? snap.score : null;
  const color = gradeColor(theme, grade);
  const arrow = prev ? gradeArrow(grade, prev.grade, theme) : '';

  const defs =
    '<defs>' +
    '<linearGradient id="herograd" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0%" stop-color="' + theme.accent + '" stop-opacity="0.18"/>' +
    '<stop offset="60%" stop-color="' + theme.accent + '" stop-opacity="0.04"/>' +
    '<stop offset="100%" stop-color="' + theme.bg + '" stop-opacity="0"/>' +
    '</linearGradient>' +
    '</defs>' +
    '<rect width="' + W + '" height="' + H + '" rx="14" fill="url(#herograd)"/>';

  const header =
    '<text x="' + PAD + '" y="32" font-size="9" font-weight="600" fill="' + theme.textDim + '" letter-spacing="1.2">' +
    (showGrade ? 'CODEFLOW · HEALTH REPORT' : 'CODEFLOW · CODEBASE OVERVIEW') + '</text>' +
    '<text x="' + PAD + '" y="56" font-size="20" font-weight="700" fill="' + theme.text + '">' + escapeXml(repo) + '</text>' +
    (sha ? '<text x="' + (W - PAD) + '" y="56" text-anchor="end" font-size="11" fill="' + theme.textFaint + '" font-family="ui-monospace,SFMono-Regular,Menlo,monospace">@' + escapeXml(sha) + '</text>' : '');

  const gradeBig = showGrade
    ? '<text x="' + PAD + '" y="148" font-size="92" font-weight="800" fill="' + color + '" font-family="ui-monospace,SFMono-Regular,Menlo,monospace">' + escapeXml(grade) + arrow + '</text>' +
      (showScore && score != null
        ? '<text x="' + (PAD + 110) + '" y="118" font-size="28" font-weight="700" fill="' + theme.text + '">' + score + '</text>' +
          '<text x="' + (PAD + 110) + '" y="138" font-size="10" fill="' + theme.textFaint + '" letter-spacing="0.8">SCORE / 100</text>'
        : '')
    : '';

  // Grid of stats. With grade hidden we expand to a wider 3x2 grid that takes
  // the whole card and keeps it informational.
  const grid = showGrade
    ? [
        { label: 'FILES', value: fmtNum(snap.files) },
        { label: 'FUNCTIONS', value: fmtNum(snap.functions) },
        { label: 'LINES OF CODE', value: fmtNum(snap.loc) },
        { label: 'LANGUAGES', value: snap.languages },
      ]
    : [
        { label: 'FILES', value: fmtNum(snap.files) },
        { label: 'FUNCTIONS', value: fmtNum(snap.functions) },
        { label: 'LINES OF CODE', value: fmtNum(snap.loc) },
        { label: 'LANGUAGES', value: snap.languages },
        { label: 'TEST FILES', value: snap.testFiles || 0 },
        { label: 'CONNECTIONS', value: fmtNum(snap.connections || 0) },
      ];
  const cols = showGrade ? 2 : 3;
  const cellW = showGrade ? 140 : 215;
  const cellH = 50;
  const gridX = showGrade ? W - PAD - cellW * cols : PAD;
  const gridY = showGrade ? 90 : 86;
  const gridSvg = grid
    .map((g, i) => {
      const cx = gridX + (i % cols) * cellW;
      const cy = gridY + Math.floor(i / cols) * cellH;
      return (
        '<g transform="translate(' + cx + ',' + cy + ')">' +
        '<text x="0" y="0" font-size="9" font-weight="600" fill="' + theme.textDim + '" letter-spacing="0.8">' + g.label + '</text>' +
        '<text x="0" y="22" font-size="20" font-weight="700" fill="' + theme.text + '">' + g.value + '</text>' +
        '</g>'
      );
    })
    .join('');

  const footer = pinFooter(theme, W - PAD, H - 14, opts.pin !== false);

  return svgWrap(W, H, theme, defs + header + gradeBig + gridSvg + footer, { radius: 16 });
}

// ============================================================================
// Style: detailed — original 4-panel renderer
// ============================================================================

function panelGradeDetailed(snap, prev, theme, x, y, width, opts) {
  const showScore = opts && opts.showScore !== false;
  const grade = snap.grade || '?';
  const score = typeof snap.score === 'number' ? snap.score : null;
  const color = gradeColor(theme, grade);
  const arrow = prev ? gradeArrow(grade, prev.grade, theme) : '';
  const prevLabel = prev && prev.grade && prev.grade !== grade ? '(was ' + escapeXml(prev.grade) + ')' : '';
  const h = 110;
  return {
    height: h,
    body:
      '<g transform="translate(' + x + ',' + y + ')">' +
      '<rect width="' + width + '" height="' + h + '" rx="10" fill="' + theme.bgAlt + '" stroke="' + theme.border + '"/>' +
      '<text x="16" y="22" font-size="11" font-weight="500" fill="' + theme.textDim + '" letter-spacing="0.6">HEALTH</text>' +
      '<text x="16" y="78" font-size="64" font-weight="700" fill="' + color + '" font-family="ui-monospace,SFMono-Regular,Menlo,monospace">' + escapeXml(grade) + arrow + '</text>' +
      (showScore && score != null
        ? '<text x="' + (width - 16) + '" y="78" text-anchor="end" font-size="22" font-weight="600" fill="' + theme.text + '">' + score + '</text>' +
          '<text x="' + (width - 16) + '" y="94" text-anchor="end" font-size="10" fill="' + theme.textFaint + '" letter-spacing="0.6">SCORE / 100</text>'
        : '') +
      (prevLabel ? '<text x="16" y="100" font-size="10" fill="' + theme.textFaint + '">' + prevLabel + '</text>' : '') +
      '</g>',
  };
}

function panelLanguagesDetailed(snap, theme, x, y, width) {
  const list = Array.isArray(snap.topLanguages) ? snap.topLanguages.slice(0, 5) : [];
  const headerH = 28;
  const rowH = 22;
  const h = headerH + Math.max(rowH * Math.min(list.length, 5), rowH) + 14;
  const palette = [theme.accent, theme.spark, theme.green, theme.amber, theme.textDim];

  let rows;
  if (list.length === 0) {
    rows = '<text x="16" y="' + (headerH + 18) + '" font-size="12" fill="' + theme.textFaint + '">No language stats.</text>';
  } else {
    rows = list
      .map((lang, i) => {
        const ry = headerH + 6 + i * rowH;
        const label = '.' + (lang.ext || '?');
        const pct = typeof lang.pct === 'number' ? lang.pct : 0;
        const barW = Math.max(2, Math.round((pct / 100) * (width - 220)));
        const barX = 80;
        const color = palette[i % palette.length];
        return (
          '<text x="16" y="' + (ry + 5) + '" font-size="11" font-weight="600" fill="' + theme.text + '" font-family="ui-monospace,SFMono-Regular,Menlo,monospace">' + escapeXml(label) + '</text>' +
          '<rect x="' + barX + '" y="' + (ry - 6) + '" width="' + (width - 220) + '" height="10" rx="2" fill="' + theme.border + '" opacity="0.5"/>' +
          '<rect x="' + barX + '" y="' + (ry - 6) + '" width="' + barW + '" height="10" rx="2" fill="' + color + '"/>' +
          '<text x="' + (width - 16) + '" y="' + (ry + 5) + '" text-anchor="end" font-size="11" font-weight="600" fill="' + theme.text + '" font-family="ui-monospace,SFMono-Regular,Menlo,monospace">' + pct + '%</text>'
        );
      })
      .join('');
  }
  return {
    height: h,
    body:
      '<g transform="translate(' + x + ',' + y + ')">' +
      '<rect width="' + width + '" height="' + h + '" rx="10" fill="' + theme.bgAlt + '" stroke="' + theme.border + '"/>' +
      '<text x="16" y="20" font-size="11" font-weight="500" fill="' + theme.textDim + '" letter-spacing="0.6">LANGUAGES</text>' +
      rows +
      '</g>',
  };
}

function panelComposition(snap, theme, x, y, width) {
  const items = [
    { label: 'CONNECTIONS', value: fmtNum(snap.connections || 0) },
    { label: 'TEST FILES', value: snap.testFiles || 0 },
    { label: 'FOLDERS', value: snap.folders || 0 },
    { label: 'AVG FN LINES', value: snap.avgFnLines || 0 },
    { label: 'LONGEST FN', value: snap.longestFn ? snap.longestFn + 'L' : '—' },
    { label: 'PATTERNS', value: snap.patterns || 0 },
  ];
  const h = 88;
  const cols = 3;
  const colW = (width - 32) / cols;
  const cells = items
    .map((item, i) => {
      const cx = 16 + (i % cols) * colW;
      const cy = 22 + Math.floor(i / cols) * 32;
      return (
        '<g transform="translate(' + cx + ',' + cy + ')">' +
        '<text x="0" y="0" font-size="9" font-weight="500" fill="' + theme.textDim + '" letter-spacing="0.6">' + item.label + '</text>' +
        '<text x="0" y="18" font-size="16" font-weight="700" fill="' + theme.text + '">' + escapeXml(item.value) + '</text>' +
        '</g>'
      );
    })
    .join('');
  return {
    height: h,
    body:
      '<g transform="translate(' + x + ',' + y + ')">' +
      '<rect width="' + width + '" height="' + h + '" rx="10" fill="' + theme.bgAlt + '" stroke="' + theme.border + '"/>' +
      cells +
      '</g>',
  };
}

function panelTopFolders(snap, theme, x, y, width) {
  const list = Array.isArray(snap.topFolders) ? snap.topFolders.slice(0, 5) : [];
  const headerH = 28;
  const rowH = 18;
  const h = headerH + Math.max(rowH * Math.min(list.length, 5), rowH) + 12;
  if (list.length === 0) {
    return {
      height: h,
      body:
        '<g transform="translate(' + x + ',' + y + ')">' +
        '<rect width="' + width + '" height="' + h + '" rx="10" fill="' + theme.bgAlt + '" stroke="' + theme.border + '"/>' +
        '<text x="16" y="20" font-size="11" font-weight="500" fill="' + theme.textDim + '" letter-spacing="0.6">TOP FOLDERS</text>' +
        '<text x="16" y="' + (headerH + 16) + '" font-size="12" fill="' + theme.textFaint + '">No folders found.</text>' +
        '</g>',
    };
  }
  const max = list[0].count;
  const rows = list
    .map((f, i) => {
      const ry = headerH + 6 + i * rowH;
      const barW = Math.max(2, Math.round((f.count / max) * (width - 220)));
      return (
        '<text x="16" y="' + (ry + 5) + '" font-size="11" fill="' + theme.text + '" font-family="ui-monospace,SFMono-Regular,Menlo,monospace">' + escapeXml(f.name || 'root') + '</text>' +
        '<rect x="120" y="' + (ry - 6) + '" width="' + (width - 220) + '" height="10" rx="2" fill="' + theme.border + '" opacity="0.5"/>' +
        '<rect x="120" y="' + (ry - 6) + '" width="' + barW + '" height="10" rx="2" fill="' + theme.spark + '"/>' +
        '<text x="' + (width - 16) + '" y="' + (ry + 5) + '" text-anchor="end" font-size="11" font-weight="600" fill="' + theme.text + '" font-family="ui-monospace,SFMono-Regular,Menlo,monospace">' + f.count + '</text>'
      );
    })
    .join('');
  return {
    height: h,
    body:
      '<g transform="translate(' + x + ',' + y + ')">' +
      '<rect width="' + width + '" height="' + h + '" rx="10" fill="' + theme.bgAlt + '" stroke="' + theme.border + '"/>' +
      '<text x="16" y="20" font-size="11" font-weight="500" fill="' + theme.textDim + '" letter-spacing="0.6">TOP FOLDERS · BY FILE COUNT</text>' +
      rows +
      '</g>',
  };
}

function panelScaleDetailed(snap, history, theme, x, y, width) {
  const items = [
    { label: 'FILES', value: snap.files, key: 'files' },
    { label: 'FNS', value: snap.functions, key: 'functions' },
    { label: 'LOC', value: snap.loc, key: 'loc' },
    { label: 'LANGS', value: snap.languages, key: 'languages' },
  ];
  const h = 88;
  const colW = (width - 32) / items.length;
  const cells = items
    .map((item, i) => {
      const cx = 16 + i * colW;
      const series = history.map((r) => r[item.key]).filter((v) => typeof v === 'number');
      const spark = series.length > 1 ? sparkline(series, { width: Math.min(80, colW - 16), height: 18, stroke: theme.spark, fill: theme.sparkBg }) : '';
      return (
        '<g transform="translate(' + cx + ',16)">' +
        '<text x="0" y="0" font-size="10" font-weight="500" fill="' + theme.textDim + '" letter-spacing="0.6">' + item.label + '</text>' +
        '<text x="0" y="28" font-size="22" font-weight="700" fill="' + theme.text + '">' + fmtNum(item.value) + '</text>' +
        (spark ? '<g transform="translate(0,38)">' + spark + '</g>' : '') +
        '</g>'
      );
    })
    .join('');
  return {
    height: h,
    body:
      '<g transform="translate(' + x + ',' + y + ')">' +
      '<rect width="' + width + '" height="' + h + '" rx="10" fill="' + theme.bgAlt + '" stroke="' + theme.border + '"/>' +
      cells +
      '</g>',
  };
}

function panelFragilityDetailed(snap, theme, x, y, width) {
  const list = Array.isArray(snap.fragility) ? snap.fragility.slice(0, 3) : [];
  const rowH = 18;
  const headerH = 28;
  const h = headerH + Math.max(rowH * 3, rowH * Math.max(list.length, 1)) + 12;
  let rows = '';
  if (list.length === 0) {
    rows = '<text x="16" y="' + (headerH + 16) + '" font-size="12" fill="' + theme.textFaint + '">No cross-file dependencies detected.</text>';
  } else {
    rows = list
      .map((f, i) => {
        const ry = headerH + 6 + i * rowH;
        const name = f.path.length > 48 ? '…' + f.path.slice(-47) : f.path;
        return (
          '<text x="16" y="' + ry + '" font-size="12" fill="' + theme.text + '" font-family="ui-monospace,SFMono-Regular,Menlo,monospace">' + escapeXml(name) + '</text>' +
          '<text x="' + (width - 16) + '" y="' + ry + '" text-anchor="end" font-size="12" font-weight="600" fill="' + theme.accent + '">' + f.direct + ' direct · ' + f.transitive + ' transitive</text>'
        );
      })
      .join('');
  }
  return {
    height: h,
    body:
      '<g transform="translate(' + x + ',' + y + ')">' +
      '<rect width="' + width + '" height="' + h + '" rx="10" fill="' + theme.bgAlt + '" stroke="' + theme.border + '"/>' +
      '<text x="16" y="20" font-size="11" font-weight="500" fill="' + theme.textDim + '" letter-spacing="0.6">FRAGILITY · TOP BLAST RADIUS</text>' +
      rows +
      '</g>',
  };
}

function panelHiddenCostsDetailed(snap, prev, theme, x, y, width) {
  const items = [
    { label: 'CIRCULAR DEPS', value: snap.circular, prev: prev ? prev.circular : null, lowerIsBetter: true },
    { label: 'DEAD CODE', value: snap.deadPct + '%', raw: snap.deadPct, prev: prev ? prev.deadPct : null, lowerIsBetter: true },
    { label: 'AVG COUPLING', value: snap.avgCoupling, prev: prev ? prev.avgCoupling : null, lowerIsBetter: true },
  ];
  const h = 70;
  const colW = (width - 32) / items.length;
  const cells = items
    .map((item, i) => {
      const cx = 16 + i * colW;
      let arrow = '';
      const curr = typeof item.raw === 'number' ? item.raw : item.value;
      if (item.prev != null && typeof curr === 'number' && curr !== item.prev) {
        const better = item.lowerIsBetter ? curr < item.prev : curr > item.prev;
        const sign = curr < item.prev ? '▼' : '▲';
        const color = better ? theme.green : theme.red;
        arrow = '<tspan dx="6" font-size="11" fill="' + color + '">' + sign + '</tspan>';
      }
      return (
        '<g transform="translate(' + cx + ',16)">' +
        '<text x="0" y="0" font-size="10" font-weight="500" fill="' + theme.textDim + '" letter-spacing="0.6">' + item.label + '</text>' +
        '<text x="0" y="28" font-size="20" font-weight="700" fill="' + theme.text + '">' + escapeXml(item.value) + arrow + '</text>' +
        '</g>'
      );
    })
    .join('');
  return {
    height: h,
    body:
      '<g transform="translate(' + x + ',' + y + ')">' +
      '<rect width="' + width + '" height="' + h + '" rx="10" fill="' + theme.bgAlt + '" stroke="' + theme.border + '"/>' +
      cells +
      '</g>',
  };
}

function renderDetailed(opts) {
  const theme = getTheme(opts.theme, { accent: opts.accent });
  const snap = opts.snapshot;
  const history = opts.history || [];
  const prev = opts.prev;
  const showGrade = opts.showGrade !== false;
  const showScore = opts.showScore !== false && showGrade;
  // Detailed always renders the full informational set unless `panels` was
  // overridden explicitly. The default is everything. Grade panel auto-drops
  // when `show-grade: false`.
  const DEFAULT_PANELS = ['grade', 'scale', 'languages', 'composition', 'top-folders', 'fragility', 'hidden-costs'];
  const requested = (opts.panels && opts.panels.length > 0) ? opts.panels : DEFAULT_PANELS;
  const panels = showGrade ? requested : requested.filter((p) => p !== 'grade' && p !== 'hidden-costs');
  const repo = opts.repo || '';
  const sha = opts.sha ? opts.sha.slice(0, 7) : '';
  const showPin = opts.pin !== false;

  const W = 720;
  const PAD = 22;
  const HEADER_H = 60;
  const PANEL_GAP = 14;
  const FOOTER_H = 36;
  const innerW = W - PAD * 2;

  const blocks = [];
  let cursorY = HEADER_H;

  for (const p of panels) {
    let panel = null;
    if (p === 'grade') panel = panelGradeDetailed(snap, prev, theme, PAD, cursorY, innerW, { showScore });
    else if (p === 'scale') panel = panelScaleDetailed(snap, history.concat([snap]), theme, PAD, cursorY, innerW);
    else if (p === 'languages') panel = panelLanguagesDetailed(snap, theme, PAD, cursorY, innerW);
    else if (p === 'composition') panel = panelComposition(snap, theme, PAD, cursorY, innerW);
    else if (p === 'top-folders') panel = panelTopFolders(snap, theme, PAD, cursorY, innerW);
    else if (p === 'fragility') panel = panelFragilityDetailed(snap, theme, PAD, cursorY, innerW);
    else if (p === 'hidden-costs') panel = panelHiddenCostsDetailed(snap, prev, theme, PAD, cursorY, innerW);
    if (!panel) continue;
    blocks.push(panel.body);
    cursorY += panel.height + PANEL_GAP;
  }

  const totalH = cursorY - PANEL_GAP + FOOTER_H + 10;
  const header =
    '<g transform="translate(' + PAD + ',26)">' +
    '<text x="0" y="0" font-size="18" font-weight="700" fill="' + theme.text + '">' + escapeXml(repo) + '</text>' +
    '<text x="' + innerW + '" y="0" text-anchor="end" font-size="11" fill="' + theme.textFaint + '" font-family="ui-monospace,SFMono-Regular,Menlo,monospace">' +
    (sha ? '@' + escapeXml(sha) : '') + '</text>' +
    '</g>';

  const footerY = totalH - 14;
  const updated = new Date().toISOString().slice(0, 10);
  const footer =
    '<g transform="translate(' + PAD + ',' + footerY + ')">' +
    '<text x="0" y="0" font-size="10" fill="' + theme.textFaint + '">updated ' + updated + '</text>' +
    (showPin
      ? '<a href="' + CODEFLOW_URL + '" target="_blank">' +
        '<text x="' + innerW + '" y="0" text-anchor="end" font-size="10" fill="' + theme.textFaint + '">powered by ' +
        '<tspan font-weight="600" fill="' + theme.accent + '">codeflow</tspan></text>' +
        '</a>'
      : '') +
    '</g>';

  return svgWrap(W, totalH, theme, header + blocks.join('') + footer, { radius: 14 });
}

// ============================================================================
// Dispatcher
// ============================================================================

const RENDERERS = {
  compact: renderCompact,
  row: renderRow,
  minimal: renderMinimal,
  hero: renderHero,
  detailed: renderDetailed,
};

function renderStyle(style, opts) {
  const r = RENDERERS[style] || RENDERERS.compact;
  return r(opts);
}

module.exports = { renderStyle, ALL_STYLES, escapeXml, fmtNum };
