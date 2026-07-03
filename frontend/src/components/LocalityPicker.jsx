import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../lib/api.js';

// LocalityPicker
//   Single "Where do you live?" typeahead that searches every leaf locality
//   (villages, urban body catch-alls, and Municipal Corporation wards) across
//   activated districts. Backed by GET /geography/locality-search.
//
// Props
//   value        — the currently-selected locality object (or null)
//   onChange     — called with the full locality object on selection, or null
//                  when the user clears the field
//   districtId   — optional; restrict results to one district (e.g. when the
//                  form already scoped by district)
//   placeholder  — input placeholder text
//   label        — form label (rendered above the input)
//   required     — mark input as required
//   id           — HTML id for the input (label targets it)
//
// The picker debounces at 200ms and displays up to 20 hits. Each hit shows
//   [rural | urban | pesa] · name · <taluka · district>
// and an urban marker in the badge column so the leader / donor can tell
// wards + ULBs apart from rural villages.
export function LocalityPicker({
  value,
  onChange,
  districtId,
  placeholder = 'Type your village, city or ward…',
  label = 'Where do you live?',
  required = false,
  id = 'locality',
}) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const boxRef = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);

  const search = useQuery({
    queryKey: ['locality-search', debounced, districtId || 'any'],
    queryFn: () => {
      const params = new URLSearchParams({ q: debounced, limit: '20' });
      if (districtId) params.set('district_id', String(districtId));
      return apiRequest('GET', `/geography/locality-search?${params.toString()}`);
    },
    enabled: debounced.length >= 2 && open,
    keepPreviousData: true,
    staleTime: 60_000,
  });

  const options = search.data?.localities || [];

  // Close on outside click.
  useEffect(() => {
    function onDoc(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  function pick(loc) {
    onChange(loc);
    setQ('');
    setOpen(false);
    setActiveIdx(0);
  }

  function onKey(e) {
    if (!open || options.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(options[activeIdx]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div ref={boxRef} className="relative">
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-700">
        {label}
        {required ? <span className="text-rk-700"> *</span> : null}
      </label>

      {value ? (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
          <span className="text-lg" aria-hidden="true">
            {value.is_urban ? '🏙️' : '🏘️'}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-slate-900">{value.name}</div>
            <div className="truncate text-xs text-slate-600">
              {[value.taluka_name, value.district_name, value.state_name]
                .filter(Boolean)
                .join(' · ')}
              {value.is_pesa ? (
                <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800">
                  PESA
                </span>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            className="text-xs text-slate-500 hover:text-rk-700"
            onClick={() => {
              onChange(null);
              setQ('');
              setOpen(true);
            }}
          >
            Change
          </button>
        </div>
      ) : (
        <>
          <input
            id={id}
            className="rk-input w-full"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
              setActiveIdx(0);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKey}
            placeholder={placeholder}
            autoComplete="off"
            required={required}
          />
          {open && debounced.length >= 2 ? (
            <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
              {search.isLoading ? (
                <div className="px-3 py-2 text-sm text-slate-500">Searching…</div>
              ) : options.length === 0 ? (
                <div className="px-3 py-2 text-sm text-slate-500">
                  No match. Try the village name in English or Marathi.
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {options.map((loc, i) => (
                    <li key={loc.id}>
                      <button
                        type="button"
                        onMouseEnter={() => setActiveIdx(i)}
                        onClick={() => pick(loc)}
                        className={`flex w-full items-center gap-2 px-3 py-2 text-left ${
                          i === activeIdx ? 'bg-rk-50' : 'bg-white'
                        }`}
                      >
                        <span className="text-lg" aria-hidden="true">
                          {loc.is_urban ? '🏙️' : '🏘️'}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-slate-900">
                            {loc.name}
                            {loc.is_pesa ? (
                              <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800">
                                PESA
                              </span>
                            ) : null}
                          </div>
                          <div className="truncate text-xs text-slate-500">
                            {[loc.taluka_name, loc.district_name, loc.state_name]
                              .filter(Boolean)
                              .join(' · ')}
                          </div>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

export default LocalityPicker;
