const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..');
const htmlSource = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
const parserStart = htmlSource.indexOf('const Parser={');
const parserEnd = htmlSource.indexOf('\nvar GitHub={', parserStart);

if (parserStart === -1 || parserEnd === -1) {
  throw new Error('Could not locate Parser source in index.html');
}

const context = {
  console,
  TreeSitter: undefined,
  Babel: undefined,
  acorn: undefined,
  getSecurityScanContent() {
    return '';
  },
  isSanitizedPreviewRenderer() {
    return false;
  }
};

vm.createContext(context);
vm.runInContext(`${htmlSource.slice(parserStart, parserEnd)}\nthis.Parser = Parser;`, context);

const Parser = context.Parser;

assert(Parser, 'Parser should be available');

const hybridHtml = `
<!doctype html>
<html>
  <head>
    <script type="application/ld+json">{"ignored":true}</script>
    <script>
      function boot() {
        renderApp();
      }
      const renderApp = () => setupUi();
    </script>
    <script type="text/babel">
      const setupUi = () => boot();
    </script>
  </head>
  <body onload="boot()">
    <button onclick="renderApp()">Run</button>
  </body>
</html>
`;

assert.equal(Parser.hasEmbeddedCode(hybridHtml, 'demo.html'), true, 'HTML with inline handlers/scripts should be treated as code');

const hybridFns = Parser.extract(hybridHtml, 'demo.html');
assert.deepEqual(
  Array.from(hybridFns, function(fn){ return fn.name; }).sort(),
  ['boot', 'renderApp', 'setupUi'],
  'HTML extraction should find functions across multiple executable script blocks'
);

const hybridCalls = Parser.findCalls(
  hybridHtml,
  hybridFns.map(function(fn){ return fn.name; }),
  'demo.html',
  hybridFns
);

assert.equal(hybridCalls.boot, 2, 'boot should be referenced by setupUi and the inline onload handler');
assert.equal(hybridCalls.renderApp, 2, 'renderApp should be referenced by boot and the inline onclick handler');
assert.equal(hybridCalls.setupUi, 1, 'setupUi should be referenced from renderApp');

const manyFunctionNames = Array.from({ length: 1000 }, function(_, i) { return 'unusedFn' + i; });
manyFunctionNames.push('targetCall');
const filteredCalls = Parser.findCalls('function demo(){ targetCall(); }', manyFunctionNames, 'demo.js', []);
assert.equal(filteredCalls.targetCall > 0, true, 'large function lists should still count names present in the file');
assert.equal(Object.prototype.hasOwnProperty.call(filteredCalls, 'unusedFn999'), false, 'large function lists should skip names absent from the file');

const dataOnlyHtml = `
<!doctype html>
<html>
  <head>
    <script type=application/ld+json>{"name":"example"}</script>
    <script type="text/plain">function nope(){}</script>
  </head>
  <body></body>
</html>
`;

assert.equal(Parser.hasEmbeddedCode(dataOnlyHtml, 'data.html'), false, 'Non-executable script tags should be ignored even with unquoted type attributes');
assert.equal(Parser.extract(dataOnlyHtml, 'data.html').length, 0, 'Non-executable script tags should not contribute functions');

const customAttrHtml = `
<!doctype html>
<html>
  <body data-onclick="boot()" aria-description="onclick=still-not-a-handler">
    <div data-onload="renderApp()"></div>
  </body>
</html>
`;

assert.equal(Parser.hasEmbeddedCode(customAttrHtml, 'attrs.html'), false, 'Custom attributes containing on* names should not be treated as handlers');
assert.equal(Parser.extract(customAttrHtml, 'attrs.html').length, 0, 'Custom attributes should not create extracted functions or executable blocks');

const vueSfc = `
<template><div /></template>
<script context="module">
  export function load() {
    hydrate();
  }
</script>
<script lang="ts">
  const hydrate = () => load();
</script>
`;

assert.deepEqual(
  Array.from(Parser.extract(vueSfc, 'Widget.vue'), function(fn){ return fn.name; }).sort(),
  ['hydrate', 'load'],
  'Multi-script container files should analyze every executable script block'
);

assert(Parser.extract(htmlSource, 'index.html').length > 20, 'The repo index.html should now surface inline functions');

console.log('HTML inline script analysis smoke tests passed');
