import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';

import { Header } from '../../components/Header.jsx';
import { Footer } from '../../components/Footer.jsx';
import { apiRequest } from '../../lib/api.js';
import { errorMessage } from '../../lib/errorMessage.js';

// A donor/citizen raises a blood request on a patient's behalf. They pick an
// onboarded hospital (which is then asked to confirm the clinical need) OR name
// one that isn't on Raktify yet — which quietly becomes an onboarding lead. A
// citizen can't declare CRITICAL; max urgency is Urgent.
const BLOOD_GROUPS = [
  { id: 1, code: 'A+' }, { id: 2, code: 'A-' }, { id: 3, code: 'B+' }, { id: 4, code: 'B-' },
  { id: 5, code: 'AB+' }, { id: 6, code: 'AB-' }, { id: 7, code: 'O+' }, { id: 8, code: 'O-' },
];
const COMPONENTS = [
  { id: 1, code: 'WB', name: 'Whole Blood' }, { id: 2, code: 'RBC', name: 'Red Cells' },
  { id: 3, code: 'FFP', name: 'Fresh Frozen Plasma' }, { id: 4, code: 'PLT', name: 'Platelets' },
  { id: 5, code: 'CRY', name: 'Cryoprecipitate' }, { id: 6, code: 'SDP', name: 'Single-Donor Platelet' },
];

// Module-level so it isn't a new component identity each render (which would
// remount the form and drop input focus on every keystroke).
function Shell({ children }) {
  return (
    <div className="flex min-h-full flex-col">
      <Header subtitle="Raise a request" />
      <main className="mx-auto w-full max-w-2xl px-4 py-6">{children}</main>
      <Footer variant="compact" />
    </div>
  );
}

