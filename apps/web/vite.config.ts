import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon-192.svg', 'icon-512.svg'],
      manifest: {
        name: 'DayRail',
        short_name: 'DayRail',
        description: 'Local-first personal planning — Stay on the Rail.',
        theme_color: '#FDFDFC',
        background_color: '#FDFDFC',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        lang: 'zh-CN',
        icons: [
          {
            src: '/icon-192.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: '/icon-512.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        // Precache everything Vite spits out except the sqlite-wasm worker
        // + its OPFS async proxy — they're loaded by the DB layer on demand
        // and bloat the precache manifest. The actual wasm binary
        // (`sqlite3-*.wasm`) and the bundler-friendly worker still go in
        // so offline boots don't fail on first sqlite call.
        globPatterns: ['**/*.{js,css,html,svg,wasm}'],
        // OPFS isn't routable, but the DB worker boots from a chunk that
        // the default SPA fallback would otherwise serve `index.html` for.
        navigateFallbackDenylist: [/^\/api\//, /\.worker\.js$/],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      devOptions: {
        // Off in dev — HMR + an active SW fighting over asset ownership
        // is a debugging pit we don't need. Flip to `true` when testing
        // install / offline flows locally.
        enabled: false,
      },
    }),
  ],
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
