// Minimal route persistence — MOO-67 Commit 4D.
//
// Narrow, mechanical extraction of the URL read/write logic that already
// existed scattered across App() (buildAppUrl, the query-param read effect,
// and two window.history.replaceState call sites) into one module. Scope
// is deliberately bounded to the repository view only — reading/writing
// which repo (and whether to auto-run) the current URL names. It does NOT
// restore active view, panel, selection, or drill-down state; canonical
// source coordinates, breadcrumb payloads, and repository -> file
// drill-down route semantics belong to MOO-68, not here.
//
// `baseHref`/`search` parameters are optional and default to the real
// window.location — passing them explicitly makes buildRepoUrl/
// readRouteRepo callable from a plain Node test without a DOM, which
// src/analyzer.js, src/render/repositoryGraph.js, and src/state/
// selection.js didn't need (they're inherently DOM/React-coupled) but
// this module's logic is pure enough to be worth it.

const REPO_PATTERN = /^[a-zA-Z0-9_./-]+$/;
const REPO_MAX_LENGTH = 200;

function currentHref() {
  return typeof window !== 'undefined' ? window.location.href : '';
}

function currentSearch() {
  return typeof window !== 'undefined' ? window.location.search : '';
}

function currentPathname() {
  return typeof window !== 'undefined' ? window.location.pathname : '';
}

/**
 * Build the URL for a given repo (and optionally auto-run) — used both for
 * the shareable-link copy feature and for updating the address bar after a
 * repository loads. Same logic as the original inline buildAppUrl.
 */
export function buildRepoUrl(repo, autoRun, baseHref) {
  const url = new URL(baseHref || currentHref());
  url.search = '';
  if (repo) url.searchParams.set('repo', repo);
  if (autoRun && repo) url.searchParams.set('run', '1');
  return url.toString();
}

/**
 * Read the current URL's repo context, validated the same way the
 * original inline effect validated it (length cap, no `{`, restricted
 * character set — the same guard against reflecting malformed/hostile
 * query values back into the repo-input field).
 * Returns null if there's no valid repo param.
 */
export function readRouteRepo(search) {
  const params = new URLSearchParams(search != null ? search : currentSearch());
  const repo = params.get('repo');
  const autoRun = params.get('run') === '1';
  if (repo && repo.length < REPO_MAX_LENGTH && !repo.includes('{') && REPO_PATTERN.test(repo)) {
    return { repo, autoRun };
  }
  return null;
}

/** Update the address bar to reflect the currently loaded repo, without navigating. */
export function writeRepoRoute(repo) {
  if (typeof window === 'undefined') return;
  window.history.replaceState({}, '', buildRepoUrl(repo, false));
}

/** Clear the repo context from the address bar (back to the bare path). */
export function clearRoute() {
  if (typeof window === 'undefined') return;
  window.history.replaceState({}, '', currentPathname());
}
