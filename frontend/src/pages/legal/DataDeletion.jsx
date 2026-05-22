import { Link } from 'react-router-dom';

import { LegalPage } from './LegalPage.jsx';

export function DataDeletion() {
  return (
    <LegalPage title="Data Deletion Instructions" lastUpdated="21 May 2026" version="v1">
      <p>
        This page explains how to ask <strong>Raktify</strong> (operated by Choudhari
        EduHealth India Foundation) to delete your personal data, what we will delete, what
        we cannot delete by law, and how long the process takes. This page exists to
        satisfy the <strong>Right to Erasure</strong> under India&rsquo;s
        Digital Personal Data Protection Act 2023 and Meta&rsquo;s requirement that every
        published WhatsApp Business app provide deletion instructions.
      </p>

      <h2>1. How to request deletion</h2>
      <p>You have three options. Pick whichever is easiest.</p>

      <h3>Option A — In-app (donors)</h3>
      <ol>
        <li>Sign in at <a href="https://raktify.choudhari.ngo/login">raktify.choudhari.ngo/login</a>.</li>
        <li>Open the donor dashboard.</li>
        <li>
          A self-service "Delete my account" link is on our Q3 2026 roadmap. Until it ships,
          use Option B or Option C — we&rsquo;ll process the request manually within the same
          30-day window.
        </li>
      </ol>

      <h3>Option B — Email</h3>
      <p>
        Send an email to <a href="mailto:contact@choudhari.ngo">contact@choudhari.ngo</a> from
        the email address or mobile number associated with your account. Include:
      </p>
      <ul>
        <li>Your full name as registered.</li>
        <li>Your mobile number (we&rsquo;ll match it against your account).</li>
        <li>The phrase <strong>"Please delete my Raktify data under DPDP Act § 12"</strong>.</li>
        <li>If you&rsquo;re a guardian acting on behalf of a thalassemia patient or another data principal, mention that and provide proof of guardianship.</li>
      </ul>
      <p>
        We will reply within 72 hours acknowledging the request, verify your identity by
        sending an OTP to your registered mobile, and confirm deletion within 30 days of
        verification.
      </p>

      <h3>Option C — Phone or post</h3>
      <p>
        Call our Grievance Officer at{' '}
        <a href="tel:+919850541412">+91 98505 41412</a> during working hours (10:00–18:00
        IST, Monday–Saturday) and follow the verbal instructions. Or write to:
      </p>
      <p>
        Grievance Officer<br />
        Choudhari EduHealth India Foundation<br />
        54, 2nd Lane, Rathi Nagar, VMV Road<br />
        Amravati, Maharashtra 444603, India
      </p>

      <h2>2. What we will delete</h2>
      <ul>
        <li>Your name, date of birth, gender, address fields (village / taluka / district / pincode).</li>
        <li>Your encrypted mobile number from active tables.</li>
        <li>Your email address (institutional users).</li>
        <li>Self-reported blood group, preferred language, community affiliation.</li>
        <li>Pre-screening declarations made during registration.</li>
        <li>Camp RSVPs and broadcast-message receipt logs.</li>
        <li>Donor reliability score, availability state, eligibility flags.</li>
        <li>Outbound notifications (delivery + read receipts) older than 90 days.</li>
        <li>Anything stored in your browser&rsquo;s localStorage / IndexedDB on next login (cleared automatically on logout).</li>
      </ul>

      <h2>3. What we cannot delete</h2>
      <p>
        Some records cannot be destroyed because they are required by Indian law or are
        critical to patient safety. In these cases, we <strong>anonymise</strong> the
        records — your identity is severed from them but the records themselves remain:
      </p>
      <ul>
        <li>
          <strong>Your donation history at any blood bank.</strong> The Drugs and Cosmetics
          Act, 1940 and the rules made thereunder require blood banks to retain donor
          records for a minimum of 5 years for traceability and lookback. On erasure, we
          replace your name with an anonymous ID and remove direct identifiers, but the
          record itself remains in the blood bank&rsquo;s system.
        </li>
        <li>
          <strong>TTI screening results.</strong> Retained for 7 years per public-health
          traceability rules. Anonymised, not deleted.
        </li>
        <li>
          <strong>Audit log entries.</strong> Raktify&rsquo;s audit log is a hash-chained,
          tamper-evident record. Breaking the chain would compromise the audit integrity
          for every other user. We null out your PII fields within the log entries, but
          preserve the hash chain.
        </li>
        <li>
          <strong>Aggregate, non-identifying statistics.</strong> "We had 2,300 donors in
          Amravati district in Q3 2026" includes you, but is not personally identifiable;
          we keep this for reporting to DHO / partners.
        </li>
      </ul>

      <h2>4. Timeline</h2>
      <ul>
        <li><strong>Acknowledgement:</strong> within 72 hours of your request.</li>
        <li><strong>Identity verification:</strong> within 7 days (OTP-based).</li>
        <li><strong>Deletion / anonymisation completed:</strong> within 30 days of verification.</li>
        <li><strong>Confirmation:</strong> we will WhatsApp / email you when deletion is complete and provide a deletion-reference ID for your records.</li>
      </ul>

      <h2>5. Consequences of deletion</h2>
      <p>After we process your erasure request:</p>
      <ul>
        <li>You will no longer receive WhatsApp or SMS notifications from Raktify.</li>
        <li>You cannot log in. Your account is irrecoverable.</li>
        <li>If you wish to donate again in future, you must register as a new donor. Your prior donations remain in the anonymised record at the blood bank but will not appear on a new account.</li>
        <li>If you held a coordinator role, your district assignment is removed and a successor is nominated by the NGO admin.</li>
      </ul>

      <h2>6. Asking for someone else&rsquo;s data to be deleted</h2>
      <p>You may submit a deletion request on behalf of someone else if:</p>
      <ul>
        <li>You are the legal guardian of a minor or person with a disability whose data we hold (e.g. a thalassemia patient registered through their treating hospital).</li>
        <li>The data principal is deceased and you are a nominated person under DPDP Act § 14.</li>
        <li>You hold a valid power of attorney for data-rights matters.</li>
      </ul>
      <p>Include proof of your relationship or authority with your request.</p>

      <h2>7. If we deny or partially fulfil your request</h2>
      <p>
        In rare cases we may refuse a deletion request — for example, if your account is
        under active investigation for fraud or if law-enforcement has placed a legal hold.
        In such cases:
      </p>
      <ul>
        <li>We will tell you why, in writing.</li>
        <li>You may appeal to the Foundation&rsquo;s Grievance Officer.</li>
        <li>If still unresolved, you may approach the Data Protection Board of India.</li>
      </ul>

      <h2>8. Contact for this process</h2>
      <p>
        <strong>Grievance Officer:</strong> Gaurav R. Choudhari<br />
        <strong>Email:</strong> <a href="mailto:contact@choudhari.ngo">contact@choudhari.ngo</a><br />
        <strong>Phone:</strong> <a href="tel:+919850541412">+91 98505 41412</a><br />
        <strong>Working hours:</strong> 10:00–18:00 IST, Monday–Saturday
      </p>
      <p>
        For the full background on our data handling, please read our{' '}
        <Link to="/privacy">Privacy Policy</Link>.
      </p>
    </LegalPage>
  );
}
