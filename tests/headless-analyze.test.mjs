import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const fixtureRoot = join(__dirname, 'fixtures', 'golden-world');
const cliPath = join(repoRoot, 'card', 'analyze.js');
const { analyze, parseArgs } = require(cliPath);

test('headless analyzer returns a versioned data and snapshot envelope', async () => {
  const result = await analyze({ repoRoot: fixtureRoot });

  assert.equal(result.schemaVersion, 1);
  assert.equal(result.data.stats.files, 6);
  assert.equal(result.data.stats.functions, 7);
  assert.equal(result.snapshot.files, result.data.stats.files);
  assert.equal(result.snapshot.functions, result.data.stats.functions);
  assert.equal(typeof result.snapshot.grade, 'string');
});

test('headless analyzer applies repeated exclude patterns', async () => {
  const result = await analyze({ repoRoot: fixtureRoot, exclude: ['src/math.js', '*.md'] });

  assert.equal(result.data.files.some((file) => file.path === 'src/math.js'), false);
  assert.equal(result.data.files.some((file) => file.path.endsWith('.md')), false);
  assert.deepEqual(result.data.excludePatterns, ['src/math.js', '*.md']);
});

test('headless CLI keeps stdout machine-readable', async () => {
  const { stdout, stderr } = await execFileAsync(process.execPath, [cliPath, '--path', fixtureRoot]);
  const result = JSON.parse(stdout);

  assert.equal(stderr, '');
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.data.stats.files, 6);
});

test('headless argument parser accepts equals and repeated forms', () => {
  const parsed = parseArgs(['--path=' + fixtureRoot, '--exclude=dist/**', '--exclude', '*.min.js']);
  assert.equal(parsed.repoRoot, fixtureRoot);
  assert.deepEqual(parsed.exclude, ['dist/**', '*.min.js']);
});

test('headless collection ignores vendored dependencies by default', async (t) => {
  const fixture = await mkdtemp(join(tmpdir(), 'codeflow-headless-'));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  await mkdir(join(fixture, 'vendor'), { recursive: true });
  await writeFile(join(fixture, 'index.js'), 'export function included() { return true; }\n');
  await writeFile(join(fixture, 'vendor', 'ignored.js'), 'export function ignored() { return false; }\n');

  const result = await analyze({ repoRoot: fixture });
  assert.deepEqual(result.data.files.map((file) => file.path), ['index.js']);
});
