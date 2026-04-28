// Render the SVG card. Single-file; no external libs.

'use strict';

const { getTheme } = require('./theme.js');
const { sparkline } = require('./sparkline.js');

const W = 720;
const PAD = 22;
const HEADER_H = 60;
const PANEL_GAP = 14;
const FOOTER_H = 36;

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
  if (n >= 1_000_000) return (Math.round(n / 100_000) / 10) + 'M';
  if (n >= 1_000) return (Math.round(n / 100) / 10) + 'K';
  return String(n);
}

function delta(curr, prev) {
  if (prev == null || curr == null) return null;
  if (curr === prev) return null;
  return { dir: curr > prev ? 'up' : 'down', from: prev, to: curr };
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

// ---------------- panels ----------------

function panelGrade(snap, prev, theme, x, y, width) {
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
      '<text x="16" y="78" font-size="64" font-weight="700" fill="' + color + '" font-family="ui-monospace,SFMono-Regular,Menlo,monospace">' +
      escapeXml(grade) + arrow + '</text>' +
      (score != null
        ? '<text x="' + (width - 16) + '" y="78" text-anchor="end" font-size="22" font-weight="600" fill="' + theme.text + '">' + score + '</text>' +
          '<text x="' + (width - 16) + '" y="94" text-anchor="end" font-size="10" fill="' + theme.textFaint + '" letter-spacing="0.6">SCORE / 100</text>'
        : '') +
      (prevLabel
        ? '<text x="16" y="100" font-size="10" fill="' + theme.textFaint + '">' + prevLabel + '</text>'
        : '') +
      '</g>',
  };
}

function panelScale(snap, history, theme, x, y, width) {
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

function panelFragility(snap, theme, x, y, width) {
  const list = Array.isArray(snap.fragility) ? snap.fragility.slice(0, 3) : [];
  const rowH = 18;
  const headerH = 28;
  const h = headerH + Math.max(rowH * 3, rowH * Math.max(list.length, 1)) + 12;
  let rows = '';
  if (list.length === 0) {
    rows =
      '<text x="16" y="' + (headerH + 16) + '" font-size="12" fill="' + theme.textFaint + '">No cross-file dependencies detected.</text>';
  } else {
    rows = list
      .map((f, i) => {
        const ry = headerH + 6 + i * rowH;
        const name = f.path.length > 48 ? '…' + f.path.slice(-47) : f.path;
        return (
          '<text x="16" y="' + ry + '" font-size="12" fill="' + theme.text + '" font-family="ui-monospace,SFMono-Regular,Menlo,monospace">' +
          escapeXml(name) + '</text>' +
          '<text x="' + (width - 16) + '" y="' + ry + '" text-anchor="end" font-size="12" font-weight="600" fill="' + theme.accent + '">' +
          f.direct + ' direct · ' + f.transitive + ' transitive</text>'
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

function panelHiddenCosts(snap, prev, theme, x, y, width) {
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

// ---------------- main ----------------

function renderCard(opts) {
  const theme = getTheme(opts.theme || 'dark');
  const snap = opts.snapshot;
  const history = opts.history || [];
  const prev = history.length > 0 ? history[history.length - 1] : null;
  const panels = opts.panels || ['grade', 'scale', 'fragility', 'hidden-costs'];
  const repo = opts.repo || '';
  const sha = opts.sha ? opts.sha.slice(0, 7) : '';
  const showPin = opts.pin !== false;

  const innerW = W - PAD * 2;

  const blocks = [];
  let cursorY = HEADER_H;

  function add(panel) {
    if (!panel) return;
    blocks.push(panel.body);
    cursorY += panel.height + PANEL_GAP;
  }

  for (const p of panels) {
    if (p === 'grade') add(panelGrade(snap, prev, theme, PAD, cursorY, innerW));
    else if (p === 'scale') add(panelScale(snap, history.concat([snap]), theme, PAD, cursorY, innerW));
    else if (p === 'fragility') add(panelFragility(snap, theme, PAD, cursorY, innerW));
    else if (p === 'hidden-costs') add(panelHiddenCosts(snap, prev, theme, PAD, cursorY, innerW));
  }

  const totalH = cursorY - PANEL_GAP + FOOTER_H + 10;

  const header =
    '<g transform="translate(' + PAD + ',26)">' +
    '<text x="0" y="0" font-size="18" font-weight="700" fill="' + theme.text + '">' + escapeXml(repo || 'codeflow card') + '</text>' +
    '<text x="' + innerW + '" y="0" text-anchor="end" font-size="11" fill="' + theme.textFaint + '" font-family="ui-monospace,SFMono-Regular,Menlo,monospace">' +
    (sha ? '@' + escapeXml(sha) : '') + '</text>' +
    '</g>';

  const footerY = totalH - 14;
  const updated = new Date().toISOString().slice(0, 10);
  const footer =
    '<g transform="translate(' + PAD + ',' + footerY + ')">' +
    '<text x="0" y="0" font-size="10" fill="' + theme.textFaint + '">updated ' + updated + '</text>' +
    (showPin
      ? '<text x="' + innerW + '" y="0" text-anchor="end" font-size="10" fill="' + theme.textFaint + '">powered by ' +
        '<tspan font-weight="600" fill="' + theme.accent + '">codeflow</tspan></text>'
      : '') +
    '</g>';

  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + totalH + '" viewBox="0 0 ' + W + ' ' + totalH + '" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif">' +
    '<rect width="' + W + '" height="' + totalH + '" rx="14" fill="' + theme.bg + '" stroke="' + theme.border + '"/>' +
    header +
    blocks.join('') +
    footer +
    '</svg>'
  );
}

module.exports = { renderCard, escapeXml, fmtNum };
