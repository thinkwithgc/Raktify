import { useState } from 'react';

import { Header } from '../../components/Header.jsx';
import { Footer } from '../../components/Footer.jsx';
import { HospitalActiveRequests } from './HospitalActiveRequests.jsx';
import { HospitalDashboard } from './HospitalDashboard.jsx';
import { HospitalRaiseRequest } from './HospitalRaiseRequest.jsx';
import { useT } from '../../i18n/useT.js';

export function HospitalPortal() {
  const { t } = useT();
  const [tab, setTab] = useState('dashboard');
  const TABS = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'mine', label: t('my_requests') },
    { id: 'raise', label: t('raise_new') },
  ];

  // Hospital portal uses a slightly wider canvas than the original two-tab
  // layout so the district-availability grid + KPI row breathe on desktop.
  return (
    <div className="flex min-h-full flex-col">
      <Header subtitle="Hospital portal" />
      <main className="mx-auto w-full max-w-5xl px-4 py-6">
        <nav className="mb-4 flex gap-2 border-b border-slate-200">
          {TABS.map((tt) => (
            <button
              key={tt.id}
              type="button"
              onClick={() => setTab(tt.id)}
              className={
                'border-b-2 px-3 py-2 text-sm font-medium transition-colors ' +
                (tab === tt.id
                  ? 'border-rk-700 text-rk-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800')
              }
            >
              {tt.label}
            </button>
          ))}
        </nav>

        {tab === 'dashboard' ? <HospitalDashboard onRaise={() => setTab('raise')} /> : null}
        {tab === 'mine' ? <HospitalActiveRequests /> : null}
        {tab === 'raise' ? <HospitalRaiseRequest /> : null}
      </main>
      <Footer variant="compact" />
    </div>
  );
}