export function DonorRaiseRequest() {
  const navigate = useNavigate();
  const [stateId, setStateId] = useState('');
  const [districtId, setDistrictId] = useState('');
  const [namedMode, setNamedMode] = useState(false);
  const [hospitalId, setHospitalId] = useState('');
  const [hospitalName, setHospitalName] = useState('');
  const [hospitalAddress, setHospitalAddress] = useState('');
  const [hospitalQuery, setHospitalQuery] = useState('');
  const [form, setForm] = useState({
    patient_initials: '', patient_age: 30, patient_gender: 'M',
    patient_blood_group_id: 7, component_id: 2, units_required: 1,
    urgency_tier: 'UR', needed_by: '', ward_or_bed: '', clinical_indication: '',
  });
  const [err, setErr] = useState(null);
  const [result, setResult] = useState(null);

  const statesQ = useQuery({ queryKey: ['geo', 'states'], queryFn: () => apiRequest('GET', '/geography/states') });
  const districtsQ = useQuery({
    queryKey: ['geo', 'districts', stateId],
    queryFn: () => apiRequest('GET', `/geography/districts?state_id=${stateId}`),
    enabled: !!stateId,
  });
  const hospitalsQ = useQuery({
    queryKey: ['hospital-options', districtId, hospitalQuery],
    queryFn: () =>
      apiRequest('GET', `/requests/hospital-options?district_id=${districtId}&q=${encodeURIComponent(hospitalQuery)}`),
    enabled: !!districtId && !namedMode,
  });

  const up = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const raise = useMutation({
    mutationFn: (payload) => apiRequest('POST', '/requests/citizen', payload),
    onSuccess: (data) => { setErr(null); setResult(data); },
    onError: (e) => setErr(errorMessage(e, 'raise this request')),
  });

  function submit(e) {
    e.preventDefault();
    setErr(null);
    if (!districtId) return setErr('Please choose the district first.');
    if (namedMode ? !hospitalName.trim() : !hospitalId) {
      return setErr(namedMode ? 'Enter the hospital name.' : 'Choose a hospital, or tap “not listed”.');
    }
    const base = {
      patient_initials: form.patient_initials,
      patient_age: Number(form.patient_age),
      patient_gender: form.patient_gender,
      patient_blood_group_id: Number(form.patient_blood_group_id),
      component_id: Number(form.component_id),
      units_required: Number(form.units_required),
      urgency_tier: form.urgency_tier,
      needed_by: form.needed_by ? new Date(form.needed_by).toISOString() : '',
      ward_or_bed: form.ward_or_bed,
      clinical_indication: form.clinical_indication || undefined,
      requesting_hospital_district_id: Number(districtId),
    };
    raise.mutate(
      namedMode
        ? { ...base, guest_hospital_name: hospitalName.trim(), guest_hospital_address: hospitalAddress || undefined }
        : { ...base, requesting_institution_id: hospitalId },
    );
  }

  if (result) {
    const named = Boolean(result.referral_id);
    return (
      <Shell>
        <div className="rk-card border-l-4 border-green-500">
          <div className="font-mono text-sm text-slate-600">{result.request?.request_number}</div>
          <h1 className="mt-1 text-lg font-semibold text-green-800">Request submitted</h1>
          <p className="mt-2 text-sm text-slate-700">
            {named ? (
              <>
                We’ve logged your request and noted <strong>{hospitalName}</strong> — a coordinator
                will verify it and we’ll reach out to get that hospital onto Raktify. You’ll be kept
                updated.
              </>
            ) : (
              <>
                The hospital has been asked to <strong>confirm the clinical need</strong>. Once they
                do, we start finding blood right away. A coordinator is watching this case.
              </>
            )}
          </p>
          <div className="mt-4 flex gap-2">
            <Link to="/donor" className="rk-button-secondary">Back to my dashboard</Link>
            <button type="button" className="rk-button-primary" onClick={() => { setResult(null); }}>
              Raise another
            </button>
          </div>
        </div>
      </Shell>
    );
  }

  const districts = districtsQ.data?.districts || districtsQ.data || [];
  const states = statesQ.data?.states || statesQ.data || [];
  const hospitals = hospitalsQ.data?.hospitals || [];

  return (
    <Shell>
      <div className="mb-3">
        <Link to="/donor" className="text-sm text-rk-700 hover:underline">← Back to my dashboard</Link>
      </div>
      <h1 className="text-lg font-semibold text-slate-900">Raise a blood request</h1>
      <p className="mt-1 text-sm text-slate-600">
        For a patient who needs blood. A coordinator reviews every request. You can’t mark a request
        “critical” — for a life-threatening emergency, call the hospital directly.
      </p>

      <form className="mt-4 space-y-5" onSubmit={submit}>
        {/* Area */}
        <section className="rk-card space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Where is the patient?</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="rk-label">State</label>
              <select className="rk-input" value={stateId}
                onChange={(e) => { setStateId(e.target.value); setDistrictId(''); setHospitalId(''); }}>
                <option value="">Select state…</option>
                {states.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="rk-label">District</label>
              <select className="rk-input" value={districtId} disabled={!stateId}
                onChange={(e) => { setDistrictId(e.target.value); setHospitalId(''); }}>
                <option value="">Select district…</option>
                {districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          </div>
        </section>

        {/* Hospital */}
        {districtId ? (
          <section className="rk-card space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Which hospital?</h2>
              <button type="button" className="text-xs font-medium text-rk-700 hover:underline"
                onClick={() => { setNamedMode((v) => !v); setHospitalId(''); setHospitalName(''); }}>
                {namedMode ? 'Pick from the list instead' : 'My hospital isn’t listed'}
              </button>
            </div>

            {namedMode ? (
              <div className="space-y-2">
                <input className="rk-input" placeholder="Hospital name"
                  value={hospitalName} onChange={(e) => setHospitalName(e.target.value)} />
                <input className="rk-input" placeholder="Area / address (optional)"
                  value={hospitalAddress} onChange={(e) => setHospitalAddress(e.target.value)} />
                <p className="text-xs text-slate-500">
                  We’ll invite this hospital to join Raktify so future patients don’t have to do this.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <input className="rk-input" placeholder="Search hospitals…"
                  value={hospitalQuery} onChange={(e) => setHospitalQuery(e.target.value)} />
                {hospitalsQ.isLoading ? <p className="text-sm text-slate-500">…</p> : null}
                {hospitals.length === 0 && !hospitalsQ.isLoading ? (
                  <p className="text-sm text-slate-500">
                    No onboarded hospitals match. Try “My hospital isn’t listed”.
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {hospitals.map((h) => (
                      <li key={h.id}>
                        <button type="button" onClick={() => setHospitalId(h.id)}
                          className={'flex w-full items-center justify-between rounded p-2 text-left text-sm hover:bg-slate-50 ' +
                            (hospitalId === h.id ? 'bg-rk-50 ring-1 ring-rk-200' : '')}>
                          <span className="font-medium text-slate-900">{h.display_name}</span>
                          {hospitalId === h.id ? <span className="text-rk-700">✓</span> : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>
        ) : null}

        {/* Patient + clinical */}
        <section className="rk-card space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Patient &amp; blood needed</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="rk-label">Patient initials</label>
              <input className="rk-input" maxLength={10} required
                value={form.patient_initials} onChange={(e) => up('patient_initials', e.target.value)} />
            </div>
            <div>
              <label className="rk-label">Age</label>
              <input type="number" min={0} max={120} className="rk-input" required
                value={form.patient_age} onChange={(e) => up('patient_age', e.target.value)} />
            </div>
            <div>
              <label className="rk-label">Gender</label>
              <select className="rk-input" value={form.patient_gender} onChange={(e) => up('patient_gender', e.target.value)}>
                <option value="M">Male</option><option value="F">Female</option><option value="O">Other</option>
              </select>
            </div>
            <div>
              <label className="rk-label">Blood group</label>
              <select className="rk-input" value={form.patient_blood_group_id} onChange={(e) => up('patient_blood_group_id', e.target.value)}>
                {BLOOD_GROUPS.map((g) => <option key={g.id} value={g.id}>{g.code}</option>)}
              </select>
            </div>
            <div>
              <label className="rk-label">Component</label>
              <select className="rk-input" value={form.component_id} onChange={(e) => up('component_id', e.target.value)}>
                {COMPONENTS.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="rk-label">Units</label>
              <input type="number" min={1} max={20} className="rk-input" required
                value={form.units_required} onChange={(e) => up('units_required', e.target.value)} />
            </div>
            <div>
              <label className="rk-label">Ward / bed</label>
              <input className="rk-input" required value={form.ward_or_bed} onChange={(e) => up('ward_or_bed', e.target.value)} />
            </div>
            <div>
              <label className="rk-label">Needed by</label>
              <input type="datetime-local" className="rk-input" required
                value={form.needed_by} onChange={(e) => up('needed_by', e.target.value)} />
            </div>
          </div>
          <fieldset>
            <legend className="rk-label">Urgency</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {[{ code: 'PL', label: 'Planned', hint: 'next 24–48h' }, { code: 'UR', label: 'Urgent', hint: 'within hours' }].map((u) => (
                <button type="button" key={u.code} onClick={() => up('urgency_tier', u.code)}
                  className={'rounded-lg border p-3 text-left ' +
                    (form.urgency_tier === u.code ? 'border-rk-700 bg-rk-50 text-rk-900' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50')}>
                  <div className="font-semibold">{u.label}</div>
                  <div className="text-xs text-slate-500">{u.hint}</div>
                </button>
              ))}
            </div>
          </fieldset>
          <div>
            <label className="rk-label">Clinical note (optional)</label>
            <textarea rows={2} className="rk-input" value={form.clinical_indication}
              onChange={(e) => up('clinical_indication', e.target.value)} />
          </div>
        </section>

        {err ? <p className="text-sm text-rk-700">{err}</p> : null}
        <button type="submit" className="rk-button-primary w-full" disabled={raise.isPending}>
          {raise.isPending ? 'Submitting…' : 'Submit request'}
        </button>
      </form>
    </Shell>
  );
}
