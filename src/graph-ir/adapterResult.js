// Analyzer adapter and error contracts — MOO-68 Commit 4.
//
// Every layer adapter (MOO-69's repository adapter, MOO-70's pyan3 bridge,
// MOO-71's CodeVisualizer bridge) returns the same envelope and reports
// failures from the same fixed set of categories, so the server/UI can
// react to "GitHub was unreachable" vs. "the subprocess crashed" vs. "the
// analyzer's own output was malformed" identically regardless of which
// layer produced it — rather than each adapter inventing its own ad hoc
// error shape.
import { validateGraphIR } from './graphIR.js';

/**
 * @typedef {'github_access'|'unsupported_input'|'parser_failure'|'subprocess_failure'|'malformed_analyzer_output'|'timeout'|'renderer_failure'|'internal_error'} ErrorCategory
 */

export const ERROR_CATEGORIES = Object.freeze([
  'github_access',
  'unsupported_input',
  'parser_failure',
  'subprocess_failure',
  'malformed_analyzer_output',
  'timeout',
  'renderer_failure',
  'internal_error',
]);

const CATEGORY_SET = new Set(ERROR_CATEGORIES);

// Same secret-shaped-key pattern server/lib/logger.js already redacts, so a
// diagnostic sanitized here and one logged server-side apply one
// consistent rule rather than two independently-maintained ones.
const SECRET_KEY_PATTERN = /token|authorization|secret|password|api[_-]?key|cookie/i;

export class AdapterError extends Error {
  /**
   * @param {ErrorCategory} category
   * @param {string} message
   * @param {object} [options]
   * @param {object} [options.details] - structured, non-secret context (e.g. {owner, repo, ref})
   * @param {boolean} [options.retryable]
   * @param {Error} [options.cause]
   */
  constructor(category, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    if (!CATEGORY_SET.has(category)) {
      throw new TypeError(`Unknown ErrorCategory: ${JSON.stringify(category)} (must be one of ${ERROR_CATEGORIES.join(', ')})`);
    }
    this.name = 'AdapterError';
    this.category = category;
    this.details = options.details || {};
    this.retryable = !!options.retryable;
  }
}

/**
 * Recursively redact any object key that looks secret-shaped, and drop
 * stack traces — the shape a diagnostic must be in before it's safe to
 * write to server logs or send to the browser. Applied automatically by
 * `buildAdapterResult` so producing an adapter result can't forget this
 * step; exported separately so it's independently testable.
 * @param {object} diagnostic
 * @returns {object}
 */
export function sanitizeDiagnostic(diagnostic) {
  if (diagnostic instanceof Error) {
    diagnostic = {
      message: diagnostic.message,
      category: diagnostic.category,
      details: diagnostic.details,
    };
  }
  return sanitizeValue(diagnostic);
}

function sanitizeValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      if (key === 'stack') continue;
      out[key] = SECRET_KEY_PATTERN.test(key) ? '[redacted]' : sanitizeValue(val);
    }
    return out;
  }
  return value;
}

/**
 * @typedef {Object} AdapterProvenance
 * @property {string} analyzerName
 * @property {string} analyzerVersion
 * @property {string} fetchedAt - ISO 8601 timestamp
 */

/**
 * @typedef {Object} AdapterTiming
 * @property {string} startedAt - ISO 8601 timestamp
 * @property {number} durationMs
 */

/**
 * @typedef {Object} AdapterCacheInfo
 * @property {string|null} key - the cache key this result was stored/looked up under, or null if caching does not apply
 * @property {boolean} hit
 */

/**
 * @typedef {Object} AdapterResult
 * @property {import('./graphIR.js').GraphIR|null} graph - null only when partial is true and nothing could be produced at all
 * @property {string[]} warnings
 * @property {object[]} diagnostics - sanitized (see sanitizeDiagnostic)
 * @property {AdapterProvenance} provenance
 * @property {AdapterTiming} timing
 * @property {AdapterCacheInfo} cache
 * @property {boolean} partial - true when the adapter produced a degraded/incomplete result rather than a full success
 */

export class AdapterResultError extends Error {
  constructor(errors) {
    super('Invalid adapter result:\n' + errors.map((e) => ' - ' + e).join('\n'));
    this.name = 'AdapterResultError';
    this.errors = errors;
  }
}

/**
 * Build and validate an AdapterResult. Partial-success rule: a non-partial
 * result must carry a schema-valid graph; a partial result may either carry
 * a schema-valid (but incomplete/lower-confidence) graph alongside
 * warnings/diagnostics, or carry no graph at all (total failure) — but
 * never an invalid graph in either case. Diagnostics are sanitized here
 * unconditionally, so a caller cannot accidentally skip that step.
 * @param {object} input
 * @returns {AdapterResult}
 */
export function buildAdapterResult(input) {
  const errors = [];
  const graph = input.graph != null ? input.graph : null;

  if (graph != null) {
    const { valid, errors: graphErrors } = validateGraphIR(graph);
    if (!valid) errors.push(...graphErrors.map((e) => `graph: ${e}`));
  } else if (!input.partial) {
    errors.push('graph is required unless partial is true');
  }

  if (!Array.isArray(input.warnings) || input.warnings.some((w) => typeof w !== 'string')) {
    errors.push('warnings must be an array of strings');
  }
  if (!input.provenance || typeof input.provenance.analyzerName !== 'string' || typeof input.provenance.analyzerVersion !== 'string') {
    errors.push('provenance.analyzerName and provenance.analyzerVersion are required strings');
  }
  if (!input.timing || typeof input.timing.startedAt !== 'string' || typeof input.timing.durationMs !== 'number') {
    errors.push('timing.startedAt and timing.durationMs are required');
  }

  if (errors.length > 0) throw new AdapterResultError(errors);

  return {
    graph,
    warnings: input.warnings,
    diagnostics: (input.diagnostics || []).map(sanitizeDiagnostic),
    provenance: {
      analyzerName: input.provenance.analyzerName,
      analyzerVersion: input.provenance.analyzerVersion,
      fetchedAt: input.provenance.fetchedAt || new Date().toISOString(),
    },
    timing: { startedAt: input.timing.startedAt, durationMs: input.timing.durationMs },
    cache: { key: (input.cache && input.cache.key) || null, hit: !!(input.cache && input.cache.hit) },
    partial: !!input.partial,
  };
}
