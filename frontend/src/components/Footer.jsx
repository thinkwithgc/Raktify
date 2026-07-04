import { Link } from 'react-router-dom';

import { Wordmark } from './Wordmark.jsx';

/**
 * Shared footer for every public + authenticated page.
 *
 * Two variants:
 *   <Footer />            full — landing + legal pages (3 columns + tagline + bottom bar)
 *   <Footer variant="compact" />   compact — portal pages (single row, legal links inline)
 */
export function Footer({ variant = 'full' }) {
  const year = new Date().getFullYear();

  if (variant === 'compact') {
    return (
      <footer className="mt-auto border-t border-sand bg-cream">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-2 px-4 py-4 text-xs text-stone-500 sm:flex-row sm:justify-between">
          <div className="flex items-center gap-2">
            <Wordmark className="text-base" />
            <span className="hidden text-stone-400 sm:inline">·</span>
            <span className="hidden sm:inline">Choudhari EduHealth India Foundation</span>
          </div>
          <nav className="flex items-center gap-4">
            <Link to="/privacy" className="hover:text-rk-700">Privacy</Link>
            <Link to="/terms" className="hover:text-rk-700">Terms</Link>
            <Link to="/data-deletion" className="hover:text-rk-700">Data deletion</Link>
            <span className="text-stone-400">© {year}</span>
          </nav>
        </div>
      </footer>
    );
  }

  return (
    <footer className="border-t border-sand bg-cream">
      <div className="mx-auto max-w-6xl px-5 py-12">
        {/* ── Top: tagline band ────────────────────────────────────── */}
        <div className="pb-10 text-center">
          <p className="font-display text-lg font-semibold tracking-tight text-rk-700 sm:text-xl">
            A mission-critical operating system for India&rsquo;s bloodstream.
          </p>
          <p className="mt-1 text-sm italic text-stone-500">
            An operating system, not an app.
          </p>
        </div>

        <div className="border-t border-sand"></div>

        {/* ── Middle: three columns ────────────────────────────────── */}
        <div className="grid grid-cols-1 gap-8 pt-10 sm:grid-cols-3">
          <div>
            <Wordmark className="text-2xl" />
            <p className="mt-3 text-xs leading-relaxed text-stone-600">
              A free, life-critical platform connecting voluntary blood donors,
              hospitals, blood banks and camp organisers across India. An initiative
              of Choudhari EduHealth India Foundation.
            </p>
            <p className="mt-3 text-[10px] uppercase tracking-wider text-stone-400">
              NGO-DARPAN MH/2025/0643345 · 80G eligible
            </p>
          </div>

          <div>
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-stone-500">
              Get involved
            </h3>
            <ul className="mt-3 space-y-2 text-sm">
              <li>
                {/* Static page (outside the SPA) — crawlable deep-dive for new visitors */}
                <a href="/how-raktify-works.html" className="text-stone-700 hover:text-rk-700">
                  How Raktify works
                </a>
              </li>
              <li>
                <Link to="/register" className="text-stone-700 hover:text-rk-700">
                  Become a donor
                </Link>
              </li>
              <li>
                <Link to="/onboarding/apply" className="text-stone-700 hover:text-rk-700">
                  Join as a hospital or blood bank
                </Link>
              </li>
              <li>
                <Link to="/camps/host" className="text-stone-700 hover:text-rk-700">
                  Host a donation camp
                </Link>
              </li>
              <li>
                <Link to="/staff/login" className="text-stone-700 hover:text-rk-700">
                  Staff sign-in
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-stone-500">
              Contact &amp; legal
            </h3>
            <address className="mt-3 not-italic text-sm leading-relaxed text-stone-700">
              Choudhari EduHealth India Foundation<br />
              54, 2nd Lane, Rathi Nagar, VMV Road<br />
              Amravati, Maharashtra 444603, India<br />
              <a href="mailto:contact@choudhari.ngo" className="hover:text-rk-700">
                contact@choudhari.ngo
              </a>
              {' · '}
              <a href="tel:+919850541412" className="hover:text-rk-700">
                +91 98505 41412
              </a>
            </address>
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-500">
              <li>
                <Link to="/privacy" className="hover:text-rk-700">
                  Privacy policy
                </Link>
              </li>
              <li>
                <Link to="/terms" className="hover:text-rk-700">
                  Terms of service
                </Link>
              </li>
              <li>
                <Link to="/data-deletion" className="hover:text-rk-700">
                  Data deletion
                </Link>
              </li>
            </ul>
          </div>
        </div>

        {/* ── Bottom: copyright bar ────────────────────────────────── */}
        <div className="mt-10 border-t border-sand pt-5 text-center text-[11px] text-stone-400">
          © {year} Choudhari EduHealth India Foundation · Raktify is a free, India-first
          digital public good · Built in Amravati, with love.
        </div>
      </div>
    </footer>
  );
}
