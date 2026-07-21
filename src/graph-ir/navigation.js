// Navigation and selection events — MOO-68 Commit 5.
//
// The interaction contract every renderer (D3 repository graph today,
// pyan3/CodeVisualizer renderers later) emits through, so drill-down
// behavior is defined once instead of once per layer. Governing decision
// carried over from MOO-66/MOO-67: single click selects/focuses only;
// double click carries drill-down *intent* (the selected coordinate and
// target layer) — it does not itself perform navigation. MOO-67 Commit 4E
// already wired a `node-activate` seam (src/render/repositoryGraph.js) as
// a no-op specifically so this module's real drill-down dispatch can be
// plugged into it later without touching the renderer again.
import { normalizePath } from './sourceCoordinate.js';

/** @typedef {'select'|'drillDown'|'openSource'} NavigationEventType */

export class NavigationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NavigationError';
  }
}

/**
 * Classify a raw pointer interaction into 'select' or 'drillDown'. Exists
 * so every renderer maps its native click/dblclick handling through one
 * shared rule rather than each reimplementing "detail === 2 means
 * double-click."
 * @param {{type: 'click'|'dblclick', detail?: number}} interaction
 * @returns {'select'|'drillDown'}
 */
export function classifyPointerInteraction(interaction) {
  if (interaction.type === 'dblclick') return 'drillDown';
  if (interaction.type === 'click' && interaction.detail === 2) return 'drillDown';
  return 'select';
}

/**
 * The valid layer a drill-down from a given layer may target. `function`
 * has no further layer to drill into — a double-click there stays within
 * open-source/selection only.
 */
const DRILL_DOWN_TARGET = { repository: 'file', file: 'function', function: null };

/**
 * Whether a coordinate is a legitimate drill-down target for a given
 * target layer. An ambiguous coordinate, or one missing the identity a
 * target layer requires (a path for 'file'; a resolved function/method
 * scope for 'function'), is never eligible — this is the single place
 * that rule is enforced, rather than trusting every future renderer to
 * check it independently.
 * @param {import('./sourceCoordinate.js').SourceCoordinate} coordinate
 * @param {import('./graphIR.js').GraphLayer} targetLayer
 * @returns {boolean}
 */
export function isDrillDownEligible(coordinate, targetLayer) {
  if (!coordinate || coordinate.ambiguous) return false;
  if (targetLayer === 'file') return !!normalizePath(coordinate.path);
  if (targetLayer === 'function') {
    return coordinate.symbolPath.length > 0 && (coordinate.symbolKind === 'function' || coordinate.symbolKind === 'method');
  }
  return false;
}

/**
 * @typedef {Object} SelectionEvent
 * @property {'select'} type
 * @property {string} nodeId
 * @property {import('./sourceCoordinate.js').SourceCoordinate|null} coordinate
 */

/**
 * Single-click intent: selection/focus only, no navigation.
 * @param {string} nodeId
 * @param {import('./sourceCoordinate.js').SourceCoordinate|null} coordinate
 * @returns {SelectionEvent}
 */
export function createSelectionEvent(nodeId, coordinate) {
  if (!nodeId) throw new NavigationError('createSelectionEvent requires a nodeId');
  return { type: 'select', nodeId, coordinate: coordinate || null };
}

/**
 * @typedef {Object} DrillDownEvent
 * @property {'drillDown'} type
 * @property {import('./sourceCoordinate.js').SourceCoordinate} coordinate
 * @property {import('./graphIR.js').GraphLayer} sourceLayer
 * @property {import('./graphIR.js').GraphLayer} targetLayer
 */

/**
 * Double-click intent: carries the selected coordinate and the layer it
 * should open into. Throws rather than producing an event when the
 * coordinate is unresolved/ineligible, so an unresolved-symbol double-click
 * never silently dispatches an incorrect drill-down.
 * @param {import('./sourceCoordinate.js').SourceCoordinate} coordinate
 * @param {import('./graphIR.js').GraphLayer} sourceLayer
 * @returns {DrillDownEvent}
 */
