// GitHub-backed analysis pipeline — MOO-67 Commit 6.
//
// Fetches a repository (at a resolved ref: default branch, an explicit
// branch/commit, or a PR's head SHA) via the GitHub REST API using the
// server-held token, then runs it through the same analyzer everything
// else uses. Reuses GitHub/Parser/shouldExcludeFile/buildAnalysisData from
// src/analyzer.js rather than writing a second GitHub client or a second
// exclude-matching implementation.
//
// Deliberately does NOT reuse GitHub.scanTree/getFile as-is: both are
// hardcoded to the repository's default branch (no ref parameter), which
// is exactly the gap this commit needs to close ("validate repository,
// branch, commit, and PR inputs" implies actually fetching at that ref,
// not silently falling back to default). Fetches by blob SHA (from the
// resolved ref's tree) instead of the Contents API's own ref resolution,
// which also sidesteps needing to export more analyzer-internal URL
// helpers just for this.
if (!('TreeSitter' in globalThis)) globalThis.TreeSitter = undefined;
if (!('Babel' in globalThis)) globalThis.Babel = undefined;
if (!('acorn' in globalThis)) globalThis.acorn = undefined;

const { GitHub, Parser, shouldExcludeFile, shouldIgnoreDirectory, buildAnalysisData } = await import('../../src/analyzer.js');

const GITHUB_API = 'https://api.github.com';

export class GithubFetchError extends Error {
  constructor(message, { status } = {}) {
    super(message);
    this.name = 'GithubFetchError';
    this.status = status;
  }
}

async function apiRequest(path, errorMap) {
  // GitHub.request() (shared with the browser) throws a plain Error using
  // errorMap's messages, not GithubFetchError — wrap it so every failure
  // from an actual GitHub call is identifiable as such by the route
  // handler (which maps GithubFetchError to a 502, distinct from a real
  // internal 500). Found this the hard way: a genuinely-expected condition
  // (a PR's fork commit had been deleted/garbage-collected upstream) was
  // surfacing as a generic "Analysis failed" 500 instead of a clear 502
  // with GitHub's own "not found" message, because the thrown Error
  // wasn't an instanceof GithubFetchError.
  try {
    return await GitHub.request(GITHUB_API + path, {}, errorMap);
  } catch (err) {
    throw new GithubFetchError(err.message);
  }
}

/**
 * Resolves which {owner, repo, ref} to actually fetch a tree from.
 *
 * PRs need special handling: a PR's head commit usually lives in a fork
 * (head.repo.full_name != the base owner/repo the caller asked about, e.g.
 * "octocat/Hello-World" PR #10590's head SHA only exists in
 * "angelg84/Hello-World"'s object database). Fetching the base repo's tree
 * API for a fork's SHA 404s -- confirmed against a real forked PR while
 * verifying this endpoint, not assumed. The base repo being allowlisted is
 * still the operative access check: the caller asked for a specific PR
 * *of* that allowlisted repo, and GitHub's own PR data is what tells us
 * which fork/SHA that resolves to.
 */
async function resolveRef({ owner, repo, ref, pr }) {
  if (pr != null) {
    const prData = await apiRequest(`/repos/${owner}/${repo}/pulls/${pr}`, {
      404: 'Pull request not found',
    });
    const headRepo = prData.head && prData.head.repo;
    if (!headRepo) {
      throw new GithubFetchError('Pull request head repository is inaccessible (fork may have been deleted)');
    }
    return { owner: headRepo.owner.login, repo: headRepo.name, ref: prData.head.sha };
  }
  if (ref) return { owner, repo, ref };
  const repoData = await apiRequest(`/repos/${owner}/${repo}`, {
    404: 'Repository not found',
  });
  return { owner, repo, ref: repoData.default_branch || 'main' };
}

async function fetchTree({ owner, repo, resolvedRef, maxRepoFiles }) {
  const data = await apiRequest(
    `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(resolvedRef)}?recursive=1`,
    { 404: 'Ref not found (branch, commit, or PR head does not exist)' }
  );
  if (!data.tree) throw new GithubFetchError('Invalid tree response from GitHub');

  const files = [];
  for (const entry of data.tree) {
    if (entry.type !== 'blob') continue;
    const name = entry.path.includes('/') ? entry.path.slice(entry.path.lastIndexOf('/') + 1) : entry.path;
    const folder = entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : 'root';
    const pathParts = entry.path.split('/');
    const ignored = pathParts.slice(0, -1).some((part, idx) => {
      const dirPath = pathParts.slice(0, idx + 1).join('/');
      return shouldIgnoreDirectory(dirPath, part, []);
    });
    if (ignored) continue;
    if (shouldExcludeFile(entry.path, name, [])) continue;
    files.push({ path: entry.path, name, folder, sha: entry.sha, isCode: Parser.isCode(name) });
  }

  if (files.length > maxRepoFiles) {
    throw new GithubFetchError(
      `Repository has ${files.length} analyzable files, over the configured limit of ${maxRepoFiles}. ` +
        'Point at a narrower ref, or raise MAX_REPO_FILES if this is expected.'
    );
  }
  return files;
}

async function fetchBlobContent(owner, repo, sha) {
  const data = await apiRequest(`/repos/${owner}/${repo}/git/blobs/${sha}`, {
    404: 'Blob not found',
  });
  if (data.encoding === 'base64') return Buffer.from(data.content, 'base64').toString('utf8');
  return data.content || '';
}

/** Fetch blob contents with limited concurrency — avoid firing hundreds of requests at once. */
async function fetchAllContents(owner, repo, files, concurrency = 8) {
  const results = new Array(files.length);
  let next = 0;
  async function worker() {
    while (next < files.length) {
      const i = next++;
      results[i] = await fetchBlobContent(owner, repo, files[i].sha);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));
  return results;
}

/**
 * @param {{owner: string, repo: string, ref: string|null, pr: number|null}} request
 * @param {{githubToken: string, maxRepoFiles: number}} config
 */
export async function analyzeGithubRepo(request, config) {
  GitHub.token = config.githubToken;

  const { owner, repo, ref: resolvedRef } = await resolveRef(request);
  const files = await fetchTree({ owner, repo, resolvedRef, maxRepoFiles: config.maxRepoFiles });
  const contents = await fetchAllContents(owner, repo, files);

  const analyzed = [];
  const allFns = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const content = contents[i] || '';
    const layer = Parser.detectLayer(file.path);
    const isContainer = Parser.isScriptContainer(file.path);
    const actualIsCode = file.isCode !== false && (!isContainer || Parser.hasEmbeddedCode(content, file.path));
    const functions = actualIsCode ? Parser.extract(content, file.path) : [];
    analyzed.push({
      path: file.path,
      name: file.name,
      folder: file.folder,
      content,
      functions,
      lines: content ? content.split('\n').length : 0,
      layer,
      churn: 0,
      isCode: actualIsCode,
    });
    if (actualIsCode) {
      for (const fn of functions) allFns.push({ ...fn, folder: file.folder, layer });
    }
  }

  const result = await buildAnalysisData({
    analyzed,
    allFns,
    excludePatterns: [],
    progress() {},
    yieldFn: async () => {},
  });

  return { result, resolvedRef, fileCount: files.length };
}
