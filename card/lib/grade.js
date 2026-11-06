'use strict';

// Shared grade ranking for SVG cards and PR receipts.
// Order: F < D- < D < D+ < C- < C < C+ < B- < B < B+ < A- < A < A+

const LETTER_RANK = { F: 0, D: 1, C: 2, B: 3, A: 4 };

function gradeRank(grade) {
  if (!grade || typeof grade !== 'string') return -1;
  const letter = grade[0].toUpperCase();
  const base = LETTER_RANK[letter];
  if (base == null) return -1;
  let modifier = 0;
  if (grade.length > 1) {
    if (grade[1] === '+') modifier = 0.3;
    else if (grade[1] === '-') modifier = -0.3;
  }
  return base + modifier;
}

function compareGrades(curr, prev) {
  const ci = gradeRank(curr);
  const pi = gradeRank(prev);
  if (ci < 0 || pi < 0) return 0;
  if (ci > pi) return 1;
  if (ci < pi) return -1;
  return 0;
}

module.exports = { gradeRank, compareGrades };
