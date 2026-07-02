import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';

import { apiRequest } from '../../lib/api.js';

// Public "donor tapped the WhatsApp button" page. Token from URL is the
// auth primitive — no OTP, no login, one tap. Backend verifies the token
// signature + expiry + alert/donor binding. See backend/src/services/
// donor-alert-tokens.js for the shape.

const URG = {
  CR: { label: 'CRITICAL', cls: 'bg-rk-700 text-white', hint: 'Patient life at risk — every minute counts.' },
  UR: { label: 'URGENT',   cls: 'bg-amber-500 text-white', hint: 'Blood needed within a few hours.' },
  PL: { label: 'PLANNED',  cls: 'bg-slate-500 text-white', hint: 'Elective / scheduled transfusion.' },
};

// Minimal in-file i18n so no login flow needs to happen before showing copy.
// Language sourced from donor.preferred_language when known; default English.
const STRINGS = {
  en: {
    hi: 'Hi',
    request_num: 'Request',
    for_hospital: 'Hospital',
    district: 'District',
    need: 'Blood needed',
    units_still_needed: 'units still needed',
    can_you_help: 'Can you help today?',
    share_location: 'Share your location to see nearest blood banks',
    share_button: 'Share location',
    skip_button: 'Skip — show all blood banks',
    loading_gps: 'Getting your location…',
    gps_denied: 'Location access denied. Showing all blood banks — you can still pick one that\'s reachable for you.',
    choose_bb: 'Choose a blood bank to donate at',
    no_bbs: 'No blood banks in this district have compatible stock right now. Please decline for this request — the platform will find another way.',
    distance_km: 'km',
    address: 'Address',
    accept_prompt: 'You have chosen {bb}. When can you reach there?',
    now: 'Within 1 hour',
    hour2: 'Within 2 hours',
    hour4: 'Within 4 hours',
    tomorrow: 'Tomorrow',
    confirm_button: 'Confirm — I will donate here',
    decline_button: 'Not this time',
    thanks_accept: 'Thank you! We\'ve told {bb} to expect you.',
    thanks_bb_address: 'Please carry a photo ID. Address:',
    call_bb: 'Call blood bank',
    thanks_decline: 'Thanks for letting us know. We won\'t send you another alert for a bit.',
    request_closed: 'This request has been fulfilled or closed. Thank you for responding.',
    error_generic: 'Something went wrong. Please try tapping the WhatsApp link again.',
    change_language: 'Language',
  },
  mr: {
    hi: 'नमस्कार',
    request_num: 'विनंती क्रमांक',
    for_hospital: 'रुग्णालय',
    district: 'जिल्हा',
    need: 'आवश्यक रक्त',
    units_still_needed: 'युनिट्सची अजून गरज',
    can_you_help: 'आज मदत करू शकाल का?',
    share_location: 'जवळचे रक्तपेढी पाहण्यासाठी आपले स्थान सामायिक करा',
    share_button: 'स्थान सामायिक करा',
    skip_button: 'वगळा — सर्व रक्तपेढी दाखवा',
    loading_gps: 'आपले स्थान मिळवत आहे…',
    gps_denied: 'स्थानाची परवानगी नाकारली. सर्व रक्तपेढी दाखवत आहे — तुम्हाला जिथे पोहोचता येईल ते निवडा.',
    choose_bb: 'रक्तदान करण्यासाठी रक्तपेढी निवडा',
    no_bbs: 'सध्या या जिल्ह्यात कोणत्याही रक्तपेढीकडे योग्य साठा नाही. कृपया नकार द्या — प्लॅटफॉर्म दुसरा मार्ग शोधेल.',
    distance_km: 'कि.मी.',
    address: 'पत्ता',
    accept_prompt: 'तुम्ही {bb} निवडले आहे. तिथे कधी पोहोचू शकाल?',
    now: '१ तासाच्या आत',
    hour2: '२ तासांच्या आत',
    hour4: '४ तासांच्या आत',
    tomorrow: 'उद्या',
    confirm_button: 'पुष्टी करा — मी येथे रक्तदान करेन',
    decline_button: 'यावेळी नाही',
    thanks_accept: 'धन्यवाद! आम्ही {bb} ला तुमची अपेक्षा करण्यास सांगितले आहे.',
    thanks_bb_address: 'कृपया फोटो ID सोबत आणा. पत्ता:',
    call_bb: 'रक्तपेढीला फोन करा',
    thanks_decline: 'कळवल्याबद्दल धन्यवाद. काही काळ तुम्हाला दुसरा अलर्ट पाठवला जाणार नाही.',
    request_closed: 'ही विनंती पूर्ण झाली आहे किंवा बंद केली आहे. प्रतिसाद दिल्याबद्दल धन्यवाद.',
    error_generic: 'काहीतरी चूक झाली. कृपया पुन्हा WhatsApp लिंकवर टॅप करा.',
    change_language: 'भाषा',
  },
  hi: {
    hi: 'नमस्ते',
    request_num: 'अनुरोध क्रमांक',
    for_hospital: 'अस्पताल',
    district: 'जिला',
    need: 'आवश्यक रक्त',
    units_still_needed: 'यूनिट्स की और आवश्यकता है',
    can_you_help: 'क्या आप आज मदद कर सकते हैं?',
    share_location: 'नज़दीकी ब्लड बैंक देखने के लिए अपना स्थान साझा करें',
    share_button: 'स्थान साझा करें',
    skip_button: 'छोड़ें — सभी ब्लड बैंक दिखाएँ',
    loading_gps: 'आपका स्थान प्राप्त कर रहे हैं…',
    gps_denied: 'स्थान की अनुमति अस्वीकृत. सभी ब्लड बैंक दिखा रहे हैं — जहाँ पहुँच सकें वहाँ चुनें.',
    choose_bb: 'रक्तदान के लिए ब्लड बैंक चुनें',
    no_bbs: 'इस जिले के किसी भी ब्लड बैंक में इस समय संगत स्टॉक नहीं है. कृपया अस्वीकार करें — प्लेटफ़ॉर्म दूसरा रास्ता खोजेगा.',
    distance_km: 'कि.मी.',
    address: 'पता',
    accept_prompt: 'आपने {bb} चुना है. वहाँ कब पहुँच सकते हैं?',
    now: '1 घंटे के भीतर',
    hour2: '2 घंटे के भीतर',
    hour4: '4 घंटे के भीतर',
    tomorrow: 'कल',
    confirm_button: 'पुष्टि करें — मैं यहाँ रक्तदान करूँगा',
    decline_button: 'इस बार नहीं',
    thanks_accept: 'धन्यवाद! हमने {bb} को आपकी अपेक्षा करने को कहा है.',
    thanks_bb_address: 'कृपया फोटो ID साथ लाएँ. पता:',
    call_bb: 'ब्लड बैंक को फ़ोन करें',
    thanks_decline: 'सूचित करने के लिए धन्यवाद. कुछ समय के लिए हम आपको दूसरा अलर्ट नहीं भेजेंगे.',
    request_closed: 'यह अनुरोध पूरा हो गया है या बंद हो गया है. उत्तर देने के लिए धन्यवाद.',
    error_generic: 'कुछ गड़बड़ हो गई. कृपया WhatsApp लिंक पर फिर से टैप करें.',
    change_language: 'भाषा',
  },
};