export function createDrillDownEvent(coordinate, sourceLayer) {
  const targetLayer = DRILL_DOWN_TARGET[sourceLayer];
  if (!targetLayer) {
    throw new NavigationError(`layer ${JSON.stringify(sourceLayer)} has no drill-down target`);
  }
  if (!isDrillDownEligible(coordinate, targetLayer)) {
    throw new NavigationError(
      `coordinate is not a valid drill-down target for layer ${JSON.stringify(targetLayer)} (ambiguous or missing required identity)`
    );
  }
  return { type: 'drillDown', coordinate, sourceLayer, targetLayer };
}

/**
 * @typedef {Object} OpenSourceEvent
 * @property {'openSource'} type
 * @property {import('./sourceCoordinate.js').SourceCoordinate} coordinate
 */

/**
 * "View on GitHub"-style intent — opens the raw source at this coordinate's
 * repository/revision/path/range without changing the active graph layer.
 * Unlike drill-down, an ambiguous coordinate is still allowed here (you can
 * always view the file even if the exact symbol couldn't be resolved) as
 * long as it at least names a path.
 * @param {import('./sourceCoordinate.js').SourceCoordinate} coordinate
 * @returns {OpenSourceEvent}
 */
export function createOpenSourceEvent(coordinate) {
  if (!coordinate || !normalizePath(coordinate.path)) {
    throw new NavigationError('createOpenSourceEvent requires a coordinate with a path');
  }
  return { type: 'openSource', coordinate };
}

/**
 * @typedef {Object} BreadcrumbEntry
 * @property {import('./graphIR.js').GraphLayer} layer
 * @property {import('./sourceCoordinate.js').SourceCoordinate|null} coordinate
 * @property {string|null} selectedNodeId
 * @property {string|null} graphCacheKey - the cache key (see cacheKey.js) identifying the graph shown at this history entry, so back/forward can restore it from cache rather than re-running analysis
 * @property {string} label
 */

/**
 * @param {import('./graphIR.js').GraphLayer} layer
 * @param {import('./sourceCoordinate.js').SourceCoordinate|null} coordinate
 * @param {object} [options]
 * @param {string|null} [options.selectedNodeId]
 * @param {string|null} [options.graphCacheKey]
 * @param {string} [options.label]
 * @returns {BreadcrumbEntry}
 */
export function makeBreadcrumbEntry(layer, coordinate, options = {}) {
  return {
    layer,
    coordinate: coordinate || null,
    selectedNodeId: options.selectedNodeId || null,
    graphCacheKey: options.graphCacheKey || null,
    label: options.label || layer,
  };
}

/**
 * Deep-linkable navigation history: an ordinary back/forward stack of
 * BreadcrumbEntry values. Pushing after navigating back truncates the
 * discarded forward entries, matching standard browser history semantics
 * (and `window.history`'s own behavior, which src/state/route.js already
 * defers to for the repository-view-only URL it manages).
 */
export class NavigationHistory {
  /** @param {BreadcrumbEntry} initialEntry */
  constructor(initialEntry) {
    this._stack = [initialEntry];
    this._index = 0;
  }

  /** @param {BreadcrumbEntry} entry */
  push(entry) {
    this._stack = this._stack.slice(0, this._index + 1);
    this._stack.push(entry);
    this._index = this._stack.length - 1;
  }

  /** @returns {BreadcrumbEntry} */
  current() {
    return this._stack[this._index];
  }

  get canGoBack() {
    return this._index > 0;
  }

  get canGoForward() {
    return this._index < this._stack.length - 1;
  }

  /** @returns {BreadcrumbEntry} */
  back() {
    if (!this.canGoBack) throw new NavigationError('cannot go back: already at the start of history');
    this._index -= 1;
    return this.current();
  }

  /** @returns {BreadcrumbEntry} */
  forward() {
    if (!this.canGoForward) throw new NavigationError('cannot go forward: already at the end of history');
    this._index += 1;
    return this.current();
  }

  /** @returns {BreadcrumbEntry[]} full breadcrumb trail up to and including the current entry */
  trail() {
    return this._stack.slice(0, this._index + 1);
  }
}
