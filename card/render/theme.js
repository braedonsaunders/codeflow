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

function getTheme(name) {
  if (name === 'light') return LIGHT;
  return DARK;
}

module.exports = { getTheme, DARK, LIGHT };
