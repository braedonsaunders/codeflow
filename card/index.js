// CodeFlow Card — GitHub Action entry point.
// Reads codeflow's analyzer out of index.html, runs it on the consuming repo,
// renders an SVG card, optionally posts a PR receipt comment, then commits the
// updated card + history file back to the repo.

'use strict';

const fs = require('fs');
const path = require('path');

const { loadInputs } = require('./lib/inputs.js');
const { loadAnalyzer, locateIndexHtml } = require('./lib/analyzer.js');
const { buildAnalyzed } = require('./lib/collect.js');
const { readState, appendRun, writeState, snapshotFromAnalysis } = require('./lib/state.js');
const { renderCard } = require('./render/card.js');
const { renderReceiptMarkdown } = require('./render/receipt-md.js');
const { commitAndPush } = require('./lib/git.js');
const { upsertStickyComment } = require('./lib/pr.js');

function log(msg) {
  process.stdout.write('[codeflow-card] ' + msg + '\n');
}

function loadEvent() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !fs.existsSync(eventPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(eventPath, 'utf8'));
  } catch {
    return null;
  }
}

function repoSlug() {
  return process.env.GITHUB_REPOSITORY || '';
}

function repoOwnerName() {
  const slug = repoSlug();
  if (!slug.includes('/')) return [null, null];
  return slug.split('/');
}

async function run() {
  const inputs = loadInputs();
  const repoRoot = process.env.GITHUB_WORKSPACE || process.cwd();
  log('analyzing ' + repoRoot);

  const actionDir = __dirname;
  const indexHtmlPath = locateIndexHtml(actionDir, repoRoot);
  log('analyzer source: ' + indexHtmlPath);

  const { Parser, buildAnalysisData, calcBlast, calcHealth } = loadAnalyzer(indexHtmlPath);

  const { analyzed, allFns } = await buildAnalyzed(repoRoot, Parser);
  log('collected ' + analyzed.length + ' files (' + allFns.length + ' functions)');

  const data = await buildAnalysisData({
    analyzed,
    allFns,
    excludePatterns: [],
    progress: () => {},
    yieldFn: async () => {},
  });
  log('analysis: files=' + data.stats.files + ' fns=' + data.stats.functions + ' loc=' + data.stats.loc);

  const event = loadEvent();
  const sha = process.env.GITHUB_SHA || null;
  const actor = process.env.GITHUB_ACTOR || null;
  const prNumber =
    (event && event.pull_request && event.pull_request.number) ||
    (event && event.number) ||
    null;
  const ctx = { sha, actor, pr: prNumber };

  const snapshot = snapshotFromAnalysis(data, { calcBlast, calcHealth }, ctx);
  log('grade=' + (snapshot.grade || '?') + ' score=' + (snapshot.score == null ? '?' : snapshot.score));

  const stateAbs = path.resolve(repoRoot, inputs.state);
  const state = readState(stateAbs);
  const previous = state.runs.length > 0 ? state.runs[state.runs.length - 1] : null;

  // Render card SVG.
  const slug = repoSlug();
  const svg = renderCard({
    snapshot,
    history: state.runs,
    theme: inputs.theme,
    panels: inputs.panels,
    repo: slug,
    sha: sha,
    pin: inputs.pin,
  });
  const outAbs = path.resolve(repoRoot, inputs.output);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  fs.writeFileSync(outAbs, svg);
  log('wrote card → ' + path.relative(repoRoot, outAbs));

  // Append snapshot to state.
  const updatedState = appendRun(state, snapshot, inputs.sparklineWindow);
  writeState(stateAbs, updatedState);
  log('wrote state → ' + path.relative(repoRoot, stateAbs));

  // Receipt comment (opt-in, only on merged PRs).
  const isMergedPR =
    !!event && event.pull_request && event.pull_request.merged === true && prNumber != null;
  if (inputs.receipts && isMergedPR && inputs.token) {
    try {
      const [owner, name] = repoOwnerName();
      if (owner && name) {
        const body = renderReceiptMarkdown({
          snapshot,
          previous,
          repo: slug,
          pr: { number: prNumber, actor: event.pull_request.user && event.pull_request.user.login },
          actor,
        });
        await upsertStickyComment({
          token: inputs.token,
          owner,
          repo: name,
          issueNumber: prNumber,
          body,
        });
        log('posted receipt comment to PR #' + prNumber);
      }
    } catch (e) {
      log('receipt post failed: ' + (e.message || e));
    }
  } else if (inputs.receipts) {
    log('receipts enabled, but not a merged PR — skipping');
  }

  // Commit changes back to the repo (skip when running outside a checkout).
  if (process.env.GITHUB_ACTIONS === 'true') {
    try {
      const result = commitAndPush({
        cwd: repoRoot,
        paths: [path.relative(repoRoot, outAbs), path.relative(repoRoot, stateAbs)],
        message: inputs.commitMessage,
        authorName: inputs.commitAuthorName,
        authorEmail: inputs.commitAuthorEmail,
        push: !isMergedPR && (process.env.GITHUB_REF_TYPE === 'branch' || (process.env.GITHUB_REF || '').startsWith('refs/heads/')),
      });
      log('git: ' + (result.committed ? 'committed' : 'no changes (' + result.reason + ')'));
    } catch (e) {
      log('git commit failed: ' + (e.message || e));
    }
  } else {
    log('local mode — skipping git commit');
  }
}

run().catch((err) => {
  process.stderr.write('[codeflow-card] error: ' + (err.stack || err.message || err) + '\n');
  process.exit(1);
});
