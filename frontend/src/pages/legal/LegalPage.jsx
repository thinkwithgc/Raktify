import { Link } from 'react-router-dom';

import { Header } from '../../components/Header.jsx';
import { Footer } from '../../components/Footer.jsx';

/**
 * Shared layout for /privacy, /terms, /data-deletion.
 *
 * Wraps the long-form legal copy in a typographic shell that prints well,
 * reads well on mobile, and signals "draft v1 — pending legal review" so
 * Meta accepts the URL for app publishing without us misrepresenting the
 * doc as a final legal opinion.
 */
export function LegalPage({ title, lastUpdated, version = 'v1', children }) {
  return (
    <div className="flex min-h-full flex-col bg-cream">
      <Header subtitle="Legal" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-10">
        <div className="mb-6 flex items-center justify-between gap-3 text-xs text-stone-500">
          <Link to="/" className="text-rk-700 hover:underline">← Back to home</Link>
          <span>
            Last updated: {lastUpdated} · {version}
          </span>
        </div>

        <h1 className="font-display text-3xl font-bold tracking-tight text-stone-900 sm:text-4xl">
          {title}
        </h1>

        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <strong>Draft, pending legal review.</strong> This is v1 of our legal documentation,
          prepared by the engineering team and aligned with the Digital Personal Data Protection
          Act 2023. A licensed healthcare lawyer will review and finalise these documents before
          Raktify accepts donors at scale. For specific concerns, write to{' '}
          <a href="mailto:contact@choudhari.ngo" className="font-semibold text-rk-700 underline">
            contact@choudhari.ngo
          </a>.
        </div>

        <article className="rk-legal mt-8 text-[14.5px] text-stone-700">
          {children}
        </article>

        <div className="mt-12 border-t border-sand pt-6 text-xs text-stone-500">
          Have a question or want to exercise one of your rights under DPDP Act 2023? Email{' '}
          <a href="mailto:contact@choudhari.ngo" className="text-rk-700 hover:underline">
            contact@choudhari.ngo
          </a>{' '}
          or call{' '}
          <a href="tel:+919850541412" className="text-rk-700 hover:underline">
            +91 98505 41412
          </a>.
        </div>
      </main>
      <Footer variant="compact" />
    </div>
  );
}
