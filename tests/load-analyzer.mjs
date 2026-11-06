// Shared helper for tests: load analyzer+metrics blocks from index.html into a vm.
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(__dirname, '..');
export const htmlPath = join(repoRoot, 'index.html');
/** @deprecated kept for callers; analyzer now lives in index.html again. */
export const analyzerPath = htmlPath;

function sliceBlock(html, startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start);
  if (start < 0 || end < 0) {
    throw new Error('Could not locate ' + startMarker + ' in index.html');
  }
  return html.slice(start, end + endMarker.length);
}

export async function readAnalyzerSource() {
  const html = await readFile(htmlPath, 'utf8');
  const analyzer = sliceBlock(
    html,
    '// ===== CODEFLOW_ANALYZER_START =====',
    '// ===== CODEFLOW_ANALYZER_END ====='
  );
  const metrics = sliceBlock(
    html,
    '// ===== CODEFLOW_METRICS_START =====',
    '// ===== CODEFLOW_METRICS_END ====='
  );
  return analyzer + '\n' + metrics;
}

export async function loadAnalyzerContext(expose = {}) {
  const source = await readAnalyzerSource();
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
    ...expose,
  };
  vm.createContext(context);
  const names = [
    'Parser',
    'buildAnalysisData',
    'buildArchitectureDiagram',
    'generateMermaidBlockDiagram',
    'getVisibleArchitectureBlocks',
    'getArchitectureGroupOrder',
    'summarizeArchitectureViolations',
    'countArchitectureGroupViolations',
    'resolveArchitectureBlockIdFromTarget',
    'getArchitectureLayerRulePreset',
    'normalizeArchitectureLayerRule',
    'calcBlast',
    'calcHealth',
    'topFragileFiles',
  ];
  const exposeExports = names.map((name) => `this.${name}=typeof ${name}!=='undefined'?${name}:undefined;`).join('\n');
  vm.runInContext(source + '\n' + exposeExports, context);
  return context;
}
