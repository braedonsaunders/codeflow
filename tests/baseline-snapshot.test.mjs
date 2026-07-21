// Structural regression harness for MOO-67 Commit 1.
//
// Runs the existing repo-smoke script (tests/codeflow-repo-smoke.mjs) — the
// same Node-side path the `card/` GitHub Action and any future headless
// integration use — against each committed fixture and compares the result
// to a snapshot checked into tests/fixtures/baseline-snapshots/.
//
// `path` (absolute, machine-specific) and `durationMs` (timing) are the only
// fields the smoke script emits that are not stable across machines/runs;
// see docs/baseline.md for the full nondeterminism inventory. Both are
// stripped before comparison so this test fails on real structural drift,
// not on where the checkout lives or how fast the machine is.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const snapshotDir = join(__dirname, 'fixtures', 'baseline-snapshots');
const smokeScript = join(__dirname, 'codeflow-repo-smoke.mjs');

function stripNondeterministicFields(result) {
  const { path, durationMs, ...stable } = result;
  return stable;
}

const snapshotNames = (await readdir(snapshotDir))
  .filter((name) => name.endsWith('.json'))
  .map((name) => name.replace(/\.json$/, ''));

assert(snapshotNames.length > 0, 'expected at least one committed baseline snapshot');

for (const fixtureName of snapshotNames) {
  test(`${fixtureName} structural output matches the committed baseline snapshot`, async () => {
    const fixturePath = join(__dirname, 'fixtures', fixtureName);
    const raw = execFileSync(
      process.execPath,
      [smokeScript, '--json', fixturePath],
      { cwd: repoRoot, encoding: 'utf8' }
    );
    const [live] = JSON.parse(raw);
    const expected = JSON.parse(await readFile(join(snapshotDir, `${fixtureName}.json`), 'utf8'));

    assert.deepEqual(stripNondeterministicFields(live), expected);
  });
}
