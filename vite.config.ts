import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Served from the domain root on Cloudflare Pages (the old GitHub Pages address only redirects).
const base = process.env.VITE_BASE ?? '/';

export default defineConfig({
  base,
  build: {
    chunkSizeWarningLimit: 1100,
    rolldownOptions: {
      output: { codeSplitting: { groups: [{ name: 'maplibre', test: /maplibre-gl/ }, { name: 'vendor', test: /node_modules/ }] } },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icon-192.png'],
      manifest: {
        name: 'Diaspora Market Map',
        short_name: 'Diaspora Map',
        description: 'African & Caribbean markets and restaurants across the USA',
        theme_color: '#141B3D',
        background_color: '#F3F4F7',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Only the app shell: the thousands of pre-built pages for search engines stay out of the offline cache
        globPatterns: ['**/*.{js,mjs,css,svg,png}', 'index.html'],
        globIgnores: ['place/**', 'us/**', 'cuisine/**', 'groceries/**', 'dishes/**', 'prices/**'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallbackDenylist: [/\/data\//, /\/sitemap.*\.xml$/, /\/robots\.txt$/],
        runtimeCaching: [
          {
            // Map snapshot: show the cached copy instantly, refresh it in the background
            urlPattern: /\/data\/places\.v\d+\.json$/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'map-snapshot', expiration: { maxEntries: 2 } },
          },
          {
            urlPattern: /^https:\/\/tiles\.openfreemap\.org\//,
            handler: 'CacheFirst',
            options: { cacheName: 'map-tiles', expiration: { maxEntries: 3000, maxAgeSeconds: 7 * 24 * 3600 } },
          },
        ],
      },
    }),
  ],
});
