// Repository allowlist — MOO-67 Commit 6.
//
// A second, independent gate beyond the auth token: even a valid caller
// can only analyze repositories the operator has explicitly approved,
// either by exact owner/repo or by whole owner/org.
/** @param {{allowedRepos: string[], allowedOwners: string[]}} config */
export function isRepoAllowed(owner, repo, config) {
  const ownerLower = owner.toLowerCase();
  const repoKey = `${ownerLower}/${repo.toLowerCase()}`;
  return config.allowedOwners.includes(ownerLower) || config.allowedRepos.includes(repoKey);
}
