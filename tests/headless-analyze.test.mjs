import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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

test('headless analyzer rejects missing paths and regular files', async (t) => {
  const fixture = await mkdtemp(join(tmpdir(), 'codeflow-invalid-root-'));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  const filePath = join(fixture, 'file.js');
  await writeFile(filePath, 'export function example() {}\n');

  await assert.rejects(
    analyze({ repoRoot: join(fixture, 'missing') }),
    /Analysis path does not exist/
  );
  await assert.rejects(analyze({ repoRoot: filePath }), /Analysis path is not a directory/);
});

test('headless CLI reports invalid roots on stderr and exits unsuccessfully', async () => {
  const missingPath = join(
    tmpdir(),
    'codeflow-missing-analysis-root-' + process.pid + '-' + Date.now()
  );
  await assert.rejects(
    execFileAsync(process.execPath, [cliPath, '--path', missingPath]),
    (error) => {
      assert.equal(error.stdout, '');
      assert.match(error.stderr, /Analysis path does not exist/);
      assert.notEqual(error.code, 0);
      return true;
    }
  );
});

test(
  'headless analyzer rejects unreadable directories',
  { skip: process.platform === 'win32' || (process.getuid && process.getuid() === 0) },
  async (t) => {
    const fixture = await mkdtemp(join(tmpdir(), 'codeflow-unreadable-root-'));
    t.after(async () => {
      await chmod(fixture, 0o700);
      await rm(fixture, { recursive: true, force: true });
    });
    await chmod(fixture, 0o000);

    await assert.rejects(analyze({ repoRoot: fixture }), /Analysis path is not readable/);
  }
);

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
