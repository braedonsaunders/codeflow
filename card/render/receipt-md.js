// Markdown version of the merged-PR receipt. GitHub PR comments are markdown,
// so the comment uses this; the SVG variant is retained for future image use.

'use strict';

function diff(curr, prev) {
  if (prev == null || curr == null) return null;
  if (typeof curr !== 'number' || typeof prev !== 'number') return null;
  const d = curr - prev;
  if (d === 0) return null;
  return d;
}

function fmtSigned(n) {
  if (n == null) return '—';
  return (n > 0 ? '+' : '') + n;
}

function dirArrow(n, lowerIsBetter) {
  if (n == null || n === 0) return '';
  const better = lowerIsBetter ? n < 0 : n > 0;
  const sym = n < 0 ? '▼' : '▲';
  return better ? ' :small_blue_diamond: ' + sym : ' :warning: ' + sym;
}

function gradeArrow(curr, prev) {
  if (!curr || !prev || curr === prev) return '';
  const order = ['F', 'D', 'C', 'B', 'A'];
  const c = order.indexOf(curr[0]);
  const p = order.indexOf(prev[0]);
  if (c > p) return ' ▲';
  if (c < p) return ' ▼';
  return '';
}

function renderReceiptMarkdown(opts) {
  const snap = opts.snapshot;
  const prev = opts.previous;
  const repo = opts.repo || '';
  const pr = opts.pr || {};
  const actor = opts.actor || pr.actor || '';
  const number = pr.number ? '#' + pr.number : '';

  const lines = [];
  lines.push('```');
  lines.push('--- CODEFLOW RECEIPT ---');
  if (number || actor) {
    lines.push('PR ' + number + (actor ? '  @' + actor : ''));
  }
  if (repo) lines.push(repo);
  lines.push('--------------------------');

  const dLoc = diff(snap.loc, prev && prev.loc);
  const dFns = diff(snap.functions, prev && prev.functions);
  const dDead = diff(snap.dead, prev && prev.dead);
  const dCirc = diff(snap.circular, prev && prev.circular);

  function pushRow(label, value) {
    const labelPad = label.padEnd(14, ' ');
    lines.push(labelPad + value);
  }

  if (dLoc != null) pushRow('LOC', fmtSigned(dLoc));
  else pushRow('LOC', String(snap.loc));
  if (dFns != null) pushRow('functions', fmtSigned(dFns));
  else pushRow('functions', String(snap.functions));
  if (dDead != null) pushRow('dead code', fmtSigned(dDead));
  if (dCirc != null) pushRow('circular deps', fmtSigned(dCirc));

  if (snap.topBlast) {
    if (prev && prev.topBlast && prev.topBlast.total !== snap.topBlast.total) {
      const d = snap.topBlast.total - prev.topBlast.total;
      pushRow('blast radius', prev.topBlast.total + ' → ' + snap.topBlast.total + (d < 0 ? ' ▼' : ' ▲'));
    } else {
      pushRow('blast radius', String(snap.topBlast.total));
    }
  }
  if (snap.grade) {
    if (prev && prev.grade && prev.grade !== snap.grade) {
      pushRow('health', prev.grade + ' → ' + snap.grade + gradeArrow(snap.grade, prev.grade));
    } else {
      pushRow('health', snap.grade);
    }
  }

  lines.push('--------------------------');
  lines.push('   thank you for your merge');
  lines.push('```');
  lines.push('');
  lines.push('_powered by [codeflow](https://github.com/braedonsaunders/codeflow)_');
  return lines.join('\n');
}

module.exports = { renderReceiptMarkdown };
