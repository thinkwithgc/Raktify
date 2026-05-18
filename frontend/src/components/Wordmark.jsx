// Raktify wordmark.
//
// Two-tone, teaching the bilingual root: "Rakt" (रक्त = blood) in brand red,
// "ify" in warm near-black. The tittle of the lowercase i is a blood droplet —
// the dotless ı (U+0131) carries the stem so the droplet is the only dot.
//
// Everything scales with the inherited font-size (the droplet is sized in em),
// so the same component works from a 14px footer credit to a 96px hero. Style
// it via `className` — pass font-size, and optionally override weight/tracking.
//
//   <Wordmark className="text-2xl" />            — nav
//   <Wordmark className="text-7xl sm:text-8xl" /> — hero
//
// `title` keeps it accessible (the ı + svg would otherwise read oddly to SR).

export function Wordmark({ className = '', style, title = 'Raktify' }) {
  return (
    <span
      className={`font-display font-extrabold leading-none tracking-tight ${className}`}
      style={style}
      role="img"
      aria-label={title}
    >
      <span aria-hidden="true" className="text-rk-700">
        Rakt
      </span>
      <span aria-hidden="true" className="relative inline-block">
        {/* dotless i — the stem only; the droplet below is the tittle */}
        <span className="text-stone-900">ı</span>
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
          className="absolute left-1/2 -translate-x-1/2 text-rk-600"
          style={{ width: '0.46em', height: '0.46em', top: '-0.32em' }}
        >
          <path d="M12 2.5c4 4.8 7 8.3 7 11.5a7 7 0 0 1-14 0c0-3.2 3-6.7 7-11.5Z" />
        </svg>
      </span>
      <span aria-hidden="true" className="text-stone-900">
        fy
      </span>
    </span>
  );
}
