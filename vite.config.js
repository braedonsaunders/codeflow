import { defineConfig } from 'vite';

// MOO-67 Commit 2: stand up the build/dev tooling against the *existing*
// index.html unchanged. This intentionally does not touch the app's inline
// script or CDN dependency loading yet — that extraction into real modules
// is Commit 3's job, once the marker-based Node-side extraction the test
// suite and card/ depend on (see docs/baseline.md) has a module-based
// replacement to move to. This commit only proves the tooling can build and
// serve the current app byte-for-byte.
export default defineConfig({
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: 'index.html',
    },
  },
});
