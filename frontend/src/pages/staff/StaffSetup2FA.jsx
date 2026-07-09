import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Header } from '../../components/Header.jsx';
import { apiRequest } from '../../lib/api.js';
import { useAuth } from '../../auth/AuthContext.jsx';

// Mandatory 2FA enrolment for staff. Reached with a restricted "totp-pending"
// token issued at login when the account has no authenticator yet — that token
// can only call setup-totp / confirm-totp (enforced server-side). On success
// the backend returns a full session token and we drop the user into their
// portal.

function destFor(role) {
  if (role === 'hospital') return '/hospital';
  if (role === 'blood_bank') return '/bb';
  if (role === 'ngo_admin' || role === 'super_admin') return '/admin';
  if (role === 'coordinator') return '/coordinator';
  if (role === 'dho') return '/dho';
  return '/';
}

function secretFromUri(uri) {
  try {
    return new URL(uri).searchParams.get('secret') || '';
  } catch {
    return '';
  }
}

export function StaffSetup2FA() {
  const { setSession, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [qr, setQr] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/staff/login', { replace: true });
      return;
    }
    let alive = true;
    (async () => {
      try {
        const r = await apiRequest('POST', '/auth/institutional/setup-totp');
        if (!alive) return;
        setQr(r.qr_code_data_url);
        setSecret(secretFromUri(r.otpauth_url));
      } catch (err) {
        if (!alive) return;
        // Already enrolled (e.g. reloaded after finishing) → send to login.
        if (err?.response?.data?.error === 'totp_already_enabled') {
          navigate('/staff/login', { replace: true });
          return;
        }
        setError(err?.response?.data?.error || 'setup_failed');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [isAuthenticated, navigate]);

  async function confirm(e) {
    e.preventDefault();
    setError('');
    if (!/^\d{6}$/.test(code)) {
      setError('enter_6_digit_code');
      return;
    }
    setPending(true);
    try {
      const r = await apiRequest('POST', '/auth/institutional/confirm-totp', { totp_code: code });
      setSession(r); // full session token returned on success
      navigate(destFor(r.role), { replace: true });
    } catch (err) {
      setError(err?.response?.data?.error || 'confirm_failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="min-h-full">
      <Header />
      <main className="mx-auto max-w-md px-4 py-10">
        <div className="rk-card space-y-4">
          <div>
            <h1 className="text-xl font-semibold text-rk-700">Set up two-factor authentication</h1>
            <p className="mt-1 text-sm text-slate-600">
              Staff accounts need an authenticator app. We recommend{' '}
              <strong>Microsoft Authenticator</strong> or <strong>Authy</strong> — both back up to
              the cloud, so a new phone won&apos;t lock you out. Google Authenticator works too.
            </p>
          </div>

          <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
            <li>Install an authenticator app on your phone.</li>
            <li>Open it and tap <strong>+</strong> → <strong>Scan a QR code</strong>.</li>
            <li>Scan the code below, then enter the 6-digit code it shows.</li>
          </ol>

          {loading ? (
            <div className="rk-card text-center text-slate-500">…</div>
          ) : qr ? (
            <div className="flex flex-col items-center gap-2">
              <img
                src={qr}
                alt="Authenticator QR code"
                className="h-48 w-48 rounded-md ring-1 ring-slate-200"
              />
              {secret ? (
                <p className="text-center text-xs text-slate-500">
                  Can&apos;t scan? Enter this key manually:
                  <br />
                  <code className="mt-1 inline-block break-all rounded bg-slate-100 px-2 py-1 font-mono text-[11px] text-slate-700">
                    {secret}
                  </code>
                </p>
              ) : null}
            </div>
          ) : null}

          <form className="space-y-3" onSubmit={confirm}>
            <div>
              <label className="rk-label" htmlFor="totp-confirm">
                6-digit code from your app
              </label>
              <input
                id="totp-confirm"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                className="rk-input tracking-[0.5em] text-center text-lg"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              />
            </div>
            <button
              type="submit"
              className="rk-button-primary w-full"
              disabled={pending || loading || !qr}
            >
              {pending ? '…' : 'Verify & finish'}
            </button>
            {error ? <p className="text-sm text-rk-700">{error}</p> : null}
          </form>
        </div>
      </main>
    </div>
  );
}
