import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { gradeRank, compareGrades } = require('../card/lib/grade.js');

test('gradeRank orders plus/minus within the same letter', () => {
  assert.ok(gradeRank('A+') > gradeRank('A'));
  assert.ok(gradeRank('A') > gradeRank('A-'));
  assert.ok(gradeRank('B+') > gradeRank('B-'));
  assert.ok(gradeRank('A-') > gradeRank('B+'));
  assert.ok(gradeRank('B') > gradeRank('C+'));
});

test('compareGrades detects same-letter deltas', () => {
  assert.equal(compareGrades('B+', 'B-'), 1);
  assert.equal(compareGrades('B-', 'B+'), -1);
  assert.equal(compareGrades('A+', 'A-'), 1);
  assert.equal(compareGrades('A', 'A'), 0);
  assert.equal(compareGrades('A+', 'B+'), 1);
  assert.equal(compareGrades('C', 'B'), -1);
});

test('compareGrades ignores invalid grades', () => {
  assert.equal(compareGrades('Z', 'A'), 0);
  assert.equal(compareGrades(null, 'A'), 0);
});
