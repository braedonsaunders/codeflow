// Repository/branch/commit/PR input validation — MOO-67 Commit 6.
//
// Runs before the allowlist check and before any source retrieval — a
// malformed request should never reach GitHub or the analyzer. Patterns
// are deliberately conservative (narrower than GitHub actually allows in
// some cases) since the cost of rejecting a rare valid name is low and the
// cost of building a URL from an unvalidated string is not.
const OWNER_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/;
const REPO_PATTERN = /^[a-zA-Z0-9._-]{1,100}$/;
const REF_PATTERN = /^[a-zA-Z0-9._\/-]{1,200}$/;

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

function validateOwner(owner) {
  if (typeof owner !== 'string' || !OWNER_PATTERN.test(owner)) {
    throw new ValidationError('owner must be a valid GitHub username/org (alphanumeric and hyphens, max 39 chars)');
  }
}

function validateRepo(repo) {
  if (typeof repo !== 'string' || !REPO_PATTERN.test(repo) || repo === '.' || repo === '..') {
    throw new ValidationError('repo must be a valid GitHub repository name (alphanumeric, dots, hyphens, underscores, max 100 chars)');
  }
}

function validateRef(ref) {
  if (typeof ref !== 'string' || !REF_PATTERN.test(ref) || ref.includes('..') || ref.startsWith('/') || ref.startsWith('-')) {
    throw new ValidationError('ref must be a valid branch name or commit SHA');
  }
}

function validatePr(pr) {
  if (!Number.isInteger(pr) || pr <= 0 || pr > 1_000_000) {
    throw new ValidationError('pr must be a positive integer');
  }
}

/**
 * @param {object} body
 * @returns {{owner: string, repo: string, ref: string|null, pr: number|null}}
 * @throws {ValidationError}
 */
export function validateRepoRequest(body) {
  if (!body || typeof body !== 'object') {
    throw new ValidationError('request body must be a JSON object');
  }
  const { owner, repo, ref, pr } = body;
  validateOwner(owner);
  validateRepo(repo);

  if (ref != null && pr != null) {
    throw new ValidationError('specify at most one of "ref" or "pr", not both');
  }
  if (ref != null) validateRef(ref);
  if (pr != null) validatePr(pr);

  return { owner, repo, ref: ref ?? null, pr: pr ?? null };
}
