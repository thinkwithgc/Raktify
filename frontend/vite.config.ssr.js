import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Second Vite build: compiles src/entry-static.jsx into a Node-runnable bundle
 * that scripts/prerender.js imports to render public routes to static HTML.
 *
 * It is a separate config rather than a mode of vite.config.js because that one
 * is a function of `mode`, carries the dev-server proxy, and registers VitePWA -
 * none of which belong in an SSR build.
 *
 * VitePWA IS DELIBERATELY ABSENT. Its _generateSW is already guarded behind
 * !build.ssr so dist/sw.js is safe either way, but generateBundle is NOT
 * guarded and would drop a stray manifest.webmanifest into dist-ssr/. Omitting
 * the plugin is cleaner than tolerating an artefact nothing reads.
 *
 * outDir IS BESIDE dist/, NEVER INSIDE IT. The deploy workflow uploads
 * output_location: "dist", so an outDir of dist/ssr would publish a bundle
 * containing the entire app source to the public origin. frontend/.gitignore
 * already lists dist-ssr.
 *
 * No `resolve.alias` or `define` is mirrored from vite.config.js because it has
 * neither. api.js reads import.meta.env.VITE_API_URL at module scope, which
 * falls back to '' here - harmless, because renderToStaticMarkup never runs an
 * effect and therefore never issues a request.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    ssr: 'src/entry-static.jsx',
    outDir: 'dist-ssr',
    emptyOutDir: true,
    rollupOptions: {
      // entryFileNames is pinned so prerender.js can import a known path rather
      // than glob for whatever Rollup decided to call it.
      output: { format: 'es', entryFileNames: 'entry-static.js' },
    },
  },
});
