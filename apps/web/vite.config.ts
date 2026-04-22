import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Build-time metadata threaded into the app via `define`. Used by the
// About section in Settings; keep plain strings so JSON-encode-as-
// string-literal works cleanly in `define`.
const pkg = JSON.parse(
  readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'),
) as { version: string };
const gitSha = (() => {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: __dirname })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
})();
const buildDate = new Date().toISOString().slice(0, 10);

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_GIT_SHA__: JSON.stringify(gitSha),
    __APP_BUILD_DATE__: JSON.stringify(buildDate),
  },
  plugins: [
    react(),
    VitePWA({
      // `'prompt'` hands "when to activate the new SW" to app code
      // (see ERD §13 and src/lib/swRegistration.ts). `'autoUpdate'`
      // silently skipWaited the new SW — the current tab kept running
      // the old JS with no signal, so users needed multiple restarts
      // before actually landing on the new version.
      registerType: 'prompt',
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
