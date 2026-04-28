// Card entry point. Dispatches to the requested style; see styles.js for
// individual renderers.

'use strict';

const { renderStyle, ALL_STYLES, escapeXml, fmtNum } = require('./styles.js');

function renderCard(opts) {
  const style = opts.style || 'compact';
  const history = opts.history || [];
  const prev = history.length > 0 ? history[history.length - 1] : null;
  return renderStyle(style, Object.assign({}, opts, { prev }));
}

module.exports = { renderCard, escapeXml, fmtNum, ALL_STYLES };
