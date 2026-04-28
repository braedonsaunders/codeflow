// Color tokens. Codeflow's site uses a dark indigo/purple palette; we mirror
// those values so the card looks like family.

'use strict';

const DARK = {
  bg: '#0d1117',
  bgAlt: '#161b22',
  border: '#21262d',
  text: '#e6edf3',
  textDim: '#8b949e',
  textFaint: '#6e7681',
  accent: '#a78bfa', // codeflow purple
  accentSoft: 'rgba(167,139,250,0.16)',
  green: '#3fb950',
  amber: '#d29922',
  red: '#f85149',
  spark: '#a78bfa',
  sparkBg: 'rgba(167,139,250,0.18)',
};

const LIGHT = {
  bg: '#ffffff',
  bgAlt: '#f6f8fa',
  border: '#d0d7de',
  text: '#1f2328',
  textDim: '#656d76',
  textFaint: '#8c959f',
  accent: '#6f42c1',
  accentSoft: 'rgba(111,66,193,0.12)',
  green: '#1a7f37',
  amber: '#9a6700',
  red: '#cf222e',
  spark: '#6f42c1',
  sparkBg: 'rgba(111,66,193,0.12)',
};

// Named accent presets. Users can also pass any hex/CSS color directly.
const ACCENT_PRESETS = {
  purple: { dark: '#a78bfa', light: '#6f42c1' },
  teal:   { dark: '#5eead4', light: '#0d9488' },
  cyan:   { dark: '#67e8f9', light: '#0891b2' },
  green:  { dark: '#86efac', light: '#16a34a' },
  pink:   { dark: '#f9a8d4', light: '#db2777' },
  blue:   { dark: '#93c5fd', light: '#2563eb' },
  amber:  { dark: '#fcd34d', light: '#d97706' },
  red:    { dark: '#fca5a5', light: '#dc2626' },
};

function withAlpha(hex, alpha) {
  // Takes a #RRGGBB hex and returns rgba(r,g,b,a). Supports #RGB shorthand.
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  let r, g, b;
  if (m[1].length === 3) {
    r = parseInt(m[1][0] + m[1][0], 16);
    g = parseInt(m[1][1] + m[1][1], 16);
    b = parseInt(m[1][2] + m[1][2], 16);
  } else {
    r = parseInt(m[1].slice(0, 2), 16);
    g = parseInt(m[1].slice(2, 4), 16);
    b = parseInt(m[1].slice(4, 6), 16);
  }
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

function resolveAccent(value, mode) {
  if (!value) return null;
  const preset = ACCENT_PRESETS[String(value).toLowerCase()];
  if (preset) return preset[mode] || preset.dark;
  return value; // assume CSS color
}

function getTheme(name, opts) {
  if (name === 'auto') return getAutoTheme(opts);
  const base = name === 'light' ? Object.assign({}, LIGHT) : Object.assign({}, DARK);
  const accent = opts && opts.accent ? resolveAccent(opts.accent, name === 'light' ? 'light' : 'dark') : null;
  if (accent) {
    base.accent = accent;
    base.accentSoft = withAlpha(accent, name === 'light' ? 0.12 : 0.16);
    base.spark = accent;
    base.sparkBg = withAlpha(accent, name === 'light' ? 0.12 : 0.18);
  }
  return base;
}

// In auto mode, every theme value resolves to a CSS `var(--cf-*)` reference.
// styles.js detects `theme._auto` and injects a <style> block defining those
// variables for both color schemes, so a single SVG file adapts to the
// viewer's system theme.
const VAR_REFS = {
  bg:         'var(--cf-bg)',
  bgAlt:      'var(--cf-bg-alt)',
  border:     'var(--cf-border)',
  text:       'var(--cf-text)',
  textDim:    'var(--cf-text-dim)',
  textFaint:  'var(--cf-text-faint)',
  accent:     'var(--cf-accent)',
  accentSoft: 'var(--cf-accent-soft)',
  green:      'var(--cf-green)',
  amber:      'var(--cf-amber)',
  red:        'var(--cf-red)',
  spark:      'var(--cf-spark)',
  sparkBg:    'var(--cf-spark-bg)',
};

function buildAutoPalette(base, accent, mode) {
  const out = Object.assign({}, base);
  if (accent) {
    const a = resolveAccent(accent, mode);
    if (a) {
      out.accent = a;
      out.accentSoft = withAlpha(a, mode === 'light' ? 0.12 : 0.16);
      out.spark = a;
      out.sparkBg = withAlpha(a, mode === 'light' ? 0.12 : 0.18);
    }
  }
  return out;
}

function getAutoTheme(opts) {
  const accent = opts && opts.accent ? opts.accent : null;
  const refs = Object.assign({}, VAR_REFS);
  refs._auto = true;
  refs._dark = buildAutoPalette(DARK, accent, 'dark');
  refs._light = buildAutoPalette(LIGHT, accent, 'light');
  return refs;
}

module.exports = { getTheme, DARK, LIGHT, ACCENT_PRESETS };
