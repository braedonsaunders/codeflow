import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const threeCyclesRoot = join(__dirname, 'fixtures', 'three-cycles');
const { snapshotFromAnalysis } = require('../card/lib/state.js');
const { analyze } = require('../card/analyze.js');

function snapshotOf(data) {
  return snapshotFromAnalysis(data, {}, { sha: 'test' });
}

test('snapshotFromAnalysis counts circular and god-object items, not issue objects', () => {
  const snapshot = snapshotOf({
    stats: { files: 8, functions: 40, loc: 200, connections: 6 },
    issues: [
      {
        type: 'critical',
        title: '3 Circular Dependencies',
        desc: 'Files that import each other',
        items: [
          { name: 'a1.js ↔ b1.js' },
          { name: 'a2.js ↔ b2.js' },
          { name: 'a3.js ↔ b3.js' },
        ],
      },
      {
        type: 'critical',
        title: '2 Large Files',
        desc: 'Files with 15+ functions',
        items: [{ name: 'god1.js (16 fns)' }, { name: 'god2.js (18 fns)' }],
      },
    ],
  });

  assert.equal(snapshot.circular, 3);
  assert.equal(snapshot.godObjects, 2);
});

test('snapshotFromAnalysis reports 0 when the aggregate issue is missing or has no items', () => {
  assert.equal(snapshotOf({ issues: [] }).circular, 0);
  assert.equal(snapshotOf({ issues: [] }).godObjects, 0);
  assert.equal(snapshotOf({}).circular, 0);
  assert.equal(
    snapshotOf({
      issues: [{ type: 'critical', title: '3 Circular Dependencies' }],
    }).circular,
    0
  );
  assert.equal(
    snapshotOf({
      issues: [{ type: 'critical', title: '2 Large Files', items: null }],
    }).godObjects,
    0
  );
});

test('three independent JS cycles snapshot as 3, not a 0-or-1 presence flag', async () => {
  const result = await analyze({ repoRoot: threeCyclesRoot });
  const circularIssue = result.data.issues.find(
    (issue) => issue && issue.title && issue.title.includes('Circular')
  );

  assert.ok(circularIssue, 'analyzer should emit one aggregate circular-dependency issue');
  assert.equal(circularIssue.title, '3 Circular Dependencies');
  assert.equal(circularIssue.items.length, 3);
  assert.equal(result.data.issues.filter((issue) => issue.title.includes('Circular')).length, 1);
  assert.equal(result.snapshot.circular, 3);
  assert.notEqual(result.snapshot.circular, 1);
});

test('multiple god-object files snapshot as the items count, not 1', async (t) => {
  const fixture = await mkdtemp(join(tmpdir(), 'codeflow-god-objects-'));
  t.after(() => rm(fixture, { recursive: true, force: true }));

  function largeFile(prefix, count) {
    return Array.from(
      { length: count },
      (_, index) => `export function ${prefix}${index}() { return ${index}; }\n`
    ).join('');
  }

  await writeFile(join(fixture, 'god1.js'), largeFile('one', 16));
  await writeFile(join(fixture, 'god2.js'), largeFile('two', 18));
  await writeFile(join(fixture, 'small.js'), 'export function tiny() { return 1; }\n');

  const result = await analyze({ repoRoot: fixture });
  const godIssue = result.data.issues.find(
    (issue) => issue && issue.title && issue.title.includes('Large')
  );

  assert.ok(godIssue, 'analyzer should emit one aggregate large-files issue');
  assert.equal(godIssue.title, '2 Large Files');
  assert.equal(godIssue.items.length, 2);
  assert.equal(result.snapshot.godObjects, 2);
  assert.notEqual(result.snapshot.godObjects, 1);
});
