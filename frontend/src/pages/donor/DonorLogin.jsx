import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { Header } from '../../components/Header.jsx';
import { apiRequest } from '../../lib/api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { useT } from '../../i18n/useT.js';

const mobileSchema = z
  .string()
  .trim()
  .regex(/^(\+?91[-\s]?)?[6-9]\d{9}$/, 'invalid_mobile');

export function DonorLogin() {
  const { t } = useT();
  const { setSession } = useAuth();
  const navigate = useNavigate();

  // Pre-fill mobile from ?m= URL param — set by the community_leader_signin
  // WhatsApp template so a leader who taps the "Sign in" button doesn't have
  // to retype their own mobile. Stored as digits only by Meta's button
  // substitution; we strip any non-digit, then re-add the +91 prefix if it's
  // a 10-digit number (the standard Indian shape).
  const params = new URLSearchParams(window.location.search);
  const prefillRaw = (params.get('m') || '').replace(/\D/g, '');
  const prefill =
    prefillRaw.length === 12 && prefillRaw.startsWith('91')
      ? `+${prefillRaw}`
      : prefillRaw.length === 10
        ? `+91${prefillRaw}`
        : prefillRaw
          ? `+${prefillRaw}`
          : '';

  const [step, setStep] = useState('mobile'); // 'mobile' | 'otp'
  const [mobile, setMobile] = useState(prefill);
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [devOtp, setDevOtp] = useState('');

  // Optional ?role= URL param lets non-donor OTP-cluster users (coordinator,
  // community_leader) land here without an auto-created donor row. The
  // backend refuses to auto-create for these roles and returns a clear
  // <role>_not_registered error if their row hasn't been provisioned by
  // the admin invite flow yet.
  const roleHint =
    params.get('role') === 'community_leader'
      ? 'community_leader'
      : params.get('role') === 'coordinator'
        ? 'coordinator'
        : 'donor';

  async function sendOtp(e) {
    e.preventDefault();
    setError('');
    const parsed = mobileSchema.safeParse(mobile);
    if (!parsed.success) {
      setError('invalid_mobile');
      return;
    }
    setPending(true);
    try {
      const r = await apiRequest('POST', '/auth/otp/send', {
        mobile: parsed.data,
        role_hint: roleHint,
      });
      setStep('otp');
      // The backend echoes `dev_otp` only in development mode.
      if (r.dev_otp) setDevOtp(r.dev_otp);
    } catch (err) {
      setError(err?.response?.data?.error || 'send_failed');
    } finally {
      setPending(false);
    }
  }

  async function verifyOtp(e) {
    e.preventDefault();
    setError('');
    if (!/^\d{6}$/.test(otp)) {
      setError('otp_must_be_6_digits');
      return;
    }
    setPending(true);
    try {
      const r = await apiRequest('POST', '/auth/otp/verify', {
        mobile,
        otp,
        role_hint: roleHint,
      });
      setSession(r);
      // If the donor was redirected here from a public camp link (or any
      // /login?return=... handoff), bounce them back to that URL instead of
      // the generic /donor home. PublicCampPage auto-RSVPs from sessionStorage.
      const returnTo = new URLSearchParams(window.location.search).get('return');
      const pendingCamp = window.sessionStorage.getItem('rk.pendingCampRsvp');
      const dest =
        returnTo && returnTo.startsWith('/')
          ? returnTo
          : pendingCamp && r.role === 'donor'
            ? `/c/${encodeURIComponent(pendingCamp)}`
            : r.role === 'coordinator'
              ? '/coordinator'
              : r.role === 'community_leader'
                ? '/community-leader'
                : '/donor';
      navigate(dest, { replace: true });
    } catch (err) {
      setError(err?.response?.data?.error || 'verify_failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="min-h-full">
      <Header />
      <main className="mx-auto max-w-md px-4 py-10">
        <div className="rk-card">
          <h1 className="text-xl font-semibold text-rk-700">{t('lp_cta_login')}</h1>
          <p className="mt-1 text-sm text-slate-500">{t('login_mobile_hint')}</p>

          {step === 'mobile' ? (
            <form className="mt-4 space-y-4" onSubmit={sendOtp}>
              <div>
                <label className="rk-label" htmlFor="mobile">
                  {t('enter_mobile')}
                </label>
                <input
                  id="mobile"
                  inputMode="tel"
                  autoComplete="tel"
                  className="rk-input"
                  placeholder="+91 9XXXXXXXXX"
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                  required
                />
              </div>
              <button type="submit" className="rk-button-primary w-full" disabled={pending}>
                {pending ? '...' : t('send_otp')}
              </button>
            </form>
          ) : (
            <form className="mt-4 space-y-4" onSubmit={verifyOtp}>
              <div>
                <label className="rk-label" htmlFor="otp">
                  {t('enter_otp')}
                </label>
                <input
                  id="otp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  className="rk-input tracking-[0.5em] text-center text-lg"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                  required
                />
                {devOtp ? (
                  <p className="mt-1 text-xs text-slate-500">dev_otp echoed by backend: {devOtp}</p>
                ) : null}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rk-button-secondary"
                  onClick={() => {
                    setStep('mobile');
                    setOtp('');
                    setError('');
                  }}
                >
                  {t('back')}
                </button>
                <button type="submit" className="rk-button-primary flex-1" disabled={pending}>
                  {pending ? '...' : t('verify_otp')}
                </button>
              </div>
            </form>
          )}

          {error ? <p className="mt-3 text-sm text-rk-700">{error}</p> : null}

          {step === 'mobile' ? (
            <>
              <p className="mt-4 text-center text-sm text-slate-600">
                First time donor?{' '}
                <Link to="/register" className="font-medium text-rk-700 hover:underline">
                  Register here
                </Link>
              </p>
              <p className="mt-2 border-t border-slate-100 pt-3 text-center text-xs text-slate-500">
                <Link to="/staff/login" className="font-medium text-rk-700 hover:underline">
                  {t('login_go_staff')}
                </Link>
              </p>
            </>
          ) : null}
        </div>
      </main>
    </div>
  );
}
