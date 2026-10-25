import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const APP_BACKGROUND = '#0c0d0d'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // React + Supabase + router form one ~200 KB (gzip) app shell that the
    // service worker caches once; it is not downloaded again on every visit.
    chunkSizeWarningLimit: 700,
  },
  plugins: [
    // Must run before the React plugin so generated routes are picked up.
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.ico', 'favicon.svg', 'apple-touch-icon.png', 'brand/*.svg'],
      manifest: {
        id: '/',
        name: 'Dosman · Cholao & Coffee',
        short_name: 'Dosman',
        description: 'Sistema de ventas, caja e inventario de Dosman Cholao & Coffee.',
        lang: 'es-CO',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: APP_BACKGROUND,
        theme_color: APP_BACKGROUND,
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // The app shell is precached; data always comes from the network.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: '/index.html',
        // Never let the service worker answer API or media calls.
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // Media keys are immutable, so cache-first is safe and saves R2 reads.
            urlPattern: ({ url }) => url.pathname.startsWith('/api/media/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'media',
              expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
    // Local dev never connects to the real Cloudflare account: the AI binding
    // (help assistant) only works once deployed. Locally the assistant answers
    // with a test reply when ASSISTANT_FAKE=on is set in .dev.vars.
    cloudflare({ remoteBindings: false }),
  ],
})
