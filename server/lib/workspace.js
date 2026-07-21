// Request-scoped workspace abstraction — MOO-67 Commit 5.
//
// A single controlled root (WORKSPACE_ROOT), one normalized subdirectory
// per request, and a cleanup hook. Exists so the later pyan3 (MOO-70) and
// CodeVisualizer (MOO-71) analyzers have one shared place to stage fetched
// source and intermediate artifacts, instead of each inventing its own
// temporary-directory convention.
import { mkdir, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export class WorkspaceManager {
  constructor(root) {
    this.root = resolve(root);
  }

  /** Fail fast at startup if the root can't actually be created/written to. */
  async ensureRoot() {
    await mkdir(this.root, { recursive: true });
    const probe = join(this.root, '.write-check-' + Date.now());
    await mkdir(probe, { recursive: true });
    await rm(probe, { recursive: true, force: true });
  }

  /**
   * @param {string} requestId
   * @returns {Promise<{dir: string, resolve: (relativePath: string) => string, cleanup: () => Promise<void>}>}
   */
  async createRequestWorkspace(requestId) {
    if (!requestId || !SAFE_ID_PATTERN.test(requestId)) {
      throw new Error('createRequestWorkspace requires a requestId matching ' + SAFE_ID_PATTERN);
    }
    const dir = join(this.root, requestId);
    await mkdir(dir, { recursive: true });
    return {
      dir,
      resolve: (relativePath) => resolveWithin(dir, relativePath),
      cleanup: () => rm(dir, { recursive: true, force: true }),
    };
  }
}

function resolveWithin(base, relativePath) {
  const target = resolve(base, relativePath);
  if (target !== base && !target.startsWith(base + sep)) {
    throw new Error(`Path escapes workspace root: ${relativePath}`);
  }
  return target;
}
