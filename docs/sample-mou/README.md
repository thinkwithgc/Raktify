# Sample MoU for Leegality template workflow validation

The HTML file in this folder is a **draft MoU** used to validate the
Leegality eSign integration end-to-end **before** the final
legal-reviewed MoU is ready. Once the legal version is in hand, you
replace the underlying PDF in Leegality's template editor — the
**Template ID stays the same**, so no code change is needed.

## What's inside

- `Raktify_MoU_Sample.html` — A4-formatted MoU with realistic clauses
  and clearly-marked variable zones (yellow boxes). Foundation
  metadata (CIN, NGO-DARPAN, address) is real; the legal clauses are
  reasonable defaults that the lawyer will refine.

## Workflow

### Step 1 — convert HTML → PDF (your laptop, ~1 min)

1. Open `Raktify_MoU_Sample.html` in **Chrome or Edge** (Firefox works
   too; Safari's print-to-PDF is OK but margins differ slightly).
2. **Ctrl+P** (or Cmd+P on Mac).
3. In the print dialog:
   - **Destination**: "Save as PDF"
   - **Paper size**: A4
   - **Margins**: Default
   - **Scale**: 100% (do not "fit to page")
   - **Background graphics**: ☑ ON  ← important for the yellow variable boxes to print
4. Save as `Raktify_MoU_Sample.pdf` somewhere local (don't commit it
   to git; the source HTML is what's versioned).

### Step 2 — upload to Leegality + register variables (~10 min)

1. Open [dashboard.leegality.com](https://dashboard.leegality.com) → **Templates** → **Create New Template**.
2. Upload `Raktify_MoU_Sample.pdf`.
3. **Mark variable zones**: Leegality's editor lets you draw a box on
   the PDF and bind it to a variable name. Draw one box per yellow
   placeholder in the document. Use these exact variable names
   (matching what `routes/onboarding.js` sends in `templateData`):

   | PDF placeholder | Leegality variable name |
   |---|---|
   | `{{institution_legal_name}}` | `institution_legal_name` |
   | `{{institution_type}}` | `institution_type` |
   | `{{license_number}}` | `license_number` |
   | `{{institution_address}}` | `institution_address` |
   | `{{district_name}}` | `district_name` |
   | `{{primary_contact_name}}` | `primary_contact_name` |
   | `{{primary_contact_designation}}` | `primary_contact_designation` |
   | `{{primary_contact_mobile}}` | `primary_contact_mobile` |
   | `{{signatory_name}}` | `signatory_name` |
   | `{{signatory_designation}}` | `signatory_designation` |
   | `{{signing_date}}` | `signing_date` |
   | `{{effective_until_date}}` | `effective_until_date` |
   | `{{mou_version}}` | `mou_version` |

4. **Mark the signature zone**: in the &ldquo;For
   `{{institution_legal_name}}`&rdquo; column of the Signatures block
   (last page), draw the signature box where the institution's
   authorised signatory will sign via Aadhaar eSign.
5. **Pre-apply the Foundation signature** (left column of Signatures
   block): if Leegality supports a pre-applied signature for the
   template owner, configure that here. Otherwise, the Foundation's
   signature is rendered as text only — fine for v1.
6. **Publish** the template → copy the **Template ID** (UUID-like).

### Step 3 — paste Template ID back to chat

Tell me (or whichever Claude session is active) the Template ID. I'll
run one az command:

```bash
az webapp config appsettings set --resource-group raktify --name raktify-api \
  --settings LEEGALITY_TEMPLATE_ID=<paste-id-here>
```

Once that's set + the App Service restarts (~30 sec), the eSign
provider auto-activates (`services/esign/index.js` checks all three:
authToken + privateSalt + templateId). From that moment, any institution
onboarded via `/admin` → Verify → Send MoU triggers a real Leegality
Aadhaar eSign request.

### Step 4 — configure the webhook callback in Leegality

In Leegality dashboard → **Settings → Webhooks** (or wherever they
expose it):

- **Callback URL**: `https://raktify-api.azurewebsites.net/onboarding/mou-signed`
- **Method**: POST (Leegality default)
- **Events**: subscribe to document-signed and document-expired at minimum
- **Signing**: the HMAC verification on our side uses your dashboard's
  **Private Salt** (already in Key Vault as `leegality-private-salt`).

### Step 5 — first end-to-end test

1. Use the Foundation itself as the test institution (you sign as the
   authorised signatory for the Foundation acting as a "blood bank"
   or "hospital" for testing).
2. Onboard via `/admin` → fill Schedule 1 → Verify → Send MoU.
3. You receive an SMS from Leegality with the eSign link.
4. Complete the Aadhaar eSign.
5. Leegality sends a webhook to `/onboarding/mou-signed`.
6. Backend verifies HMAC, creates the `mou_versions` row, marks
   institution `AC`, generates a setup-link token, sends the
   `institution_activation_link` WhatsApp template.
7. The signatory mobile receives the activation link, taps, sets a
   password, logs in to `/admin`.

If the webhook payload's field names don't match what
`leegalityProvider.verifyWebhook()` expects, that's the moment we patch
the provider — the field-name guesses in the current skeleton may be
off-by-one. Easy fix once we see a real payload in the logs.

## When the final legal MoU is ready

1. Get the final PDF from the lawyer.
2. In Leegality dashboard → **Templates** → open the existing
   `Raktify MoU` template.
3. **Replace document** (or "Update PDF") — most template editors let
   you swap the underlying PDF while keeping the template ID + variable
   bindings + signature zones.
4. Re-verify the variable positions on the new PDF (they may shift if
   the layout changed).
5. **Publish**.

No code change. No env update. Existing in-flight MoUs (already signed)
remain attached to the version of the template they were signed against
— Leegality preserves the historical PDF per signing event.
