import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';

import { apiRequest } from '../../lib/api.js';
import { requestSchema, zodFlatten } from '../../lib/schemas.js';
import { useT } from '../../i18n/useT.js';

// blood_groups seed (migration 002): id 1..8 → A+ A- B+ B- AB+ AB- O+ O-
const BLOOD_GROUPS = [
  { id: 1, code: 'A+' },
  { id: 2, code: 'A-' },
  { id: 3, code: 'B+' },
  { id: 4, code: 'B-' },
  { id: 5, code: 'AB+' },
  { id: 6, code: 'AB-' },
  { id: 7, code: 'O+' },
  { id: 8, code: 'O-' },
];

// blood_components seed (migration 002): WB, RBC, FFP, PLT, CRY, SDP
const COMPONENTS = [
  { id: 1, code: 'WB', name: 'Whole Blood' },
  { id: 2, code: 'RBC', name: 'Red Cells' },
  { id: 3, code: 'FFP', name: 'Fresh Frozen Plasma' },
  { id: 4, code: 'PLT', name: 'Platelets' },
  { id: 5, code: 'CRY', name: 'Cryoprecipitate' },
  { id: 6, code: 'SDP', name: 'Single-Donor Platelet' },
];

const URGENCY_TIERS = [
  { code: 'PL', label: 'Planned', hint: 'next 24-48h, elective surgery' },
  { code: 'UR', label: 'Urgent', hint: '4-12h, active bleeding' },
  { code: 'CR', label: 'Critical', hint: '<4h, life-threatening' },
];

const blank = {
  patient_initials: '',
  patient_age: 30,
  patient_gender: 'M',
  patient_blood_group_id: 7,
  component_id: 2,
  units_required: 1,
  urgency_tier: 'UR',
  needed_by: '',
  clinical_indication: '',
  ward_or_bed: '',
};

export function HospitalRaiseRequest() {
  const { t } = useT();
  const [form, setForm] = useState(blank);
  const [result, setResult] = useState(null);
  const [validationErrors, setValidationErrors] = useState(null);

  const raise = useMutation({
    mutationFn: (payload) => apiRequest('POST', '/requests', payload),
    onSuccess: (data) => setResult(data),
  });

  function update(k, v) {
    setForm((prev) => ({ ...prev, [k]: v }));
  }

  function submit(e) {
    e.preventDefault();
    setResult(null);
    setValidationErrors(null);
    const needed = form.needed_by ? new Date(form.needed_by).toISOString() : '';
    const candidate = {
      patient_initials: form.patient_initials,
      patient_age: Number(form.patient_age),
      patient_gender: form.patient_gender,
      patient_blood_group_id: Number(form.patient_blood_group_id),
      component_id: Number(form.component_id),
      units_required: Number(form.units_required),
      urgency_tier: form.urgency_tier,
      needed_by: needed,
      clinical_indication: form.clinical_indication || undefined,
      ward_or_bed: form.ward_or_bed || undefined,
    };
    const parsed = requestSchema.safeParse(candidate);
    if (!parsed.success) {
      setValidationErrors(zodFlatten(parsed.error));
      return;
    }
    raise.mutate(parsed.data);
  }

  return (
    <section className="space-y-3">
      <h1 className="text-lg font-semibold text-slate-900">{t('raise_request')}</h1>

      <div>
        {result ? (
          <div className="rk-card mb-4 border-l-4 border-green-500">
            <div className="font-mono text-sm text-slate-700">{result.request_number}</div>
            <div className="font-semibold text-green-800">Request raised</div>
            <div className="text-sm text-slate-600">
              status {result.status} · matched bags {result.matched_bag_count ?? 0}
              {result.fallback_used ? ' · fallback used' : ''}
            </div>
            <button
              type="button"
              className="rk-button-secondary mt-3"
              onClick={() => {
                setResult(null);
                setForm(blank);
              }}
            >
              Raise another
            </button>
          </div>
        ) : null}

        <form className="rk-card space-y-4" onSubmit={submit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="rk-label" htmlFor="initials">
                Patient initials
              </label>
              <input
                id="initials"
                className="rk-input"
                value={form.patient_initials}
                onChange={(e) => update('patient_initials', e.target.value)}
                required
                maxLength={10}
              />
            </div>
            <div>
              <label className="rk-label" htmlFor="age">
                Age
              </label>
              <input
                id="age"
                type="number"
                min={0}
                max={120}
                className="rk-input"
                value={form.patient_age}
                onChange={(e) => update('patient_age', e.target.value)}
                required
              />
            </div>
            <div>
              <label className="rk-label" htmlFor="gender">
                Gender
              </label>
              <select
                id="gender"
                className="rk-input"
                value={form.patient_gender}
                onChange={(e) => update('patient_gender', e.target.value)}
              >
                <option value="M">Male</option>
                <option value="F">Female</option>
                <option value="O">Other</option>
              </select>
            </div>
            <div>
              <label className="rk-label" htmlFor="bg">
                {t('blood_group')}
              </label>
              <select
                id="bg"
                className="rk-input"
                value={form.patient_blood_group_id}
                onChange={(e) => update('patient_blood_group_id', e.target.value)}
              >
                {BLOOD_GROUPS.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.code}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="rk-label" htmlFor="comp">
                Component
              </label>
              <select
                id="comp"
                className="rk-input"
                value={form.component_id}
                onChange={(e) => update('component_id', e.target.value)}
              >
                {COMPONENTS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="rk-label" htmlFor="units">
                {t('units')}
              </label>
              <input
                id="units"
                type="number"
                min={1}
                max={20}
                className="rk-input"
                value={form.units_required}
                onChange={(e) => update('units_required', e.target.value)}
                required
              />
            </div>
          </div>

          <fieldset>
            <legend className="rk-label">{t('urgency')}</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {URGENCY_TIERS.map((u) => {
                const active = form.urgency_tier === u.code;
                return (
                  <button
                    type="button"
                    key={u.code}
                    onClick={() => update('urgency_tier', u.code)}
                    className={
                      'rounded-lg border p-3 text-left transition-colors ' +
                      (active
                        ? 'border-rk-700 bg-rk-50 text-rk-900'
                        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50')
                    }
                  >
                    <div className="font-semibold">{u.label}</div>
                    <div className="text-xs text-slate-500">{u.hint}</div>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div>
            <label className="rk-label" htmlFor="needed">
              Needed by
            </label>
            <input
              id="needed"
              type="datetime-local"
              className="rk-input"
              value={form.needed_by}
              onChange={(e) => update('needed_by', e.target.value)}
              required
            />
          </div>

          <div>
            <label className="rk-label" htmlFor="indication">
              Clinical note
            </label>
            <textarea
              id="indication"
              rows={3}
              className="rk-input"
              value={form.clinical_indication}
              onChange={(e) => update('clinical_indication', e.target.value)}
            />
          </div>

          <button type="submit" className="rk-button-primary w-full" disabled={raise.isPending}>
            {raise.isPending ? '…' : t('submit')}
          </button>

          {validationErrors ? (
            <ul className="rounded-md bg-rk-50 p-3 text-sm text-rk-900 ring-1 ring-rk-100">
              {Object.entries(validationErrors).map(([field, msg]) => (
                <li key={field}>
                  <code className="font-mono text-xs">{field}</code>: {msg}
                </li>
              ))}
            </ul>
          ) : null}

          {raise.error ? (
            <p className="text-sm text-rk-700">
              {raise.error?.response?.data?.error || 'submit_failed'}
            </p>
          ) : null}
        </form>
      </div>
    </section>
  );
}
