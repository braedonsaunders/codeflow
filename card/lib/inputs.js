// Read GitHub Actions inputs (INPUT_<UPPERCASE_NAME>) and provide a
// process.env-friendly fallback for local dry-runs.

'use strict';

function readInput(name, defaultValue) {
  const envKey = 'INPUT_' + name.toUpperCase().replace(/-/g, '_');
  const v = process.env[envKey];
  if (v === undefined || v === '') return defaultValue;
  return v;
}

function asBool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return /^(true|1|yes|on)$/i.test(String(value).trim());
}

function asInt(value, fallback) {
  const n = parseInt(String(value), 10);
  return Number.isFinite(n) ? n : fallback;
}

function asList(value, fallback) {
  if (!value) return fallback;
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function loadInputs() {
  const output = readInput('output', '.github/codeflow-card.svg');
  const state = readInput('state', '.github/codeflow-card.json');
  const theme = readInput('theme', 'dark');
  const panels = asList(readInput('panels', ''), ['grade', 'scale', 'fragility', 'hidden-costs']);
  const receipts = asBool(readInput('receipts', ''), false);
  const sparklineWindow = asInt(readInput('sparkline-window', ''), 30);
  const pin = asBool(readInput('pin', ''), true);
  const commitMessage = readInput('commit-message', 'chore: update codeflow card [skip ci]');
  const commitAuthorName = readInput('commit-author-name', 'codeflow-card[bot]');
  const commitAuthorEmail = readInput(
    'commit-author-email',
    'codeflow-card[bot]@users.noreply.github.com'
  );
  const token = readInput('github-token', process.env.GITHUB_TOKEN || '');
  return {
    output,
    state,
    theme,
    panels,
    receipts,
    sparklineWindow,
    pin,
    commitMessage,
    commitAuthorName,
    commitAuthorEmail,
    token,
  };
}

module.exports = { loadInputs };
