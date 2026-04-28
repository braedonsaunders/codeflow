// Render the merged-PR "thermal receipt" SVG. Itemizes the merge as a
// shareable artifact.

'use strict';

const { getTheme } = require('./theme.js');
const { escapeXml } = require('./card.js');

function diff(curr, prev) {
  if (prev == null || curr == null) return null;
  if (typeof curr !== 'number' || typeof prev !== 'number') return null;
  const d = curr - prev;
  if (d === 0) return null;
  return d;
}

function fmtSigned(n, opts) {
  if (n == null) return '—';
  const sign = n > 0 ? '+' : '';
  const v = (opts && opts.suffix) ? sign + n + opts.suffix : sign + n;
  return v;
}

function arrow(n, lowerIsBetter, theme) {
  if (n == null || n === 0) return { sym: '', color: theme.textDim };
  const better = lowerIsBetter ? n < 0 : n > 0;
  return {
    sym: n < 0 ? '▼' : '▲',
    color: better ? theme.green : theme.red,
  };
}

function row(label, value, color, theme) {
  return { label, value, color: color || theme.text };
}

function renderReceipt(opts) {
  const theme = getTheme(opts.theme || 'dark');
  const snap = opts.snapshot;
  const prev = opts.previous;
  const repo = opts.repo || '';
  const pr = opts.pr || {};
  const actor = opts.actor || pr.actor || 'unknown';
  const number = pr.number ? '#' + pr.number : '';

  const dLoc = diff(snap.loc, prev && prev.loc);
  const dFns = diff(snap.functions, prev && prev.functions);
  const dDead = diff(snap.dead, prev && prev.dead);
  const dCirc = diff(snap.circular, prev && prev.circular);
  const dCoup = prev ? Math.round((snap.avgCoupling - prev.avgCoupling) * 10) / 10 : null;

  const rows = [];
  rows.push(row('PR', escapeXml(number + (actor ? '  @' + actor : '')), theme.text, theme));

  if (dLoc != null) {
    const a = arrow(dLoc, false, theme);
    rows.push(row('LOC', fmtSigned(dLoc), a.color, theme));
  } else {
    rows.push(row('LOC', String(snap.loc), theme.text, theme));
  }
  if (dFns != null) {
    const a = arrow(dFns, false, theme);
    rows.push(row('functions', fmtSigned(dFns), a.color, theme));
  } else {
    rows.push(row('functions', String(snap.functions), theme.text, theme));
  }
  if (dDead != null) {
    const a = arrow(dDead, true, theme);
    rows.push(row('dead code', fmtSigned(dDead), a.color, theme));
  }
  if (dCirc != null) {
    const a = arrow(dCirc, true, theme);
    rows.push(row('circular deps', fmtSigned(dCirc), a.color, theme));
  }
  if (dCoup != null && dCoup !== 0) {
    const a = arrow(dCoup, true, theme);
    rows.push(row('coupling', fmtSigned(dCoup), a.color, theme));
  }
  if (snap.topBlast) {
    const prevTop = prev && prev.topBlast ? prev.topBlast.total : null;
    const currTop = snap.topBlast.total;
    if (prevTop != null && currTop !== prevTop) {
      const a = arrow(currTop - prevTop, true, theme);
      rows.push(row('blast radius', prevTop + ' → ' + currTop + ' ' + a.sym, a.color, theme));
    } else {
      rows.push(row('blast radius', String(currTop), theme.text, theme));
    }
  }
  if (snap.grade) {
    if (prev && prev.grade && prev.grade !== snap.grade) {
      const order = ['F', 'D', 'C', 'B', 'A'];
      const better = order.indexOf(snap.grade[0]) > order.indexOf(prev.grade[0]);
      const color = better ? theme.green : theme.red;
      rows.push(row('health', prev.grade + ' → ' + snap.grade, color, theme));
    } else {
      rows.push(row('health', snap.grade, theme.text, theme));
    }
  }

  const W = 360;
  const PAD = 18;
  const headerH = 64;
  const rowH = 22;
  const footerH = 50;
  const totalH = headerH + rows.length * rowH + footerH;

  const dashes =
    '<line x1="' + PAD + '" x2="' + (W - PAD) + '" y1="0" y2="0" stroke="' + theme.border + '" stroke-dasharray="3 3"/>';

  const rowsSvg = rows
    .map((r, i) => {
      const y = headerH + i * rowH;
      return (
        '<text x="' + PAD + '" y="' + y + '" font-size="12" fill="' + theme.textDim + '" font-family="ui-monospace,SFMono-Regular,Menlo,monospace">' +
        escapeXml(r.label) +
        '</text>' +
        '<text x="' + (W - PAD) + '" y="' + y + '" text-anchor="end" font-size="12" font-weight="600" fill="' + r.color + '" font-family="ui-monospace,SFMono-Regular,Menlo,monospace">' +
        r.value +
        '</text>'
      );
    })
    .join('');

  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + totalH + '" viewBox="0 0 ' + W + ' ' + totalH + '" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif">' +
    '<rect width="' + W + '" height="' + totalH + '" rx="6" fill="' + theme.bg + '" stroke="' + theme.border + '"/>' +
    '<text x="' + W / 2 + '" y="26" text-anchor="middle" font-size="13" font-weight="700" fill="' + theme.accent + '" letter-spacing="2" font-family="ui-monospace,SFMono-Regular,Menlo,monospace">CODEFLOW RECEIPT</text>' +
    '<text x="' + W / 2 + '" y="44" text-anchor="middle" font-size="11" fill="' + theme.textFaint + '" font-family="ui-monospace,SFMono-Regular,Menlo,monospace">' + escapeXml(repo) + '</text>' +
    '<g transform="translate(0,' + (headerH - 12) + ')">' + dashes + '</g>' +
    rowsSvg +
    '<g transform="translate(0,' + (totalH - footerH + 12) + ')">' + dashes + '</g>' +
    '<text x="' + W / 2 + '" y="' + (totalH - 22) + '" text-anchor="middle" font-size="10" fill="' + theme.textFaint + '" font-family="ui-monospace,SFMono-Regular,Menlo,monospace">thank you for your merge</text>' +
    '<text x="' + W / 2 + '" y="' + (totalH - 8) + '" text-anchor="middle" font-size="9" fill="' + theme.textFaint + '">powered by codeflow</text>' +
    '</svg>'
  );
}

module.exports = { renderReceipt };
