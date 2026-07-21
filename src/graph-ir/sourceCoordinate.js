// Canonical source coordinate — MOO-68 Commit 1.
//
// The identity primitive every later layer (repository/file/function) and
// every later sub-issue (MOO-69/70/71) anchors nodes, edges, cache keys, and
// drill-down requests to. A coordinate names *where in a specific revision
// of a specific repository* something is — down to a scope chain, not just
// a short symbol name, so two functions named `run` in different classes
// (or the same class reopened in different files) never collide.
//
// Deliberately structured, not a delimited string: `encodeCoordinateToken`/
// `decodeCoordinateToken` exist specifically so routes and cache keys never
// need to split on a chosen delimiter character that a path, symbol name,
// or repo name could itself contain.

/**
 * @typedef {Object} RepositoryIdentity
 * @property {string} host - e.g. 'github.com'. Present (not assumed) so a
 *   coordinate is self-contained even outside a request that already knows
 *   the host.
 * @property {string} owner
 * @property {string} name
 */

/**
 * @typedef {Object} SourceRange
 * @property {number} startLine - 1-based, inclusive
 * @property {number} startColumn - 0-based, inclusive
 * @property {number} endLine - 1-based, inclusive
 * @property {number} endColumn - 0-based, exclusive
 */

/**
 * @typedef {'module'|'class'|'function'|'method'|'variable'|'unknown'} SymbolKind
 */

/**
 * @typedef {Object} SourceCoordinate
 * @property {RepositoryIdentity} repository
 * @property {string} revision - resolved commit SHA this coordinate is anchored to (never a branch name — see githubContext.js for ref resolution)
 * @property {string} path - repo-root-relative path, POSIX-normalized
 * @property {string[]} symbolPath - ordered enclosing-scope chain, outermost first; [] means module-level (the module itself, not a symbol within it)
 * @property {SymbolKind} symbolKind
 * @property {SourceRange|null} range - null when the coordinate is module-level with no specific range, or the range could not be resolved
 * @property {boolean} ambiguous - true when symbolPath/range could not be uniquely resolved (e.g. an unresolved import target); ambiguous coordinates must not be used as drill-down targets — see navigation.js
 */

const SYMBOL_KINDS = new Set(['module', 'class', 'function', 'method', 'variable', 'unknown']);

export class SourceCoordinateError extends Error {
  constructor(errors) {
    super('Invalid source coordinate:\n' + errors.map((e) => ' - ' + e).join('\n'));
    this.name = 'SourceCoordinateError';
    this.errors = errors;
  }
}

/**
 * Normalize a repo-relative path to a stable POSIX form: backslashes to
 * forward slashes, no leading './' or '/', no trailing slash, collapsed
 * repeated slashes. Does not resolve '..' segments — a coordinate's path is
 * expected to already be repo-root-relative, not an arbitrary filesystem
 * path that could escape the root (that containment guarantee belongs to
 * whatever fetched the file, e.g. server/lib/workspace.js).
 * @param {string} path
 * @returns {string}
 */
