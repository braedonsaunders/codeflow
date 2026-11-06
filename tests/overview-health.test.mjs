import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { loadAnalyzerContext } from './load-analyzer.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const htmlSource = await readFile(join(__dirname, '..', 'index.html'), 'utf8');
const context = await loadAnalyzerContext();

test('calcHealth exposes breakdown factors without changing grade math', () => {
  const data = {
    stats: { functions: 100, dead: 10, files: 10, connections: 20 },
    issues: [
      { title: '3 Circular Dependencies', items: [{}, {}, {}] },
      { title: '2 Large Files', items: [{}, {}] },
    ],
    securityIssues: [{ severity: 'high' }],
  };
  const health = context.calcHealth(data);
  assert.equal(typeof health.score, 'number');
  assert.ok(Array.isArray(health.breakdown));
  assert.equal(health.breakdown.length, 5);
  const cycles = health.breakdown.find((f) => f.key === 'cycles');
  assert.equal(cycles.detail, '3');
  // Historic score uses issue-object presence (1 circular issue → −5), not item count.
  assert.equal(cycles.penalty, 5);
});

test('topFragileFiles ranks by direct + transitive dependents', () => {
  const files = [
    { path: 'a.js', name: 'a.js', isCode: true },
    { path: 'b.js', name: 'b.js', isCode: true },
    { path: 'c.js', name: 'c.js', isCode: true },
    { path: 'd.js', name: 'd.js', isCode: true },
  ];
  // a <- b <- c, a <- d  => a has the widest blast
  const connections = [
    { source: 'a.js', target: 'b.js', fn: 'a1', count: 1 },
    { source: 'b.js', target: 'c.js', fn: 'b1', count: 1 },
    { source: 'a.js', target: 'd.js', fn: 'a2', count: 1 },
  ];
  const top = context.topFragileFiles({ files, connections }, 3);
  assert.ok(top.length >= 1);
  assert.equal(top[0].path, 'a.js');
  assert.ok(top[0].total >= top[0].direct);
});

test('overview pane renders health breakdown and fragile files', () => {
  assert.match(htmlSource, /overview-section-title'},'Health breakdown'/);
  assert.match(htmlSource, /overview-section-title'},'Most fragile files'/);
  assert.match(htmlSource, /var fragileFiles=useMemo/);
});
