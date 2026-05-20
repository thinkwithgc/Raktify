import { useState } from 'react';
import { Link } from 'react-router-dom';

import { Header } from '../../components/Header.jsx';
import { CoordinatorsTab } from './CoordinatorsTab.jsx';
import { DuplicatesTab } from './DuplicatesTab.jsx';
import { ReferralsTab } from './ReferralsTab.jsx';
import { OnboardingTab } from './OnboardingTab.jsx';
import { LookbackTab } from './LookbackTab.jsx';
import { AuditTab } from './AuditTab.jsx';
import { JobsTab } from './JobsTab.jsx';

// Phase 8 NGO admin dashboard. Each tab maps to a distinct admin endpoint
// added in routes/admin.js (or routes/lookback.js for the lookback queue
// which already existed). Reports live behind a separate route.

const TABS = [
  { id: 'onboarding', label: 'Onboarding' },
  { id: 'coordinators', label: 'Coordinators' },
  { id: 'duplicates', label: 'Duplicates' },
  { id: 'referrals', label: 'Referrals' },
  { id: 'lookback', label: 'Lookback' },
  { id: 'audit', label: 'Audit' },
  { id: 'jobs', label: 'Jobs' },
];

export function AdminDashboard() {
  const [tab, setTab] = useState('onboarding');

  return (
    <div className="min-h-full">
      <Header subtitle="NGO admin" />
      <main className="mx-auto max-w-5xl px-4 py-6">
        <nav className="mb-4 flex flex-wrap items-center gap-2 border-b border-slate-200">
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
          <Link
            to="/admin/reports"
            className="ml-auto rounded-md border border-slate-300 px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Reports →
          </Link>
        </nav>

        {tab === 'onboarding' ? <OnboardingTab /> : null}
        {tab === 'coordinators' ? <CoordinatorsTab /> : null}
        {tab === 'duplicates' ? <DuplicatesTab /> : null}
        {tab === 'referrals' ? <ReferralsTab /> : null}
        {tab === 'lookback' ? <LookbackTab /> : null}
        {tab === 'audit' ? <AuditTab /> : null}
        {tab === 'jobs' ? <JobsTab /> : null}
      </main>
    </div>
  );
}
