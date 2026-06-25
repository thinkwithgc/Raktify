import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { Header } from '../../components/Header.jsx';
import { apiRequest } from '../../lib/api.js';
import { useT } from '../../i18n/useT.js';

/**
 * Magic-link password setup for institutional admins.
 *
 * Lands here from the institutional_setup_link WhatsApp template:
 *   https://raktify.choudhari.ngo/setup/<token>
 *
 * Flow:
 *   1. Mount → GET /auth/setup/:token → fetches user/institution display info.
 *      404 = invalid token, 410 = expired or used (already consumed).
 *   2. User enters a new password + confirms.
 *   3. POST /auth/setup/:token → backend sets password atomically.
 *   4. Redirect to /staff/login with a success flash.
 */
export function SetupPassword() {
  const { t } = useT();
  const { token } = useParams();
  const navigate = useNavigate();

  const [state, setState] = useState({ kind: 'loading' });
  const [pwd, setPwd] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await apiRequest('GET', `/auth/setup/${encodeURIComponent(token)}`);
        if (!alive) return;
        setState({ kind: 'ready', data });
      } catch (err) {
        if (!alive) return;
        const status = err?.response?.status;
        const code = err?.response?.data?.error || 'unknown';
        if (status === 404) setState({ kind: 'invalid' });
        else if (status === 410) setState({ kind: code === 'used' ? 'used' : 'expired' });
        else setState({ kind: 'error', message: err?.message || 'unknown' });
      }
    })();
    return () => {
      alive = false;
    };
  }, [token]);

  // Client-side password validity. Backend re-validates with the same rules.
  const passwordIssues = [];
  if (pwd.length > 0) {
    if (pwd.length < 12) passwordIssues.push(t('setup_pwd_min'));
    if (!/[A-Za-z]/.test(pwd)) passwordIssues.push(t('setup_pwd_letter'));
    if (!/[0-9]/.test(pwd)) passwordIssues.push(t('setup_pwd_digit'));
  }
  const passwordMatches = pwd.length > 0 && pwd === confirm;
  const canSubmit = pwd.length >= 12 && passwordIssues.length === 0 && passwordMatches;

  async function onSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await apiRequest('POST', `/auth/setup/${encodeURIComponent(token)}`, {
        password: pwd,
        confirm_password: confirm,
      });
      // Success — kick them to staff login with a flag the login page can show.
      navigate('/staff/login?setup=success');
    } catch (err) {
      const status = err?.response?.status;
      const code = err?.response?.data?.error || 'unknown';
      if (status === 410) setState({ kind: code === 'used' ? 'used' : 'expired' });
      else if (status === 404) setState({ kind: 'invalid' });
      else setSubmitError(code);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-full bg-cream font-sans text-stone-800">
      <Header subtitle={t('setup_subtitle')} />
      <main className="mx-auto max-w-md px-4 py-10">
        {state.kind === 'loading' && (
          <p className="text-stone-500">{t('setup_loading')}</p>
        )}

        {state.kind === 'invalid' && (
          <ErrorCard
            title={t('setup_invalid_title')}
            body={t('setup_invalid_body')}
          />
        )}
        {state.kind === 'expired' && (
          <ErrorCard
            title={t('setup_expired_title')}
            body={t('setup_expired_body')}
          />
        )}
        {state.kind === 'used' && (
          <ErrorCard
            title={t('setup_used_title')}
            body={t('setup_used_body')}
          />
        )}
        {state.kind === 'error' && (
          <ErrorCard
            title={t('setup_error_title')}
            body={`${t('setup_error_body')} (${state.message})`}
          />
        )}

        {state.kind === 'ready' && (
          <form onSubmit={onSubmit} className="space-y-5">
            <header className="space-y-1">
              <h1 className="text-xl font-semibold text-stone-900">
                {t('setup_welcome')}{state.data.signatory_name ? `, ${state.data.signatory_name}` : ''}
              </h1>
              <p className="text-sm text-stone-600">
                {t('setup_intro_for')}{' '}
                <strong className="text-stone-900">{state.data.institution_name}</strong>
              </p>
              <p className="text-xs text-stone-500">
                {t('setup_intro_email')}{' '}
                <code className="rounded bg-sand px-1.5 py-0.5 font-mono text-[12px] text-stone-700">
                  {state.data.email}
                </code>
              </p>
            </header>

            <label className="block">
              <span className="rk-label">{t('setup_password')}</span>
              <input
                type="password"
                value={pwd}
                onChange={(e) => setPwd(e.target.value)}
                className="rk-input w-full"
                autoComplete="new-password"
                minLength={12}
                required
              />
              {pwd.length > 0 && passwordIssues.length > 0 && (
                <ul className="mt-1.5 space-y-0.5 text-xs text-rk-700">
                  {passwordIssues.map((issue, i) => (
                    <li key={i}>• {issue}</li>
                  ))}
                </ul>
              )}
              {pwd.length >= 12 && passwordIssues.length === 0 && (
                <span className="mt-1.5 block text-xs text-emerald-700">
                  ✓ {t('setup_pwd_ok')}
                </span>
              )}
            </label>

            <label className="block">
              <span className="rk-label">{t('setup_confirm')}</span>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="rk-input w-full"
                autoComplete="new-password"
                required
              />
              {confirm.length > 0 && !passwordMatches && (
                <span className="mt-1.5 block text-xs text-rk-700">
                  {t('setup_pwd_mismatch')}
                </span>
              )}
            </label>

            {submitError && (
              <p className="text-sm text-rk-700">
                {t('setup_submit_error')}: {submitError}
              </p>
            )}

            <button
              type="submit"
              disabled={!canSubmit || submitting}
              className="rk-btn rk-btn-primary w-full"
            >
              {submitting ? t('setup_submitting') : t('setup_submit')}
            </button>

            <p className="text-center text-xs text-stone-500">
              {t('setup_already_set')}{' '}
              <Link to="/staff/login" className="text-rk-700 underline">
                {t('setup_login_link')}
              </Link>
            </p>
          </form>
        )}
      </main>
    </div>
  );
}

function ErrorCard({ title, body }) {
  const { t } = useT();
  return (
    <div className="rounded-lg border border-rk-200 bg-rk-50 p-5">
      <h2 className="mb-1 text-base font-semibold text-rk-800">{title}</h2>
      <p className="text-sm text-stone-700">{body}</p>
      <p className="mt-3 text-xs text-stone-600">
        {t('setup_contact_admin')}
      </p>
      <Link
        to="/staff/login"
        className="mt-4 inline-block text-sm text-rk-700 underline"
      >
        {t('setup_back_to_login')}
      </Link>
    </div>
  );
}
