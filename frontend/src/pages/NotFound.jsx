import { useEffect } from 'react';
import { Link } from 'react-router-dom';

import { Wordmark } from '../components/Wordmark.jsx';

/**
 * The catch-all route. Replaces `<Navigate to="/" replace />`.
 *
 * WHY THIS EXISTS: Azure SWA's navigationFallback answers every unmatched path
 * with index.html and HTTP 200, so before this page a nonsense URL silently
 * became the home page - and a crawler asking for /this-does-not-exist got a
 * 200 with the home page's full head. That is a soft 404: Google treats the
 * fabricated page as real content, and it is how the GEO audit came to report
 * `/.well-known/ai.txt found` for a file that has never existed (see
 * docs/seo/Search_Console_Baseline_2026-10-02.md).
 *
 * WHAT THIS DOES AND DOES NOT FIX. It cannot change the status code: SWA
 * consults navigationFallback before responseOverrides.404, so the HTTP
 * response stays 200 unless every route is enumerated in
 * staticwebapp.config.json. What it does is (a) stop inventing a page for the
 * visitor, and (b) emit `robots: noindex` so a JS-executing crawler - Googlebot
 * does execute JS - drops the URL. Crawlers that never run JS still see the
 * shell. This is a partial fix and is deliberately not described as more.
 *
 * NO useT() HERE, ON PURPOSE. This component takes no `t` from anywhere. A
 * sibling using `t` without calling useT() itself is what blanked /register in
 * prod for two commits, and the frontend has no no-undef gate and no error
 * boundary to catch it (CLAUDE.md, "A blank page is a render throw"). Plain
 * English keeps the one page that handles broken URLs unable to break itself.
 */
export function NotFound() {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = 'Page not found | Raktify';

    // /login.html is prerendered WITH a robots meta, so this may already exist.
    // Reuse it when it does and restore its value on unmount; only remove the
    // tag if we were the ones who created it. Getting this wrong would leave
    // noindex set on a real page after an SPA navigation away from here.
    const existing = document.querySelector('meta[name="robots"]');
    const tag = existing || document.createElement('meta');
    const prevContent = existing ? tag.getAttribute('content') : null;
    if (!existing) {
      tag.setAttribute('name', 'robots');
      document.head.appendChild(tag);
    }
    // follow, not nofollow: the links below are pages we DO want crawled.
    tag.setAttribute('content', 'noindex, follow');

    return () => {
      document.title = prevTitle;
      if (!existing) {
        tag.remove();
      } else if (prevContent === null) {
        tag.removeAttribute('content');
      } else {
        tag.setAttribute('content', prevContent);
      }
    };
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-cream px-4 py-16">
      <div className="w-full max-w-lg text-center">
        <Link to="/" className="inline-block">
          <Wordmark tm className="text-4xl" />
        </Link>

        <p className="mt-10 text-sm font-semibold uppercase tracking-wide text-rk-700">
          Page not found
        </p>
        <h1 className="mt-3 text-2xl font-bold text-stone-900 sm:text-3xl">
          That page does not exist
        </h1>
        <p className="mt-4 text-base leading-relaxed text-stone-600">
          The link may be mistyped, or the page may have moved. Nothing is wrong
          with your account.
        </p>

        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link to="/" className="rk-button rk-button-primary w-full sm:w-auto">
            Go to the home page
          </Link>
          <Link to="/register" className="rk-button rk-button-secondary w-full sm:w-auto">
            Register as a donor
          </Link>
        </div>

        <p className="mt-10 text-sm text-stone-500">
          Looking to host a blood donation camp?{' '}
          <Link to="/camps/host" className="font-semibold text-rk-700 underline">
            Apply here
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
