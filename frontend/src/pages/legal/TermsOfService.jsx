import { Link } from 'react-router-dom';

import { LegalPage } from './LegalPage.jsx';

export function TermsOfService() {
  return (
    <LegalPage title="Terms of Service" lastUpdated="21 May 2026" version="v1">
      <p>
        Raktify is operated by <strong>Choudhari EduHealth India Foundation</strong>
        (NGO-DARPAN MH/2025/0643345, 80G eligible), Amravati, Maharashtra, India. These
        terms govern your use of <a href="https://raktify.choudhari.ngo">raktify.choudhari.ngo</a>,
        our APIs, our WhatsApp Business presence, and any related services
        (collectively, the <strong>Platform</strong>).
      </p>
      <p>
        By creating a donor profile, onboarding an institution, hosting a camp, or merely
        opening a Raktify-shared link, you agree to these terms. If you do not agree, do
        not use the Platform.
      </p>

      <h2>1. The Platform is free, always</h2>
      <p>
        Raktify is free for donors, hospitals, blood banks, NGOs, camp organisers and the
        general public. We do not charge transaction fees, subscription fees, or
        per-message fees to any user. The Foundation is funded by CSR partnerships, grants
        and individual donations to the Foundation itself — not by users of the Platform.
      </p>

      <h2>2. Eligibility</h2>
      <ul>
        <li><strong>Donors</strong> must be 18 years or older, meet the medical eligibility criteria documented in our pre-screening questionnaire, and provide truthful health information.</li>
        <li><strong>Coordinators</strong> must complete identity verification and sign the Raktify coordinator MoU before being activated.</li>
        <li><strong>Hospitals</strong> must hold a valid Clinical Establishments Act registration (where applicable) and demonstrate operational capacity to receive blood units.</li>
        <li><strong>Blood banks</strong> must hold a valid CDSCO licence under the Drugs &amp; Cosmetics Act, 1940, and demonstrate compliance with relevant blood-bank regulations.</li>
        <li><strong>Camp organisers</strong> need not have a Raktify account, but must provide accurate camp details and a valid contact mobile.</li>
      </ul>

      <h2>3. Your responsibilities by role</h2>

      <h3>3.1 Donors</h3>
      <ul>
        <li>Provide truthful information about your health, age, and identity.</li>
        <li>Update your availability status honestly — toggle off if you cannot donate at the moment.</li>
        <li>Do not impersonate another person.</li>
        <li>Respect deferral periods. If the Platform marks you as deferred, do not attempt to donate at another blood bank to circumvent it — that endangers the recipient.</li>
        <li>Honour camp RSVPs to the best of your ability. If you can&rsquo;t make it, use the in-app cancel option.</li>
      </ul>

      <h3>3.2 Hospitals</h3>
      <ul>
        <li>Raise requests only for genuine clinical needs.</li>
        <li>Do not solicit donors directly. All donor communication is mediated by Raktify for donor privacy.</li>
        <li>Confirm crossmatch honestly after the transfusion is complete.</li>
        <li>Do not share donor information (names, blood groups, etc., as visible to the hospital role) with any third party.</li>
      </ul>

      <h3>3.3 Blood banks</h3>
      <ul>
        <li>Maintain CDSCO licence in good standing. Notify Raktify within 7 days of any suspension or material change.</li>
        <li>Perform Transfusion-Transmissible-Infection (TTI) screening as per applicable regulations.</li>
        <li>Use the 4-eyes verification feature for TTI results. Do not bypass it by sharing accounts.</li>
        <li>Keep inventory accurate. Recall bags promptly when a reactive TTI is confirmed; the platform will cascade the lookback automatically.</li>
        <li>Honour reservations made by the matching engine for genuine emergencies.</li>
      </ul>

      <h3>3.4 Coordinators</h3>
      <ul>
        <li>Operate strictly within the geographic district assigned to you.</li>
        <li>Do not leak donor PII obtained through your role.</li>
        <li>Mark donor no-shows honestly. Donor reliability scores depend on accurate data.</li>
        <li>Use the cross-role thread feature for hospital / blood-bank communication; avoid out-of-band channels that bypass the audit log.</li>
      </ul>

      <h3>3.5 Camp organisers</h3>
      <ul>
        <li>Host only genuine, advertised camps. Cancelling a camp after donors have RSVP&rsquo;d damages trust in the Platform — communicate via the broadcast feature if you must cancel.</li>
        <li>Do not share the magic-link to your camp dashboard publicly. The link is scoped to your camp and reveals donor names + blood groups on your roster.</li>
        <li>Coordinate with a Raktify-trained volunteer present at the camp to register every donor in the system.</li>
      </ul>

      <h3>3.6 NGO admins &amp; super admins</h3>
      <ul>
        <li>Use admin privileges only for the operational purposes described in the Raktify Operating Manual.</li>
        <li>All administrative actions are logged in the immutable, hash-chained audit log. Do not attempt to circumvent it.</li>
      </ul>

      <h2>4. Prohibited use</h2>
      <p>You may not, directly or indirectly:</p>
      <ul>
        <li>Use the Platform for commercial blood-sale, donor recruitment for paid donations, or any activity prohibited by the National Blood Policy 2002.</li>
        <li>Spoof requests, fabricate emergencies, or impersonate hospitals.</li>
        <li>Spam donors with messages outside the Raktify-mediated channels.</li>
        <li>Reverse-engineer, scrape, or attempt to access the Platform&rsquo;s backend other than through the published API.</li>
        <li>Attempt to bypass Row-Level Security, the audit log, or any access-control measure.</li>
        <li>Use the Platform to discriminate against donors on the basis of caste, religion, gender, sexual orientation, disability, or HIV status (where eligibility otherwise permits donation).</li>
        <li>Sell, transfer, or otherwise misuse personally identifiable information you accessed via the Platform.</li>
      </ul>

      <h2>5. Medical disclaimers</h2>
      <p>
        Raktify is an information-and-coordination platform. We are <strong>not</strong> a
        medical provider and we do not provide medical advice, diagnosis, or treatment.
        Specifically:
      </p>
      <ul>
        <li>The donor&rsquo;s clinical eligibility is determined by the blood bank&rsquo;s staff at the time of donation, not by the Platform&rsquo;s pre-screening questionnaire.</li>
        <li>The quality and safety of blood units is the responsibility of the issuing blood bank, in accordance with applicable regulations.</li>
        <li>The clinical decision to transfuse, including type, quantity, and crossmatch, is the sole responsibility of the treating hospital.</li>
        <li>Matching suggestions surfaced by the Platform are advisory; final selection is at the discretion of the blood-bank and hospital staff.</li>
      </ul>

      <h2>6. Privacy</h2>
      <p>
        Your use of the Platform is governed by our <Link to="/privacy">Privacy Policy</Link>,
        which forms part of these terms by reference.
      </p>

      <h2>7. Account suspension &amp; termination</h2>
      <h3>7.1 By us</h3>
      <p>We may suspend or terminate any account that:</p>
      <ul>
        <li>Submits false information at registration or onboarding.</li>
        <li>Violates the responsibilities in § 3 or the prohibited-use list in § 4.</li>
        <li>Is implicated in an investigation by the Foundation&rsquo;s grievance redressal process or by law enforcement.</li>
      </ul>
      <p>
        Suspension is logged, and the account holder is notified by WhatsApp / email
        with the reason. The right to be heard (DPDP § 8) is preserved — you can respond
        and request reinstatement.
      </p>
      <h3>7.2 By you</h3>
      <p>
        You may delete your donor profile at any time via the dashboard, or by following
        the process described in our <Link to="/data-deletion">Data deletion</Link> page.
        Institutions may withdraw by emailing us; an off-boarding workflow preserves
        regulatory-required records while removing the institution from active matching.
      </p>

      <h2>8. Intellectual property</h2>
      <p>
        The "Raktify" wordmark, droplet logo, and design system are the property of
        Choudhari EduHealth India Foundation. The underlying source code is currently
        proprietary to the Foundation; we may release portions under an open-source
        licence in future, which would be announced separately.
      </p>
      <p>
        Any feedback, suggestions, or improvements you share with us may be incorporated
        into the Platform without any obligation of compensation.
      </p>

      <h2>9. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by Indian law, the Foundation, its trustees,
        employees, volunteers and partners shall not be liable for any indirect,
        consequential, incidental, special or punitive damages arising from your use of
        the Platform, even if advised of the possibility of such damages. Our aggregate
        liability for any claim arising out of these terms shall not exceed{' '}
        <strong>₹10,000</strong> (ten thousand Indian Rupees).
      </p>
      <p>
        Nothing in this section limits liability that cannot be limited under applicable
        law, including liability for gross negligence or wilful misconduct.
      </p>

      <h2>10. Indemnity</h2>
      <p>
        You agree to indemnify and hold the Foundation harmless from any third-party claim
        arising from your breach of these terms, your misuse of the Platform, or your
        violation of any law or third-party right.
      </p>

      <h2>11. Governing law and dispute resolution</h2>
      <p>
        These terms are governed by the laws of India. Any dispute arising out of or
        relating to these terms or the Platform shall be subject to the exclusive
        jurisdiction of the courts at <strong>Amravati, Maharashtra</strong>.
      </p>
      <p>
        Before approaching the courts, the parties shall attempt resolution by good-faith
        discussion for at least 30 days, mediated where appropriate by the
        Foundation&rsquo;s Grievance Officer (see Privacy Policy § 11).
      </p>

      <h2>12. Changes to these terms</h2>
      <p>
        We will update the "Last updated" date at the top of this page whenever these
        terms change. Material changes will be communicated via in-app notification, by
        WhatsApp message to active donors, and by email to institutional users.
        Continued use of the Platform after a change is deemed acceptance.
      </p>

      <h2>13. Contact</h2>
      <p>
        Choudhari EduHealth India Foundation<br />
        54, 2nd Lane, Rathi Nagar, VMV Road<br />
        Amravati, Maharashtra 444603, India<br />
        <a href="mailto:hello@choudhari.ngo">hello@choudhari.ngo</a> ·{' '}
        <a href="tel:+919850541412">+91 98505 41412</a>
      </p>
    </LegalPage>
  );
}
