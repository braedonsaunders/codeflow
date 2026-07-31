import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

test('index.html contains 3d-force-graph dependency', () => {
  assert.ok(html.includes('./vendor/3d-force-graph/3d-force-graph.min.js'), 'vendored 3d-force-graph script tag is missing in index.html');
});

test('index.html includes graph3d selector and container element', () => {
  assert.ok(html.includes("value:'graph3d'"), '3D graph option is missing in vizType selector dropdown');
  assert.ok(html.includes("vizType==='graph3d'"), 'vizType active class check is missing');
  assert.ok(html.includes('ref:graph3dRef'), '3D graph container div with ref:graph3dRef is missing');
});

test('index.html React app defines graph3dRef and graph3dInstanceRef refs', () => {
  assert.ok(html.includes('var graph3dRef=useRef(null);'), 'graph3dRef useRef initialization is missing');
  assert.ok(html.includes('var graph3dInstanceRef=useRef(null);'), 'graph3dInstanceRef useRef initialization is missing');
});

test('index.html React app implements useEffect for 3D force graph rendering', () => {
  assert.ok(html.includes("graphConfig.vizType!=='graph3d'"), '3D Graph useEffect unmount check is missing');
  assert.ok(html.includes('graph3dInstanceRef.current.pauseAnimation()'), '3D Graph cleanup pauseAnimation is missing');
  assert.ok(html.includes('graph3dInstanceRef.current.graphData({nodes:[],links:[]})'), '3D Graph cleanup graphData is missing');
});
