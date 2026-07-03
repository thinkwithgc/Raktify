import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Header } from '../../components/Header.jsx';
import { Footer } from '../../components/Footer.jsx';
import { LocalityPicker } from '../../components/LocalityPicker.jsx';
import { apiRequest } from '../../lib/api.js';

/**
 * Community creation form for community_leader.
 *
 * Co-leader is REQUIRED — the backend's deferred constraint trigger
 * (migration 277) rolls back the community insert if no moderator row
 * exists at commit. The form makes this explicit: pick a co-leader before
 * "Create" can be clicked.
 *
 * The state/district pickers are simple selects sourced from /geography.
 * Taluka is optional. WhatsApp bridge config is hidden behind a "more
 * options" toggle to keep the primary form short.
 */
export function CommunityCreate() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [form, setForm] = useState({
    name: '',
    slug: '',
    description: '',
    locality: null, // { id, name, taluka_id, taluka_name, district_id, district_name, state_id, state_name, ... }
    co_leader_id: '',
    co_leader_label: '', // display string for the picked leader (UX only)
  });
  const [error, setError] = useState(null);

  // Auto-derive slug from name (only if user hasn't manually edited slug).
  const [slugManual, setSlugManual] = useState(false);
  function update(k, v) {
    setForm((p) => {
      const next = { ...p, [k]: v };
      if (k === 'name' && !slugManual) {
        next.slug = v
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 64);
      }
      return next;
    });
  }

  const submit = useMutation({
    mutationFn: () => {
      const loc = form.locality;
      const body = {
        name: form.name.trim(),
        slug: form.slug.trim(),
        state_id: loc.state_id,
        district_id: loc.district_id,
        co_leader_id: form.co_leader_id,
        // is_public always true — DB default handles it; no toggle in the
        // form because all communities are publicly discoverable for v1.
      };
      if (form.description.trim()) body.description = form.description.trim();
      if (loc.taluka_id) body.taluka_id = loc.taluka_id;
      return apiRequest('POST', '/community-leader/communities', body);
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['community-leader', 'communities'] });
      navigate(`/community-leader/communities/${data.community_id}`);
    },
    onError: (err) => {
      const body = err?.response?.data || {};
      setError(body.detail ? `${body.error}: ${body.detail}` : body.error || 'create_failed');
    },
  });

  const canSubmit =
    form.name.trim().length >= 2 &&
    /^[a-z][a-z0-9-]{2,63}$/.test(form.slug) &&
    !!form.locality?.district_id &&
    !!form.co_leader_id;

  return (
    <div className="flex min-h-full flex-col bg-cream font-sans">
      <Header subtitle="Create community" />
      <main className="mx-auto w-full max-w-2xl px-4 py-6 space-y-5">
        <Link to="/community-leader" className="text-sm text-rk-700 hover:underline">
          ← Back to dashboard
        </Link>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            if (canSubmit) submit.mutate();
          }}
          className="rk-card space-y-4"
        >
          <h1 className="text-xl font-semibold text-stone-900">New community</h1>
          <p className="text-sm text-stone-500">
            Every community needs a <strong>co-leader</strong> — they take over if you ever
            step away. Pick one from your trusted contacts in the platform below.
          </p>

          <Field label="Community name" required>
            <input
              type="text"
              className="rk-input w-full"
              value={form.name}
              onChange={(e) => update('name', e.target.value)}
              required
              minLength={2}
              maxLength={120}
              placeholder="e.g. Marwadi Yuva Manch Amravati"
            />
          </Field>

          <Field label="URL slug (3–64 chars, lowercase letters / digits / dashes)" required>
            <input
              type="text"
              className="rk-input w-full font-mono"
              value={form.slug}
              onChange={(e) => {
                setSlugManual(true);
                update('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
              }}
              required
              pattern="^[a-z][a-z0-9-]{2,63}$"
              placeholder="marwadi-yuva-amravati"
            />
            <p className="mt-1 text-xs text-slate-500">
              Will be publicly visible at <code>/community/{form.slug || 'your-slug'}</code>
            </p>
          </Field>

          <Field label="Short description (optional, 2 000 chars)">
            <textarea
              className="rk-input w-full"
              rows={3}
              value={form.description}
              onChange={(e) => update('description', e.target.value)}
              maxLength={2000}
              placeholder="Who is this community for? What unites them?"
            />
          </Field>

          <LocalityPicker
            id="community-locality"
            label="Community's home village or area"
            value={form.locality}
            onChange={(loc) => update('locality', loc)}
            required
          />
          <p className="-mt-2 text-xs text-slate-500">
            Pick any locality inside the community&apos;s core area. State + district
            + taluka are inferred from your pick — you don&apos;t need to enter them
            separately.
          </p>

          <Field label="Co-leader (required)" required>
            <CoLeaderPicker
              value={form.co_leader_id}
              label={form.co_leader_label}
              onPick={(id, lbl) => setForm((p) => ({ ...p, co_leader_id: id, co_leader_label: lbl }))}
              onClear={() => setForm((p) => ({ ...p, co_leader_id: '', co_leader_label: '' }))}
            />
            <p className="mt-1 text-xs text-slate-500">
              Type to search — only community_leaders who&apos;ve been onboarded to the platform appear.
              If the person you want isn&apos;t here, ask the NGO admin to invite them first.
            </p>
          </Field>

          {error ? <p className="text-sm text-rk-700">{error}</p> : null}

          <div className="flex gap-2 pt-2">
            <Link to="/community-leader" className="rk-button-secondary flex-1 text-center">
              Cancel
            </Link>
            <button
              type="submit"
              className="rk-button-primary flex-1"
              disabled={!canSubmit || submit.isPending}
            >
              {submit.isPending ? 'Creating…' : 'Create community'}
            </button>
          </div>
        </form>
      </main>
      <Footer variant="compact" />
    </div>
  );
}

