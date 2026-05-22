import { useState } from 'react';

import { Header } from '../../components/Header.jsx';
import { Footer } from '../../components/Footer.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';
import { CoordinatorDashboard } from './CoordinatorDashboard.jsx';
import { CoordinatorQueue } from './CoordinatorQueue.jsx';

export function CoordinatorPortal() {
  const { role } = useAuth();
  const [tab, setTab] = useState('dashboard');
  const TABS = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'queue', label: 'Queue' },
  ];

  return (
    <div className="flex min-h-full flex-col">
      <Header subtitle={role === 'coordinator' ? 'Coordinator portal' : role} />
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

        {tab === 'dashboard' ? (
          <CoordinatorDashboard onOpenQueue={() => setTab('queue')} />
        ) : null}
        {tab === 'queue' ? <CoordinatorQueue /> : null}
      </main>
      <Footer variant="compact" />
    </div>
  );
}
