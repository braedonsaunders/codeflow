import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const htmlSource = await readFile(join(repoRoot, 'index.html'), 'utf8');
const parserStart = htmlSource.indexOf('const Parser={');
const parserEnd = htmlSource.indexOf('\nfunction calcBlast', parserStart);

if (parserStart < 0 || parserEnd < 0) {
  throw new Error('Could not locate analyzer source in index.html');
}

const context = {
  console,
  TreeSitter: undefined,
  Babel: undefined,
  acorn: undefined,
  getSecurityScanContent(file) {
    return file && file.content ? file.content : '';
  },
  isSanitizedPreviewRenderer() {
    return false;
  },
};

vm.createContext(context);
vm.runInContext(`${htmlSource.slice(parserStart, parserEnd)}\nthis.Parser = Parser; this.buildAnalysisData = buildAnalysisData;`, context);

const { Parser, buildAnalysisData } = context;
const ignoredDirs = new Set([
  '.git',
  'node_modules',
  'vendor',
  'dist',
  'build',
  '__pycache__',
  '.next',
  'coverage',
  '.venv',
  'venv',
  'env',
  '.env',
  '.tox',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
  '__pypackages__',
  '.eggs',
]);

const args = process.argv.slice(2);
const limitArg = args.find((arg) => arg.startsWith('--limit='));
const fileLimit = limitArg ? Number(limitArg.split('=')[1]) : Infinity;
const json = args.includes('--json');
const verbose = !json && args.includes('--verbose');
const paths = args.filter((arg) => !arg.startsWith('--') && arg !== '--json');

if (!paths.length) {
  console.error('Usage: node tests/codeflow-repo-smoke.mjs [--json] [--limit=<files>] <repo-dir>...');
  process.exit(2);
}

function toRepoPath(root, filePath) {
  return relative(root, filePath).replace(/\\/g, '/');
}

function shouldIgnoreDir(name) {
  const lower = name.toLowerCase();
  return ignoredDirs.has(lower) || lower.endsWith('.egg-info');
}

async function collectFiles(root) {
  const files = [];
  let eligible = 0;

  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!shouldIgnoreDir(entry.name)) await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!Parser.isIncluded(entry.name)) continue;
      eligible++;
      if (Number.isFinite(fileLimit) && files.length >= fileLimit) continue;
      const repoPath = toRepoPath(root, fullPath);
      files.push({
        fullPath,
        path: repoPath,
        name: entry.name,
        folder: repoPath.includes('/') ? repoPath.slice(0, repoPath.lastIndexOf('/')) : 'root',
        isCode: Parser.isCode(entry.name),
      });
    }
  }

  await walk(root);
  return { files, eligible, truncated: eligible > files.length };
}

async function readTextFile(file) {
  try {
    return await readFile(file.fullPath, 'utf8');
  } catch {
    return '';
  }
}

async function analyzeRepo(root) {
  const started = Date.now();
  const phase = (name) => {
    if (verbose) console.error(`  ${basename(root)}: ${name} (${Math.round((Date.now() - started) / 100) / 10}s)`);
  };
  phase('scanning files');
  const { files, eligible, truncated } = await collectFiles(root);
  const analyzed = [];
  const allFns = [];
  const errors = [];

  phase(`reading and extracting ${files.length} files`);
  let readIndex = 0;
  for (const file of files) {
    readIndex += 1;
    if (verbose && readIndex % 500 === 0) {
      phase(`read/extracted ${readIndex}/${files.length} files`);
    }
    try {
      const content = await readTextFile(file);
      const layer = Parser.detectLayer(file.path);
      const actualIsCode = file.isCode !== false && (!Parser.isScriptContainer(file.path) || Parser.hasEmbeddedCode(content, file.path));
      const functions = actualIsCode ? Parser.extract(content, file.path) : [];
      const analyzedFile = {
        path: file.path,
        name: file.name,
        folder: file.folder,
        content,
        functions,
        lines: content ? content.split('\n').length : 0,
        layer,
        churn: 0,
        isCode: actualIsCode,
      };
      analyzed.push(analyzedFile);
      if (actualIsCode) {
        functions.forEach((fn) => allFns.push(Object.assign({}, fn, { folder: file.folder, layer })));
      }
    } catch (error) {
      errors.push({ path: file.path, message: error && error.message ? error.message : String(error) });
    }
  }

  phase(`running shared analysis core from ${allFns.length} functions`);
  const data = await buildAnalysisData({
    analyzed,
    allFns,
    excludePatterns: [],
    progress(message) {
      if (verbose) console.error(`  ${basename(root)}: ${message} (${Math.round((Date.now() - started) / 100) / 10}s)`);
    },
    yieldFn: async () => {},
  });

  return {
    repo: basename(root),
    path: root,
    durationMs: Date.now() - started,
    eligibleFiles: eligible,
    analyzedFiles: data.stats.files,
    truncated,
    functions: data.stats.functions,
    connections: data.stats.connections,
    patterns: data.stats.patterns,
    securityIssues: data.securityIssues.length,
    highSecurityIssues: data.stats.security,
    duplicates: data.duplicates.length,
    layerViolations: data.layerViolations.length,
    highComplexityFiles: data.files.filter((file) => file.complexity && file.complexity.level === 'critical').length,
    loc: data.stats.loc,
    topLanguages: data.stats.languages.slice(0, 8),
    errors,
  };
}

const results = [];
function formatResult(result) {
  if (result.error) return `${result.repo}: ERROR ${result.error}`;
  return [
    `${result.repo}: ${result.analyzedFiles}/${result.eligibleFiles} files`,
    `${result.functions} functions`,
    `${result.connections} connections`,
    `${result.securityIssues} security`,
    `${result.duplicates} dupes`,
    `${result.layerViolations} layer violations`,
    `${result.highComplexityFiles} critical complexity`,
    `${Math.round(result.durationMs / 100) / 10}s`,
  ].join(' | ');
}

for (const inputPath of paths) {
  const root = isAbsolute(inputPath) ? inputPath : join(process.cwd(), inputPath);
  const info = await stat(root).catch(() => null);
  if (!info || !info.isDirectory()) {
    const result = { repo: basename(inputPath), path: root, error: 'not a directory' };
    results.push(result);
    if (!json) console.log(formatResult(result));
    continue;
  }
  if (!json) console.error(`Analyzing ${basename(root)}...`);
  const result = await analyzeRepo(root);
  results.push(result);
  if (!json) console.log(formatResult(result));
}

if (json) {
  console.log(JSON.stringify(results, null, 2));
}
