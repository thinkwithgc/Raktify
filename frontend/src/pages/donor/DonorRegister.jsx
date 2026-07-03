import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { Header } from '../../components/Header.jsx';
import { LocalityPicker } from '../../components/LocalityPicker.jsx';
import { apiRequest } from '../../lib/api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { useT } from '../../i18n/useT.js';

// 2-step donor registration (simplified 2026-07-03):
//   1 = personal details  → POST /donors/register
//   2 = consent + OTP finalisation
//
// The earlier pre-screening (Step 1 Health) and temporary-deferral (Step 3
// Recent) tabs were dropped because:
//   - The blood bank performs the authoritative TTI + interview at donation
//     time. Self-report has no clinical value we don't already re-collect
//     when the donor sits in the chair.
//   - Fewer questions = higher completion rate = larger donor pool.
//   - The DB-level age gate (18–65 via CHECK on date_of_birth) stays in
//     place regardless.

// blood_groups seed (migration 002): id 1..8 → A+ A- B+ B- AB+ AB- O+ O-
const SELF_BLOOD_GROUPS = [
  { id: 1, code: 'A+' },
  { id: 2, code: 'A-' },
  { id: 3, code: 'B+' },
  { id: 4, code: 'B-' },
  { id: 5, code: 'AB+' },
  { id: 6, code: 'AB-' },
  { id: 7, code: 'O+' },
  { id: 8, code: 'O-' },
];

const personalSchema = z.object({
  mobile: z
    .string()
    .trim()
    .regex(/^(\+?91[-\s]?)?[6-9]\d{9}$/, 'invalid_mobile'),
  full_name: z.string().trim().min(2).max(120),
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'invalid_date'),
  gender: z.enum(['M', 'F', 'O']),
  blood_group_self_reported: z.number().int().min(1).max(8).optional(),
  village_id: z.number().int().positive().optional(),
  max_travel_km: z.number().int().min(1).max(100),
  preferred_contact_channel: z.enum(['WA', 'SM', 'CA']),
  whatsapp_opted_in: z.boolean(),
  sms_opted_in: z.boolean(),
});

const initialDetails = {
  mobile: '',
  full_name: '',
  date_of_birth: '',
  gender: 'M',
  blood_group_self_reported: '',
  locality: null, // the full { id, name, name_hi, taluka_name, ... } object from LocalityPicker
  max_travel_km: 10,
  preferred_contact_channel: 'WA',
  whatsapp_opted_in: true,
  sms_opted_in: true,
};

