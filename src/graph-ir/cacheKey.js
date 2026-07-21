// Cache identity and provenance display — MOO-68 Commit 6.
//
// One rule for turning a request into a cache key, shared by every layer,
// so MOO-72's eventual centralized cache has a single key format to store
// against instead of each layer adapter inventing its own. Two normalized
// requests that mean the same thing must produce byte-identical keys;
// anything that changes what was actually analyzed (revision, analyzer
// version, schema version, depth/reduction options, or the requested
// coordinate) must change the key.
import { createHash } from 'node:crypto';
import { contextIdentityKey } from './githubContext.js';
import { encodeCoordinateToken } from './sourceCoordinate.js';

/**
 * Recursively sort object keys so structurally-equal inputs always
 * stringify identically regardless of construction/insertion order.
 * @param {*} value
 * @returns {*}
 */
function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortKeysDeep(value[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * @typedef {Object} CacheKeyInput
 * @property {import('./githubContext.js').AnalysisContext} context
 * @property {string} analyzerName
 * @property {string} analyzerVersion
 * @property {number} graphSchemaVersion
 * @property {import('./sourceCoordinate.js').SourceCoordinate|null} [coordinate] - the specific requested coordinate (e.g. which file/function); null for a whole-repository request
 * @property {number|null} [depth] - drill-down/reduction depth, when the layer supports one
 * @property {object} [options] - any other layer-specific request options that affect output (e.g. reduction thresholds)
 */

/**
 * Build a stable cache key. Deliberately hashed (sha256) rather than a raw
 * concatenated string: request option objects can be arbitrarily shaped
 * per layer, and hashing the canonicalized JSON sidesteps needing every
 * layer's options to individually avoid a delimiter character the way
 * sourceCoordinate.js's encodeCoordinateToken does for a single string
 * field.
 * @param {CacheKeyInput} input
 * @returns {string}
 */
export function buildCacheKey(input) {
  if (!input || !input.context) throw new TypeError('buildCacheKey requires a context');
  if (!input.analyzerName || !input.analyzerVersion) throw new TypeError('buildCacheKey requires analyzerName and analyzerVersion');
  if (!Number.isInteger(input.graphSchemaVersion)) throw new TypeError('buildCacheKey requires an integer graphSchemaVersion');

  const payload = sortKeysDeep({
    context: contextIdentityKey(input.context),
    analyzerName: input.analyzerName,
    analyzerVersion: input.analyzerVersion,
    graphSchemaVersion: input.graphSchemaVersion,
    coordinate: input.coordinate ? encodeCoordinateToken(input.coordinate) : null,
    depth: input.depth != null ? input.depth : null,
    options: input.options || {},
  });
  const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return `graphir:v${input.graphSchemaVersion}:${hash}`;
}

/**
 * Whether a cached entry should be treated as stale and re-derived rather
 * than served. Schema mismatch always wins (an older-schema cache entry is
 * never valid for a newer consumer, regardless of age); otherwise falls
 * back to a caller-supplied TTL, which is optional — some layers may want
 * revision-pinned entries to simply never expire on time alone.
 * @param {object} entry
 * @param {number} entry.cachedSchemaVersion
 * @param {string} entry.cachedAt - ISO 8601 timestamp
 * @param {object} [options]
 * @param {number} [options.currentSchemaVersion]
 * @param {number} [options.ttlMs]
 * @param {number} [options.now] - epoch ms, defaults to Date.now()
 * @returns {boolean}
 */
export function isCacheStale(entry, options = {}) {
  const currentSchemaVersion = options.currentSchemaVersion;
  if (currentSchemaVersion != null && entry.cachedSchemaVersion !== currentSchemaVersion) return true;
  if (options.ttlMs == null) return false;
  const now = options.now != null ? options.now : Date.now();
  const cachedAtMs = Date.parse(entry.cachedAt);
  return now - cachedAtMs > options.ttlMs;
}

/**
 * @typedef {Object} ProvenanceSummary
 * @property {string} analyzerName
 * @property {string} analyzerVersion
 * @property {number} schemaVersion
 * @property {string} generatedAt
 * @property {number} resolvedSymbolCount - nodes with a non-null, non-ambiguous coordinate
 * @property {number} unresolvedSymbolCount - nodes with a null or ambiguous coordinate
 */

/**
 * Visible, user-facing provenance summary for a graph — "what produced
 * this, and how much of it was actually resolved" — including the
 * resolved/unresolved adapter-match metrics the checklist calls for.
 * @param {import('./graphIR.js').GraphIR} graph
 * @returns {ProvenanceSummary}
 */
export function buildProvenanceSummary(graph) {
  let resolvedSymbolCount = 0;
  let unresolvedSymbolCount = 0;
  for (const node of graph.nodes) {
    if (node.coordinate && !node.coordinate.ambiguous) resolvedSymbolCount += 1;
    else unresolvedSymbolCount += 1;
  }
  return {
    analyzerName: graph.analyzer.name,
    analyzerVersion: graph.analyzer.version,
    schemaVersion: graph.schemaVersion,
    generatedAt: graph.generatedAt,
    resolvedSymbolCount,
    unresolvedSymbolCount,
  };
}
