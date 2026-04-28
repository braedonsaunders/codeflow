// Read/write the JSON history file that powers sparklines and deltas.

'use strict';

const fs = require('fs');
const path = require('path');

function readState(statePath) {
  try {
    const raw = fs.readFileSync(statePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.runs)) return parsed;
  } catch {
    // missing or corrupt — start fresh
  }
  return { version: 1, runs: [] };
}

function appendRun(state, snapshot, windowSize) {
  const runs = state.runs.slice();
  runs.push(snapshot);
  if (runs.length > windowSize) runs.splice(0, runs.length - windowSize);
  return { version: 1, runs };
}

function writeState(statePath, state) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');
}

function topBlasts(data, calcBlast, n) {
  if (!data || !Array.isArray(data.files) || typeof calcBlast !== 'function') return [];
  const ranked = [];
  for (const file of data.files) {
    if (!file.isCode) continue;
    let blast;
    try {
      blast = calcBlast(file.path, data.connections, data.files);
    } catch {
      continue;
    }
    const direct = (blast && blast.count) || 0;
    const transitive = (blast && blast.transitiveCount) || 0;
    const total = direct + transitive;
    if (total === 0) continue;
    ranked.push({ path: file.path, direct, transitive, total });
  }
  ranked.sort((a, b) => b.total - a.total);
  return ranked.slice(0, n);
}

function snapshotFromAnalysis(data, helpers, ctx) {
  const stats = (data && data.stats) || {};
  const calcBlast = helpers.calcBlast;
  const calcHealth = helpers.calcHealth;

  let health = null;
  if (typeof calcHealth === 'function') {
    try {
      health = calcHealth(data);
    } catch {
      health = null;
    }
  }
  const grade = health ? health.grade : null;
  const score = health ? health.score : null;

  const fragility = topBlasts(data, calcBlast, 3);

  // Hidden costs
  const issues = Array.isArray(data && data.issues) ? data.issues : [];
  const circular = issues.filter((i) => i && i.title && i.title.includes('Circular')).length;
  const avgCoupling = stats.files > 0 ? stats.connections / stats.files : 0;

  const languageList = Array.isArray(stats.languages) ? stats.languages : [];

  return {
    at: new Date().toISOString(),
    sha: ctx.sha || null,
    pr: ctx.pr || null,
    actor: ctx.actor || null,
    files: stats.files || 0,
    functions: stats.functions || 0,
    loc: stats.loc || 0,
    languages: languageList.length,
    topLanguages: languageList.slice(0, 3).map((l) => ({ ext: l.ext, pct: l.pct })),
    dead: stats.dead || 0,
    deadPct: stats.functions ? Math.round((stats.dead / stats.functions) * 1000) / 10 : 0,
    circular,
    avgCoupling: Math.round(avgCoupling * 10) / 10,
    securityIssues: stats.security || 0,
    grade,
    score,
    topBlast: fragility[0] || null,
    fragility,
  };
}

module.exports = { readState, appendRun, writeState, snapshotFromAnalysis, topBlasts };