function T({ lang, k, replace }) {
  const base = STRINGS[lang]?.[k] ?? STRINGS.en[k] ?? k;
  if (!replace) return base;
  return Object.entries(replace).reduce(
    (s, [key, val]) => s.replaceAll(`{${key}}`, val),
    base,
  );
}

export function DonorAlertResponse() {
  const { token } = useParams();
  const nav = useNavigate();

  const [gpsState, setGpsState] = useState('idle'); // idle | requesting | granted | denied
  const [coords, setCoords] = useState(null);
  const [lang, setLang] = useState('en');
  const [chosenBB, setChosenBB] = useState(null);
  const [phase, setPhase] = useState('gps'); // gps | pick | timing | done_accept | done_decline

  // Fetch alert + BB list. Refetches when coords change.
  const alertQ = useQuery({
    queryKey: ['public-alert', token, coords?.lat, coords?.lng],
    queryFn: () => {
      const params = coords ? `?lat=${coords.lat}&lng=${coords.lng}` : '';
      return apiRequest('GET', `/donor-alerts/public/${token}${params}`);
    },
    retry: 0,
  });

  // Once we have the donor's preferred_language, honour it.
  useEffect(() => {
    const donorLang = alertQ.data?.alert?.donor_language;
    if (donorLang && STRINGS[donorLang]) setLang(donorLang);
  }, [alertQ.data]);

  const acceptM = useMutation({
    mutationFn: (body) => apiRequest('POST', `/donor-alerts/public/${token}/accept-with-bb`, body),
    onSuccess: () => setPhase('done_accept'),
  });
  const declineM = useMutation({
    mutationFn: () => apiRequest('POST', `/donor-alerts/public/${token}/decline`, {}),
    onSuccess: () => setPhase('done_decline'),
  });

  const askForGPS = () => {
    if (!navigator.geolocation) {
      setGpsState('denied');
      setPhase('pick');
      return;
    }
    setGpsState('requesting');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGpsState('granted');
        setPhase('pick');
      },
      () => {
        setGpsState('denied');
        setPhase('pick');
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 },
    );
  };
  const skipGPS = () => {
    setGpsState('skipped');
    setPhase('pick');
  };

  if (alertQ.isLoading) {
    return <Shell><p className="text-center text-slate-500">…</p></Shell>;
  }
  if (alertQ.error) {
    const code = alertQ.error?.response?.data?.error;
    const msg =
      code === 'token_expired'
        ? 'This link has expired. Thank you for coming — the request may have been fulfilled by someone else.'
        : code === 'alert_not_found'
        ? 'Alert not found. Please tap the WhatsApp link again.'
        : STRINGS[lang].error_generic;
    return (
      <Shell>
        <div className="rk-card mt-8 text-center">
          <p className="text-slate-700">{msg}</p>
        </div>
      </Shell>
    );
  }

  const { alert, blood_bank_options: bbs } = alertQ.data;
  const u = URG[alert.urgency_tier] || URG.PL;
  const closedStatus = ['FU', 'CL', 'CA', 'EX', 'RE'].includes(alert.request_status);

  if (closedStatus || phase === 'done_decline') {
    return (
      <Shell lang={lang} onLang={setLang}>
        <div className="rk-card mt-6 text-center">
          <p className="text-lg font-semibold text-slate-900">
            {closedStatus ? <T lang={lang} k="request_closed" /> : <T lang={lang} k="thanks_decline" />}
          </p>
        </div>
      </Shell>
    );
  }

  if (phase === 'done_accept') {
    return (
      <Shell lang={lang} onLang={setLang}>
        <div className="rk-card mt-6 space-y-3 text-center">
          <p className="text-lg font-semibold text-slate-900">
            <T lang={lang} k="thanks_accept" replace={{ bb: chosenBB?.bb_name }} />
          </p>
          {chosenBB?.address ? (
            <p className="text-sm text-slate-600">
              <T lang={lang} k="thanks_bb_address" /> {chosenBB.address}
            </p>
          ) : null}
        </div>
      </Shell>
    );
  }

  return (
    <Shell lang={lang} onLang={setLang}>
      {/* Header */}
      <div className="mt-4 flex items-center justify-between">
        <span className={`rounded px-2 py-1 text-[10px] font-bold ${u.cls}`}>{u.label}</span>
        <span className="font-mono text-[11px] text-slate-500">{alert.request_number}</span>
      </div>
      <h1 className="mt-2 text-xl font-bold text-slate-900">
        <T lang={lang} k="hi" />, {alert.donor_name?.split(' ')[0]}.
      </h1>
      <p className="mt-1 text-sm text-slate-600">
        {u.hint}
      </p>

      {/* Request card */}
      <article className="rk-card mt-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-xs uppercase text-slate-500"><T lang={lang} k="for_hospital" /></div>
            <div className="font-semibold text-slate-900">{alert.hospital_name}</div>
            <div className="text-xs text-slate-500">{alert.district_name}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-slate-500"><T lang={lang} k="need" /></div>
            <div className="font-semibold text-slate-900">
              {alert.blood_group} · {alert.component}
            </div>
            <div className="text-xs text-slate-500">
              {alert.units_required} <T lang={lang} k="units_still_needed" />
            </div>
          </div>
        </div>
      </article>

      {/* Phase: GPS request */}
      {phase === 'gps' ? (
        <article className="rk-card mt-4">
          <p className="text-sm text-slate-700">
            <T lang={lang} k="share_location" />
          </p>
          {gpsState === 'requesting' ? (
            <p className="mt-3 text-center text-xs text-slate-500">
              <T lang={lang} k="loading_gps" />
            </p>
          ) : null}
          <div className="mt-3 flex flex-col gap-2">
            <button
              type="button"
              onClick={askForGPS}
              disabled={gpsState === 'requesting'}
              className="w-full rounded bg-rk-700 px-3 py-2.5 text-sm font-semibold text-white hover:bg-rk-800 disabled:opacity-60"
            >
              <T lang={lang} k="share_button" />
            </button>
            <button
              type="button"
              onClick={skipGPS}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <T lang={lang} k="skip_button" />
            </button>
          </div>
        </article>
      ) : null}

      {/* Phase: pick BB */}
      {phase === 'pick' ? (
        <article className="rk-card mt-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            <T lang={lang} k="choose_bb" />
          </h2>
          {gpsState === 'denied' ? (
            <p className="mt-2 text-xs text-amber-700">
              <T lang={lang} k="gps_denied" />
            </p>
          ) : null}
          {bbs.length === 0 ? (
            <div className="mt-3">
              <p className="text-sm text-slate-600">
                <T lang={lang} k="no_bbs" />
              </p>
              <button
                type="button"
                onClick={() => declineM.mutate()}
                className="mt-3 w-full rounded border border-slate-300 px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                <T lang={lang} k="decline_button" />
              </button>
            </div>
          ) : (
            <ul className="mt-3 space-y-2">
              {bbs.map((bb) => (
                <li key={bb.blood_bank_id}>
                  <button
                    type="button"
                    onClick={() => {
                      setChosenBB(bb);
                      setPhase('timing');
                    }}
                    className="w-full rounded border border-slate-200 p-3 text-left hover:border-rk-700 hover:bg-rk-50"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{bb.bb_name}</div>
                        {bb.address ? (
                          <div className="text-xs text-slate-500">{bb.address}</div>
                        ) : null}
                      </div>
                      {bb.distance_km != null ? (
                        <span className="whitespace-nowrap rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                          {Number(bb.distance_km).toFixed(1)} <T lang={lang} k="distance_km" />
                        </span>
                      ) : null}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </article>
      ) : null}

      {/* Phase: pick timing + confirm */}
      {phase === 'timing' && chosenBB ? (
        <article className="rk-card mt-4 space-y-3">
          <p className="text-sm text-slate-800">
            <T lang={lang} k="accept_prompt" replace={{ bb: chosenBB.bb_name }} />
          </p>
          <div className="grid grid-cols-2 gap-2">
            {['now', 'hour2', 'hour4', 'tomorrow'].map((slot) => {
              const hours = { now: 1, hour2: 2, hour4: 4, tomorrow: 24 }[slot];
              const eta = new Date(Date.now() + hours * 3600_000).toISOString();
              return (
                <button
                  key={slot}
                  type="button"
                  onClick={() =>
                    acceptM.mutate({
                      chosen_blood_bank_id: chosenBB.blood_bank_id,
                      donor_lat: coords?.lat,
                      donor_lng: coords?.lng,
                      distance_to_bb_km: chosenBB.distance_km,
                      expected_arrival_at: eta,
                    })
                  }
                  disabled={acceptM.isPending}
                  className="rounded border border-slate-300 px-3 py-2.5 text-sm font-semibold text-slate-700 hover:border-rk-700 hover:bg-rk-50 disabled:opacity-60"
                >
                  <T lang={lang} k={slot} />
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => setPhase('pick')}
            className="w-full rounded border border-slate-200 px-3 py-2 text-xs text-slate-500 hover:bg-slate-50"
          >
            ← change blood bank
          </button>
        </article>
      ) : null}

      {/* Decline anytime */}
      {phase !== 'timing' && phase !== 'done_accept' ? (
        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={() => declineM.mutate()}
            disabled={declineM.isPending}
            className="text-sm text-slate-500 underline hover:text-rk-700 disabled:opacity-60"
          >
            <T lang={lang} k="decline_button" />
          </button>
        </div>
      ) : null}

      <div className="h-16" /> {/* bottom spacer for mobile */}
    </Shell>
  );
}

function Shell({ children, lang = 'en', onLang }) {
  const langOptions = useMemo(
    () => [
      { code: 'en', label: 'English' },
      { code: 'mr', label: 'मराठी' },
      { code: 'hi', label: 'हिंदी' },
    ],
    [],
  );
  return (
    <div className="min-h-screen bg-slate-50 pb-8">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-md items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-rk-700">Raktify</span>
            <span className="text-xs text-slate-500">a Choudhari Foundation initiative</span>
          </div>
          {onLang ? (
            <select
              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
              value={lang}
              onChange={(e) => onLang(e.target.value)}
              aria-label="Change language"
            >
              {langOptions.map((o) => (
                <option key={o.code} value={o.code}>{o.label}</option>
              ))}
            </select>
          ) : null}
        </div>
      </header>
      <main className="mx-auto max-w-md px-4">{children}</main>
    </div>
  );
}

export default DonorAlertResponse;