export function normalizePath(path) {
  if (typeof path !== 'string') return '';
  return path
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

function validate(coord) {
  const errors = [];
  const repo = coord.repository;
  if (!repo || typeof repo !== 'object') {
    errors.push('repository is required');
  } else {
    if (!repo.host) errors.push('repository.host is required');
    if (!repo.owner) errors.push('repository.owner is required');
    if (!repo.name) errors.push('repository.name is required');
  }
  if (!coord.revision || typeof coord.revision !== 'string') {
    errors.push('revision is required and must be a resolved commit SHA string');
  }
  if (typeof coord.path !== 'string') {
    errors.push('path is required (use "" only for a repository-level coordinate)');
  }
  if (!Array.isArray(coord.symbolPath) || coord.symbolPath.some((s) => typeof s !== 'string')) {
    errors.push('symbolPath must be an array of strings ([] for module scope)');
  }
  if (!SYMBOL_KINDS.has(coord.symbolKind)) {
    errors.push(`symbolKind must be one of ${[...SYMBOL_KINDS].join(', ')}, got: ${JSON.stringify(coord.symbolKind)}`);
  }
  if (coord.range !== null) {
    const r = coord.range;
    if (
      !r ||
      typeof r !== 'object' ||
      !Number.isInteger(r.startLine) ||
      !Number.isInteger(r.startColumn) ||
      !Number.isInteger(r.endLine) ||
      !Number.isInteger(r.endColumn)
    ) {
      errors.push('range must be null or {startLine,startColumn,endLine,endColumn} integers');
    }
  }
  if (typeof coord.ambiguous !== 'boolean') {
    errors.push('ambiguous must be a boolean');
  }
  return errors;
}

/**
 * Build and validate a SourceCoordinate. Throws SourceCoordinateError on any
 * missing/malformed field rather than silently producing a partial value —
 * every later contract (GraphIR nodes, cache keys, navigation events) relies
 * on coordinates being structurally complete.
 * @param {object} input
 * @param {RepositoryIdentity} input.repository
 * @param {string} input.revision
 * @param {string} input.path
 * @param {string[]} [input.symbolPath]
 * @param {SymbolKind} [input.symbolKind]
 * @param {SourceRange|null} [input.range]
 * @param {boolean} [input.ambiguous]
 * @returns {SourceCoordinate}
 */
export function makeCoordinate(input) {
  const coord = {
    repository: input && input.repository
      ? { host: input.repository.host, owner: input.repository.owner, name: input.repository.name }
      : undefined,
    revision: input ? input.revision : undefined,
    path: input ? normalizePath(input.path) : undefined,
    symbolPath: (input && input.symbolPath) || [],
    symbolKind: (input && input.symbolKind) || 'unknown',
    range: input && input.range !== undefined ? input.range : null,
    ambiguous: !!(input && input.ambiguous),
  };
  const errors = validate(coord);
  if (errors.length > 0) throw new SourceCoordinateError(errors);
  return Object.freeze({
    repository: Object.freeze({ ...coord.repository }),
    revision: coord.revision,
    path: coord.path,
    symbolPath: Object.freeze([...coord.symbolPath]),
    symbolKind: coord.symbolKind,
    range: coord.range ? Object.freeze({ ...coord.range }) : null,
    ambiguous: coord.ambiguous,
  });
}

/**
 * Canonical, key-order-stable JSON serialization — the basis for both
 * `encodeCoordinateToken` and coordinate equality/cache-key use. Object key
 * order is fixed explicitly (not left to insertion order) so two
 * differently-constructed-but-equal coordinates always serialize
 * byte-identical.
 * @param {SourceCoordinate} coord
 * @returns {string}
 */
export function serializeCoordinate(coord) {
  const errors = validate(coord);
  if (errors.length > 0) throw new SourceCoordinateError(errors);
  return JSON.stringify({
    repository: { host: coord.repository.host, owner: coord.repository.owner, name: coord.repository.name },
    revision: coord.revision,
    path: coord.path,
    symbolPath: coord.symbolPath,
    symbolKind: coord.symbolKind,
    range: coord.range
      ? {
          startLine: coord.range.startLine,
          startColumn: coord.range.startColumn,
          endLine: coord.range.endLine,
          endColumn: coord.range.endColumn,
        }
      : null,
    ambiguous: coord.ambiguous,
  });
}

/**
 * Inverse of serializeCoordinate. Throws SourceCoordinateError on malformed
 * JSON or a structurally invalid coordinate rather than returning null, so
 * callers (route parsing, cache lookups) get a clear failure instead of a
 * silently-wrong empty coordinate.
 * @param {string} json
 * @returns {SourceCoordinate}
 */
export function parseCoordinate(json) {
  let raw;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    throw new SourceCoordinateError([`not valid JSON: ${err.message}`]);
  }
  return makeCoordinate(raw);
}

/**
 * Base64url-encode a coordinate's canonical serialization — an opaque token
 * safe to embed as a single route segment or query value without any
 * delimiter ambiguity (no path characters, no reserved URL characters).
 * @param {SourceCoordinate} coord
 * @returns {string}
 */
export function encodeCoordinateToken(coord) {
  const json = serializeCoordinate(coord);
  return Buffer.from(json, 'utf8').toString('base64url');
}

/**
 * @param {string} token
 * @returns {SourceCoordinate}
 */
export function decodeCoordinateToken(token) {
  let json;
  try {
    json = Buffer.from(token, 'base64url').toString('utf8');
  } catch (err) {
    throw new SourceCoordinateError([`not a valid coordinate token: ${err.message}`]);
  }
  return parseCoordinate(json);
}

/**
 * Structural equality — two coordinates are the same identity iff their
 * canonical serializations match exactly (same repo, revision, path,
 * *full* symbolPath, kind, range, and ambiguity flag).
 * @param {SourceCoordinate} a
 * @param {SourceCoordinate} b
 * @returns {boolean}
 */
export function coordinatesEqual(a, b) {
  return serializeCoordinate(a) === serializeCoordinate(b);
}

/**
 * Human-readable label for breadcrumbs/UI/logs — e.g.
 * `octocat/Hello-World@abc1234:src/app.py#Service.run`. Not parseable back
 * into a coordinate on purpose (short names can collide); use
 * encodeCoordinateToken/parseCoordinate for anything round-tripped.
 * @param {SourceCoordinate} coord
 * @returns {string}
 */
export function describeCoordinate(coord) {
  const { repository, revision, path, symbolPath } = coord;
  const shortRev = revision.length > 12 ? revision.slice(0, 12) : revision;
  const base = `${repository.owner}/${repository.name}@${shortRev}`;
  const withPath = path ? `${base}:${path}` : base;
  return symbolPath.length > 0 ? `${withPath}#${symbolPath.join('.')}` : withPath;
}
