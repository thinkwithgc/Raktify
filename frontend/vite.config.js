import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.VITE_API_URL || 'http://localhost:3000';

  return {
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg'],
        manifest: {
          name: 'Raktify',
          short_name: 'Raktify',
          description: 'Raktify — voluntary blood donation network',
          theme_color: '#b91c1c',
          background_color: '#ffffff',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          icons: [
            { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
          ],
        },
        workbox: {
          // Static standalone pages must NOT be hijacked by the SPA-shell
          // navigation fallback — without this, a repeat visitor (service
          // worker installed) navigating to /how-raktify-works.html would be
          // served index.html and React Router would render a blank page.
          // /privacy, /terms, /data-deletion are static HTML (public/*.html),
          // served at clean URLs via staticwebapp.config.json rewrites — the SW
          // must let them hit the network, not the SPA shell.
          navigateFallbackDenylist: [
            /^\/how-raktify-works\.html/,
            /^\/privacy(\.html)?$/,
            /^\/terms(\.html)?$/,
            /^\/data-deletion(\.html)?$/,
            /^\/donate(\.html)?$/,
          ],
          // Network-first for API calls; precache the app shell.
          runtimeCaching: [
            {
              urlPattern: ({ url }) =>
                url.pathname.startsWith('/auth') ||
                url.pathname.startsWith('/donors') ||
                url.pathname.startsWith('/coordinator') ||
                url.pathname.startsWith('/requests') ||
                url.pathname.startsWith('/inventory'),
              handler: 'NetworkFirst',
              options: {
                cacheName: 'raktify-api',
                networkTimeoutSeconds: 5,
                expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 },
              },
            },
          ],
        },
      }),
    ],
    server: {
      port: 5173,
      proxy: {
        '/auth': apiTarget,
        '/donors': apiTarget,
        '/donations': apiTarget,
        '/inventory': apiTarget,
        '/requests': apiTarget,
        '/coordinator': apiTarget,
        '/community-leader': apiTarget,
        '/dho': apiTarget,
        '/lookback': apiTarget,
        '/institutions': apiTarget,
        '/onboarding': apiTarget,
        '/admin': apiTarget,
        '/camps': apiTarget,
        '/registries': apiTarget,
        '/geography': apiTarget,
        '/reports': apiTarget,
        '/health': apiTarget,
      },
    },
  };
});
