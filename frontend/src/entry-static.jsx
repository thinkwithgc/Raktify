/**
 * Render a public route to static HTML at build time, for crawlers that do not
 * run JavaScript.
 *
 * THE PROBLEM THIS SOLVES
 * =======================
 * frontend/index.html ships `<div id="root"></div>` and nothing else outside the
 * <noscript> block, so the bytes a crawler receives for /, /register,
 * /camps/host and /help/community-leader contained ZERO words and ZERO headings.
 * Googlebot renders JS, which is why Search Console never complained and why
 * this survived the whole 2-3 Oct SEO batch unnoticed. GPTBot, ClaudeBot,
 * PerplexityBot and CCBot largely do NOT, so the pages that explain what Raktify
 * is could not be read - let alone cited - by any AI answer engine, while
 * /learn, which is real static HTML, could.
 *
 * WHY GENERATE RATHER THAN HAND-WRITE
 * ===================================
 * public/about.html and build_learn.js both hand-duplicate the locked brand
 * tokens into an inlined <style>, so they CAN drift from tailwind.config.js.
 * This cannot: the markup is produced by the same components the app renders, so
 * every class in it is one Tailwind already emits (tailwind.config.js content
 * globs ./src/**\/*.{js,jsx}, so no safelist is needed either). The design system
 * stays locked by construction rather than by discipline.
 *
 * WHY <App/> AND NOT THE PAGE COMPONENTS
 * ======================================
 * Going through App.jsx's own route table means there is no second table to
 * drift, and / exercises the real anonymous path: HomeRedirect -> useAuth() ->
 * tokenStore.token -> '' -> isAuthenticated false -> <Landing/>. Rendering
 * <Landing/> directly would ASSUME that, which is how a logged-in-only tree
 * would silently ship one day.
 *
 * REQUIRES BROWSER GLOBALS - THE CALLER INSTALLS THEM
 * ===================================================
 * Rendering this tree in Node touches `localStorage` and
 * `document.documentElement` (see scripts/prerender.js, which installs both
 * stubs before it imports this module and explains exactly why each is needed).
 * Nothing here is reached at module-evaluation time - tokenStore uses getters and
 * strings.js only declares functions - but render() will throw without them.
 * That throw is deliberate: a build that cannot render these pages must fail,
 * not quietly emit the blank shell it was written to replace.
 *
 * No <React.StrictMode> (its double render buys nothing here) and no
 * <ScrollToTop/> (window.scrollTo in an effect, and effects never run under
 * renderToStaticMarkup). Otherwise the provider stack mirrors src/main.jsx
 * exactly, with MemoryRouter standing in for BrowserRouter because there is no
 * window.history.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';

import App from './App.jsx';
import { AuthProvider } from './auth/AuthContext.jsx';
import { LangProvider } from './i18n/LangProvider.jsx';
import { queryClient } from './lib/queryClient.js';

/**
 * @param {string} path  A route as it appears in App.jsx, e.g. '/camps/host'.
 * @returns {string}     The markup for that route's tree, to go inside #root.
 *
 * Deliberately NOT importing './index.css': the served page already links the
 * real stylesheet in <head>, so pulling CSS through the SSR graph would only add
 * a stray asset to dist-ssr/ that nothing reads.
 */
export function render(path) {
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <LangProvider>
            <App />
          </LangProvider>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}
