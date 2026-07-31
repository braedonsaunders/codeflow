import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { compileExcludePatterns, matchesExcludePattern } = require('../card/lib/exclude.js');

function matches(pattern, path, name = path.split('/').pop()) {
  return matchesExcludePattern(compileExcludePatterns(pattern), path, name);
}

test('exclude globs match files, directories, and nested segments', () => {
  assert.equal(matches('vendor/**', 'vendor/tree-sitter/runtime.wasm'), true);
  assert.equal(matches('**/cache/**', 'packages/app/cache/data.json'), true);
  assert.equal(matches('**/cache/**', 'cache/data.json'), true);
  assert.equal(matches('*.min.js', 'assets/app.min.js'), true);
  assert.equal(matches('file-?.js', 'src/file-a.js'), true);
  assert.equal(matches('cache', 'packages/cache/data.json', 'data.json'), true);
});

test('exclude globs remain path-aware and anchored', () => {
  assert.equal(matches('*.min.js', 'assets/app.js'), false);
  assert.equal(matches('src/*.js', 'src/nested/app.js'), false);
  assert.equal(matches('src/*.js', 'src/app.js'), true);
  assert.equal(matches('cache', 'packages/cacheable/data.json', 'data.json'), false);
});

test('regular-expression syntax in user patterns is matched literally', () => {
  assert.equal(matches('[abc].js', 'src/[abc].js'), true);
  assert.equal(matches('[abc].js', 'src/a.js'), false);
  assert.equal(matches('module(1).js', 'src/module(1).js'), true);
  assert.equal(matches('module(1).js', 'src/module1.js'), false);
});
