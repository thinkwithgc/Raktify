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

  const [step, setStep] = useState('mobile'); // 'mobile' | 'otp'
  const [mobile, setMobile] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [devOtp, setDevOtp] = useState('');

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
        role_hint: 'donor',
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
      const r = await apiRequest('POST', '/auth/otp/verify', { mobile, otp });
      setSession(r);
      navigate(r.role === 'coordinator' ? '/coordinator' : '/donor', { replace: true });
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
          <h1 className="text-xl font-semibold text-rk-700">{t('role_donor')}</h1>

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
            <p className="mt-4 text-center text-sm text-slate-600">
              First time donor?{' '}
              <Link to="/register" className="font-medium text-rk-700 hover:underline">
                Register here
              </Link>
            </p>
          ) : null}
        </div>
      </main>
    </div>
  );
}
