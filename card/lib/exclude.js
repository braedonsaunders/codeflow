// Exclude-pattern support for the card action. Ports the browser app's
// pattern helpers (index.html: normalizeExcludePath / parseExcludePatterns /
// globMatches / matchesExcludePattern) so `exclude:` input patterns behave
// exactly like the web UI's custom excludes: `vendor/**`, `**/cache/**`,
// `*.min.js`, or a bare name that matches any path segment.
//
// Ported rather than extracted because these helpers live OUTSIDE the
// CODEFLOW_ANALYZER_START/END block that analyzer.js slices out of
// index.html. Keep semantics in sync with the app if they ever change.

'use strict';

function normalizeExcludePath(value) {
  return (value || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/{2,}/g, '/');
}

function parseExcludePatterns(input) {
  const seen = new Set();
  return (input || '')
    .split(/\r?\n|,/)
    .map((item) => normalizeExcludePath(item.trim()).replace(/\/$/, ''))
    .filter((item) => {
      if (!item || seen.has(item.toLowerCase())) return false;
      seen.add(item.toLowerCase());
      return true;
    });
}

// Match the small glob dialect used by CodeFlow without turning user input
// into executable regular expressions. Memoization keeps adjacent wildcards
// and long paths from causing exponential backtracking.
function globMatches(pattern, value) {
  const glob = normalizeExcludePath(pattern).toLowerCase();
  const candidate = normalizeExcludePath(value).toLowerCase();
  const memo = new Map();

  function match(globIndex, valueIndex) {
    const key = globIndex + ':' + valueIndex;
    if (memo.has(key)) return memo.get(key);

    let result;
    if (globIndex === glob.length) {
      result = valueIndex === candidate.length;
    } else if (glob[globIndex] === '*') {
      if (glob[globIndex + 1] === '*') {
        if (glob[globIndex + 2] === '/') {
          result = match(globIndex + 3, valueIndex);
          if (!result) {
            const slashIndex = candidate.indexOf('/', valueIndex);
            result = slashIndex > valueIndex && match(globIndex, slashIndex + 1);
          }
        } else {
          result =
            match(globIndex + 2, valueIndex) ||
            (valueIndex < candidate.length && match(globIndex, valueIndex + 1));
        }
      } else {
        result =
          match(globIndex + 1, valueIndex) ||
          (valueIndex < candidate.length &&
            candidate[valueIndex] !== '/' &&
            match(globIndex, valueIndex + 1));
      }
    } else if (glob[globIndex] === '?') {
      result =
        valueIndex < candidate.length &&
        candidate[valueIndex] !== '/' &&
        match(globIndex + 1, valueIndex + 1);
    } else {
      result =
        valueIndex < candidate.length &&
        glob[globIndex] === candidate[valueIndex] &&
        match(globIndex + 1, valueIndex + 1);
    }

    memo.set(key, result);
    return result;
  }

  return match(0, 0);
}

function compileExcludePatterns(input) {
  return parseExcludePatterns(input).map((pattern) => {
    const lower = pattern.toLowerCase();
    const hasGlob = pattern.includes('*') || pattern.includes('?');
    const hasPath = pattern.includes('/');
    return {
      raw: pattern,
      lower,
      useGlob: hasGlob || hasPath,
    };
  });
}

function matchesExcludePattern(compiledPatterns, path, name) {
  if (!compiledPatterns || !compiledPatterns.length) return false;
  const normalizedPath = normalizeExcludePath(path || name).replace(/\/$/, '');
  const lowerPath = normalizedPath.toLowerCase();
  const lowerName = (name || normalizedPath.split('/').pop() || '').toLowerCase();
  const lowerPathWithSlash = lowerPath ? lowerPath + '/' : '';
  const segments = lowerPath.split('/').filter(Boolean);
  return compiledPatterns.some((pattern) => {
    if (!pattern.useGlob) {
      return lowerName === pattern.lower || segments.includes(pattern.lower);
    }
    return (
      globMatches(pattern.lower, lowerPath) ||
      globMatches(pattern.lower, lowerPathWithSlash) ||
      globMatches(pattern.lower, lowerName)
    );
  });
}

module.exports = { compileExcludePatterns, matchesExcludePattern, parseExcludePatterns };
