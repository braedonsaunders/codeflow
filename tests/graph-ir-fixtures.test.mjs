// Fixture and example-adapter tests — MOO-68 Commit 7.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';

const { validateGraphIR } = await import('../src/graph-ir/graphIR.js');
const { produce, consume } = await import('../examples/minimal-graphir-adapter.mjs');

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, 'fixtures', 'graph-ir');

function loadFixture(name) {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8'));
}

test('the repository-layer fixture validates against the common schema', () => {
  const graph = loadFixture('repository.json');
  const { valid, errors } = validateGraphIR(graph);
  assert.deepEqual(errors, []);
  assert.equal(valid, true);
  assert.equal(graph.layer, 'repository');
});

test('the pyan-style file-layer fixture validates and carries an unresolved (ambiguous) node', () => {
  const graph = loadFixture('file-pyan.json');
  const { valid, errors } = validateGraphIR(graph);
  assert.deepEqual(errors, []);
  assert.equal(valid, true);
  const unresolved = graph.nodes.find((n) => n.id === 'fn-unresolved-import');
  assert.equal(unresolved.coordinate.ambiguous, true);
  assert.ok(graph.warnings.length > 0);
});

test('the CodeVisualizer-style function-layer fixture validates and has a valid control-flow graph', () => {
  const graph = loadFixture('function-codevisualizer.json');
  const { valid, errors } = validateGraphIR(graph);
  assert.deepEqual(errors, []);
  assert.equal(valid, true);
  const entry = graph.nodes.find((n) => n.hints && n.hints.isEntry);
  const exit = graph.nodes.find((n) => n.hints && n.hints.isExit);
  assert.ok(entry && exit);
});

test('all three fixtures validate against the exact same schema function, just with different layer vocabularies', () => {
  for (const name of ['repository.json', 'file-pyan.json', 'function-codevisualizer.json']) {
    const graph = loadFixture(name);
    assert.equal(validateGraphIR(graph).valid, true, `${name} should validate`);
  }
  const kinds = new Set();
  for (const name of ['repository.json', 'file-pyan.json', 'function-codevisualizer.json']) {
    for (const node of loadFixture(name).nodes) kinds.add(node.kind);
  }
  // Distinct per-layer kind vocabularies, not a single shared enum.
  assert.ok(kinds.has('directory') && kinds.has('method') && kinds.has('branch'));
});

test('the minimal example adapter produces a schema-valid GraphIR using only src/graph-ir/*', () => {
  const result = produce();
  const { valid, errors } = validateGraphIR(result.graph);
  assert.deepEqual(errors, []);
  assert.equal(valid, true);
  assert.equal(result.partial, false);
});

test('the minimal example adapter\'s output can be consumed (selection + drill-down) without any application code', () => {
  const result = produce();
  const consumed = consume(result);
  assert.equal(consumed.selection.type, 'select');
  assert.equal(consumed.drillDown.type, 'drillDown');
  assert.equal(consumed.drillDown.targetLayer, 'function');
  assert.equal(consumed.summary.unresolvedSymbolCount, 0);
});
