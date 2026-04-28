// Tiny inline SVG sparkline. No external lib.

'use strict';

function sparkline(values, opts) {
  const o = opts || {};
  const width = o.width || 80;
  const height = o.height || 18;
  const stroke = o.stroke || '#a78bfa';
  const fill = o.fill || 'rgba(167,139,250,0.18)';
  if (!Array.isArray(values) || values.length === 0) {
    return '<svg width="' + width + '" height="' + height + '"></svg>';
  }
  const data = values.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0));
  if (data.length === 1) data.unshift(data[0]);
  let min = Math.min.apply(null, data);
  let max = Math.max.apply(null, data);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const range = max - min;
  const stepX = data.length > 1 ? width / (data.length - 1) : width;
  const points = data.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / range) * height;
    return [Math.round(x * 100) / 100, Math.round(y * 100) / 100];
  });
  const linePath = points
    .map((p, i) => (i === 0 ? 'M' + p[0] + ' ' + p[1] : 'L' + p[0] + ' ' + p[1]))
    .join(' ');
  const areaPath =
    linePath +
    ' L' +
    points[points.length - 1][0] +
    ' ' +
    height +
    ' L' +
    points[0][0] +
    ' ' +
    height +
    ' Z';
  return (
    '<svg width="' +
    width +
    '" height="' +
    height +
    '" viewBox="0 0 ' +
    width +
    ' ' +
    height +
    '" preserveAspectRatio="none">' +
    '<path d="' +
    areaPath +
    '" fill="' +
    fill +
    '" stroke="none"/>' +
    '<path d="' +
    linePath +
    '" fill="none" stroke="' +
    stroke +
    '" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>'
  );
}

module.exports = { sparkline };