export function DonorRegister() {
  const { t, lang } = useT();
  const { setSession } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState(1);
  const [details, setDetails] = useState(initialDetails);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  // Post-submit handoff state.
  const [registered, setRegistered] = useState(null); // { donor_id, platform_user_id, ... }
  const [otpStage, setOtpStage] = useState('idle'); // 'idle'|'sent'|'verified'|'consented'
  const [otp, setOtp] = useState('');
  const [devOtp, setDevOtp] = useState('');

  // If the user arrived from a public camp link (/register?camp=<slug>),
  // persist that intent in sessionStorage so it survives a multi-step wizard
  // refresh and is honoured by the redirect-after-completion logic below.
  useEffect(() => {
    const campParam = new URLSearchParams(window.location.search).get('camp');
    if (campParam) window.sessionStorage.setItem('rk.pendingCampRsvp', campParam);
  }, []);

  // Phase 3: if the user arrived from /community/<slug> (a leader's referral
  // link), resolve the community slug → id and stash it. We send community_id
  // with the register payload so the donor is attributed correctly.
  const [communityId, setCommunityId] = useState(null);
  const [communityName, setCommunityName] = useState(null);
  useEffect(() => {
    const slug =
      new URLSearchParams(window.location.search).get('community') ||
      window.sessionStorage.getItem('rk.pendingCommunitySlug');
    if (!slug) return;
    let alive = true;
    (async () => {
      try {
        const data = await apiRequest('GET', `/community/${encodeURIComponent(slug)}`);
        if (!alive) return;
        setCommunityId(data.community.id);
        setCommunityName(data.community.name);
      } catch {
        // Bad slug — ignore silently; donor can still register without attribution.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  function update(k, v) {
    setDetails((prev) => ({ ...prev, [k]: v }));
  }

  function backTo(s) {
    setError('');
    setStep(s);
  }

  // ── Step 2: submit ────────────────────────────────────────────────────
  async function submitRegistration() {
    setError('');
    if (!consent) {
      setError('consent_required');
      return;
    }
    const parsed = personalSchema.safeParse({
      ...details,
      blood_group_self_reported:
        details.blood_group_self_reported === ''
          ? undefined
          : Number(details.blood_group_self_reported),
      max_travel_km: Number(details.max_travel_km),
      village_id: details.locality?.id,
      // schema doesn't know about the `locality` UI-only object
      locality: undefined,
    });
    if (!parsed.success) {
      setError('invalid_details');
      setStep(1);
      return;
    }

    setPending(true);
    try {
      const payload = {
        ...parsed.data,
        preferred_language: lang,
        registration_source: 'WEB',
        // Phase 3 attribution: if the user came from /community/<slug>,
        // tag the donor to that community. The backend defaults
        // referred_by_community_leader_id to the community's current owner
        // when only community_id is provided.
        ...(communityId ? { community_id: communityId } : {}),
      };
      const r = await apiRequest('POST', '/donors/register', payload);
      // Successful registration. We still need to (a) verify the mobile
      // via OTP and (b) POST consent. Both require a session — kick OTP.
      setRegistered(r);
      const sent = await apiRequest('POST', '/auth/otp/send', {
        mobile: parsed.data.mobile,
        role_hint: 'donor',
      });
      setOtpStage('sent');
      if (sent.dev_otp) setDevOtp(sent.dev_otp);
    } catch (err) {
      setError(err?.response?.data?.error || err?.response?.data?.message || 'submit_failed');
    } finally {
      setPending(false);
    }
  }

  async function verifyOtp() {
    setError('');
    if (!/^\d{6}$/.test(otp)) {
      setError('otp_must_be_6_digits');
      return;
    }
    setPending(true);
    try {
      const session = await apiRequest('POST', '/auth/otp/verify', {
        mobile: details.mobile,
        otp,
      });
      setSession(session);
      setOtpStage('verified');

      // Now record consent against the freshly-created donor row.
      try {
        await apiRequest('POST', `/donors/${registered.donor_id}/consent`, {
          consent_data_use: true,
        });
      } catch (consentErr) {
        // Consent failure is non-fatal for the user — surface but still send
        // them to the dashboard where they can retry.
        // eslint-disable-next-line no-console
        console.warn('consent_post_failed', consentErr);
      }
      setOtpStage('consented');
      // If they came from a public camp link, bounce back to /c/<slug> so
      // PublicCampPage can auto-RSVP using the sessionStorage marker.
      const campParam = new URLSearchParams(window.location.search).get('camp');
      const pendingCamp = campParam || window.sessionStorage.getItem('rk.pendingCampRsvp');
      navigate(pendingCamp ? `/c/${encodeURIComponent(pendingCamp)}` : '/donor', {
        replace: true,
      });
    } catch (err) {
      setError(err?.response?.data?.error || 'verify_failed');
    } finally {
      setPending(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="min-h-full">
      <Header subtitle={t('app_name')} />
      <main className="mx-auto max-w-2xl px-4 py-6">
        <Stepper
          current={step}
          labels={['Your details', 'Consent']}
          onJump={(s) => (s < step ? backTo(s) : null)}
        />

        {communityName ? (
          <div className="mb-3 rounded-md bg-rk-50 p-2 text-sm text-rk-900 ring-1 ring-rk-200">
            You&apos;re joining <strong>{communityName}</strong>. The community organisers will
            see your name + blood group only — never your mobile.
          </div>
        ) : null}

        {registered && otpStage !== 'idle' ? (
          <div className="rk-card space-y-4">
            <h2 className="text-lg font-semibold text-rk-700">Verify mobile</h2>
            <p className="text-sm text-slate-600">
              We sent a 6-digit code to {details.mobile}. Enter it to finish setting up your
              account.
            </p>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              className="rk-input tracking-[0.5em] text-center text-lg"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
            />
            {devOtp ? (
              <p className="text-xs text-slate-500">dev_otp echoed by backend: {devOtp}</p>
            ) : null}
            <button
              type="button"
              onClick={verifyOtp}
              disabled={pending}
              className="rk-button-primary w-full"
            >
              {pending ? '…' : t('verify_otp')}
            </button>
            {error ? <p className="text-sm text-rk-700">{error}</p> : null}
          </div>
        ) : (
          <>
            {step === 1 ? (
              <StepDetails
                details={details}
                update={update}
                onContinue={() => {
                  // Validate before allowing forward step.
                  const parsed = personalSchema.safeParse({
                    ...details,
                    blood_group_self_reported:
                      details.blood_group_self_reported === ''
                        ? undefined
                        : Number(details.blood_group_self_reported),
                    max_travel_km: Number(details.max_travel_km),
                    village_id: details.locality?.id,
                    locality: undefined,
                  });
                  if (!parsed.success) {
                    setError('invalid_details');
                    return;
                  }
                  setError('');
                  setStep(2);
                }}
                error={error}
              />
            ) : null}

            {step === 2 ? (
              <StepConsent
                consent={consent}
                setConsent={setConsent}
                pending={pending}
                onBack={() => backTo(1)}
                onSubmit={submitRegistration}
                error={error}
              />
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}

// ─── Step 1: personal details ─────────────────────────────────────────────
function StepDetails({ details, update, onContinue, error }) {
  return (
    <section className="rk-card space-y-4">
      <h2 className="text-lg font-semibold text-rk-700">Step 1 — Your details</h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Mobile" htmlFor="r-mobile">
          <input
            id="r-mobile"
            inputMode="tel"
            autoComplete="tel"
            className="rk-input"
            placeholder="+91 9XXXXXXXXX"
            value={details.mobile}
            onChange={(e) => update('mobile', e.target.value)}
            required
          />
        </Field>
        <Field label="Full name" htmlFor="r-name">
          <input
            id="r-name"
            className="rk-input"
            value={details.full_name}
            onChange={(e) => update('full_name', e.target.value)}
            required
            maxLength={120}
          />
        </Field>
        <Field label="Date of birth" htmlFor="r-dob">
          <input
            id="r-dob"
            type="date"
            className="rk-input"
            value={details.date_of_birth}
            onChange={(e) => update('date_of_birth', e.target.value)}
            required
          />
        </Field>
        <Field label="Gender" htmlFor="r-gender">
          <select
            id="r-gender"
            className="rk-input"
            value={details.gender}
            onChange={(e) => update('gender', e.target.value)}
          >
            <option value="M">Male</option>
            <option value="F">Female</option>
            <option value="O">Other</option>
          </select>
        </Field>

        <Field label="Blood group (if known)" htmlFor="r-bg" hint="Self-reported only — a blood bank will verify this on your first donation.">
          <select
            id="r-bg"
            className="rk-input"
            value={details.blood_group_self_reported}
            onChange={(e) => update('blood_group_self_reported', e.target.value)}
          >
            <option value="">I don't know</option>
            {SELF_BLOOD_GROUPS.map((g) => (
              <option key={g.id} value={g.id}>
                {g.code}
              </option>
            ))}
          </select>
        </Field>
        <div className="sm:col-span-2">
          <LocalityPicker
            id="r-locality"
            label="Your village or area (optional)"
            value={details.locality}
            onChange={(loc) => update('locality', loc)}
          />
          <p className="mt-1 text-xs text-slate-500">
            Type the name of your village, city, or (in Amravati City) your ward.
            We use this only to route alerts — we never ask for your street address.
          </p>
        </div>

        <Field label="Max travel (km)" htmlFor="r-km">
          <input
            id="r-km"
            type="number"
            min={1}
            max={100}
            className="rk-input"
            value={details.max_travel_km}
            onChange={(e) => update('max_travel_km', Number(e.target.value || 0))}
          />
        </Field>
        <Field label="Preferred contact" htmlFor="r-channel">
          <select
            id="r-channel"
            className="rk-input"
            value={details.preferred_contact_channel}
            onChange={(e) => update('preferred_contact_channel', e.target.value)}
          >
            <option value="WA">WhatsApp</option>
            <option value="SM">SMS</option>
            <option value="CA">Call</option>
          </select>
        </Field>

        <label className="flex items-center gap-2 sm:col-span-2">
          <input
            type="checkbox"
            checked={details.whatsapp_opted_in}
            onChange={(e) => update('whatsapp_opted_in', e.target.checked)}
          />
          <span className="text-sm text-slate-700">
            I'm OK to receive WhatsApp messages about emergency requests
          </span>
        </label>
        <label className="flex items-center gap-2 sm:col-span-2">
          <input
            type="checkbox"
            checked={details.sms_opted_in}
            onChange={(e) => update('sms_opted_in', e.target.checked)}
          />
          <span className="text-sm text-slate-700">I'm OK to receive SMS</span>
        </label>
      </div>

      {error ? <p className="text-sm text-rk-700">{error}</p> : null}

      <div className="flex justify-end">
        <button type="button" className="rk-button-primary" onClick={onContinue}>
          Continue
        </button>
      </div>
    </section>
  );
}

// ─── Step 2: consent ──────────────────────────────────────────────────────
function StepConsent({ consent, setConsent, pending, onBack, onSubmit, error }) {
  return (
    <section className="rk-card space-y-4">
      <h2 className="text-lg font-semibold text-rk-700">Step 2 — Consent</h2>
      <div className="space-y-2 text-sm text-slate-700">
        <p>
          Raktify uses your contact details and donation history only to match you with
          patients who need blood. We never share your mobile number with hospitals — every
          donor↔hospital message goes through our coordinators.
        </p>
        <p>
          You can change your availability or withdraw consent at any time from your dashboard.
        </p>
      </div>
      <label className="flex items-start gap-3 rounded-md bg-rk-50 p-3 ring-1 ring-rk-100">
        <input
          type="checkbox"
          className="mt-1"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
        <span className="text-sm text-rk-900">
          I consent to my details being used to match me with blood donation requests.
        </span>
      </label>
      {error ? <p className="text-sm text-rk-700">{error}</p> : null}
      <div className="flex justify-between">
        <button type="button" className="rk-button-secondary" onClick={onBack} disabled={pending}>
          Back
        </button>
        <button
          type="button"
          className="rk-button-primary"
          onClick={onSubmit}
          disabled={!consent || pending}
        >
          {pending ? '…' : 'Register'}
        </button>
      </div>
    </section>
  );
}

// ─── Shared bits ───────────────────────────────────────────────────────────
function Field({ label, htmlFor, hint, children }) {
  return (
    <div>
      <label className="rk-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

function Stepper({ current, labels, onJump }) {
  return (
    <ol className="mb-4 flex items-center justify-between">
      {labels.map((label, i) => {
        const n = i + 1;
        const done = n < current;
        const here = n === current;
        return (
          <li key={label} className="flex flex-1 items-center">
            <button
              type="button"
              onClick={() => onJump?.(n)}
              className={
                'flex items-center gap-2 ' +
                (done ? 'cursor-pointer text-rk-700' : here ? 'text-rk-900' : 'text-slate-400')
              }
            >
              <span
                className={
                  'flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ' +
                  (done
                    ? 'bg-rk-700 text-white'
                    : here
                      ? 'bg-rk-50 text-rk-700 ring-2 ring-rk-700'
                      : 'bg-slate-100 text-slate-500')
                }
              >
                {n}
              </span>
              <span className="hidden text-sm font-medium sm:inline">{label}</span>
            </button>
            {i < labels.length - 1 ? (
              <div
                className={'mx-2 h-px flex-1 ' + (done ? 'bg-rk-700' : 'bg-slate-200')}
                aria-hidden
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

