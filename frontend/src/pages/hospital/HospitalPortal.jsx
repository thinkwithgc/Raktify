import { useState } from 'react';

import { Header } from '../../components/Header.jsx';
import { HospitalActiveRequests } from './HospitalActiveRequests.jsx';
import { HospitalRaiseRequest } from './HospitalRaiseRequest.jsx';
import { useT } from '../../i18n/useT.js';

export function HospitalPortal() {
  const { t } = useT();
  const [tab, setTab] = useState('mine');
  const TABS = [
    { id: 'mine', label: t('my_requests') },
    { id: 'raise', label: t('raise_new') },
  ];

  return (
    <div className="min-h-full">
      <Header subtitle="Hospital portal" />
      <main className="mx-auto max-w-3xl px-4 py-6">
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

        {tab === 'mine' ? <HospitalActiveRequests /> : null}
        {tab === 'raise' ? <HospitalRaiseRequest /> : null}
      </main>
    </div>
  );
}