function Field({ label, required, children }) {
  return (
    <label className="block">
      <span className="rk-label">
        {label}
        {required ? <span className="text-rk-700"> *</span> : null}
      </span>
      {children}
    </label>
  );
}

function CoLeaderPicker({ value, label, onPick, onClear }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const lookupQ = useQuery({
    queryKey: ['cl-lookup', q],
    queryFn: () => apiRequest('GET', `/community-leader/leaders/lookup?q=${encodeURIComponent(q)}`),
    enabled: open && q.trim().length >= 2,
    staleTime: 10_000,
  });

  // Reset query when value is picked.
  useEffect(() => {
    if (value) {
      setOpen(false);
      setQ('');
    }
  }, [value]);

  if (value) {
    return (
      <div className="flex items-center justify-between rounded border border-emerald-200 bg-emerald-50 px-3 py-2">
        <span className="text-sm text-emerald-900">✓ {label}</span>
        <button type="button" className="text-xs text-rk-700 hover:underline" onClick={onClear}>
          Change
        </button>
      </div>
    );
  }

  // Close the dropdown when the user taps anywhere OUTSIDE the picker.
  // Using `onMouseDown` (not `onClick`) on the dropdown buttons + `preventDefault`
  // is the canonical fix for the bug the user hit: the input's blur was firing
  // before the button's click registered, so the dropdown unmounted before
  // onPick could run.
  return (
    <div className="relative">
      <input
        type="text"
        className="rk-input w-full"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Type a name or last 4 mobile digits…"
      />
      {open && q.trim().length >= 2 ? (
        <div className="absolute z-10 mt-1 w-full rounded border border-slate-300 bg-white shadow-lg">
          {lookupQ.isLoading ? (
            <p className="p-2 text-sm text-stone-500">Searching…</p>
          ) : (lookupQ.data?.leaders || []).length === 0 ? (
            <p className="p-2 text-sm text-stone-500">No active leaders match.</p>
          ) : (
            <ul className="max-h-60 overflow-auto">
              {lookupQ.data.leaders.map((l) => (
                <li key={l.id}>
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                    // onMouseDown fires BEFORE the input's blur — without
                    // preventDefault the input loses focus first and the
                    // button click event is lost on mobile browsers. This
                    // pattern is standard for dropdown menus that need to
                    // act before the parent input releases focus.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onPick(
                        l.id,
                        `${l.display_name}${l.district_name ? ` (${l.district_name})` : ''}`,
                      );
                    }}
                  >
                    <div className="font-medium text-stone-900">{l.display_name}</div>
                    {l.district_name || l.state_name ? (
                      <div className="text-xs text-stone-500">
                        {[l.district_name, l.state_name].filter(Boolean).join(', ')}
                      </div>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
