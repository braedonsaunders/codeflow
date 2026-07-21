// Repository allowlist — MOO-67 Commit 6.
//
// A second, independent gate beyond the auth token: even a valid caller
// can only analyze repositories the operator has explicitly approved,
// either by exact owner/repo, by whole owner/org, or (ALLOWED_OWNERS
// containing the literal "*") any owner at all -- an explicit opt-in to
// "any public repo is fair game," not the default. The auth token remains
// the primary gate on who can reach this endpoint in the first place; the
// wildcard just stops restricting *which* repos they can point it at.
export const WILDCARD = '*';

/** @param {{allowedRepos: string[], allowedOwners: string[]}} config */
export function isRepoAllowed(owner, repo, config) {
  if (config.allowedOwners.includes(WILDCARD)) return true;
  const ownerLower = owner.toLowerCase();
  const repoKey = `${ownerLower}/${repo.toLowerCase()}`;
  return config.allowedOwners.includes(ownerLower) || config.allowedRepos.includes(repoKey);
}
