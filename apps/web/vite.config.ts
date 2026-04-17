import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // sqlite-wasm ships pre-built WASM + worker assets that Vite's esbuild
  // dep-optimiser would trip over if pre-bundled.
  optimizeDeps: {
    exclude: ['@sqlite.org/sqlite-wasm'],
  },
  server: {
    port: 5173,
    // COOP/COEP enable SharedArrayBuffer + Atomics inside workers, which
    // lets sqlite-wasm's auto-installed OPFS VFS initialise cleanly
    // (otherwise it logs a loud warning and falls through to our SAH
    // Pool VFS). Third-party assets must be served with
    // `cross-origin-resource-policy: cross-origin` — Google Fonts does
    // this by default, so our only CDN use case is covered.
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
