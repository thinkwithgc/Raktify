Raktify
Master Prompt — Phased Coding Agent Specification
Choudhari EduHealth India Foundation
Version 1.0  |  April 2026  |  Amravati, Maharashtra

PURPOSE  This document is the complete technical specification for building Raktify v1. It is structured in 8 independent phases. Each phase is a self-contained prompt for a coding agent. Begin a fresh agent session for each phase. The agent must complete each phase fully before the next begins.

MEDICAL REVIEW STATUS  All clinical protocols in this specification (NBTC eligibility criteria, TTI deferral periods, compatibility matrix, lookback protocol) are pending validation by a qualified haematologist. Do not modify any clinical reference data without written confirmation from the medical advisor.

LEGAL REVIEW STATUS  The MoU template and liability clauses are pending review by a healthcare lawyer in Maharashtra. The digital signature mechanism (LeegAlly / Aadhaar eSign) is confirmed valid under IT Act 2000.

SECTION 1 — CONTEXT FOR EVERY PHASE
CRITICAL  Copy Section 1 in full at the top of EVERY phase prompt. It is the foundational context the coding agent needs regardless of which phase it is building.

1.1  What Raktify Is
Raktify is a life-critical community blood donation and emergency matching platform operated by Choudhari EduHealth India Foundation, a Section 8 NGO based in Amravati, Maharashtra. It is not a blood bank. It is an information intermediary that connects voluntary blood donors, licensed blood banks, hospitals, and trained volunteer coordinators to reduce patient deaths caused by information failure during blood emergencies.

The platform launches in Amravati District, Maharashtra with initial partners Irwin Hospital (GMCH) and PDMMC Hospital. It is designed to scale nationally. Every architectural decision must support national scale from day one.

1.2  Non-Negotiable Design Principles
This is a life-critical system. A bug in blood group matching, eligibility screening, or lookback protocol can kill a patient. Every clinical data field must be validated at the database level — not just application code.
All patient-safety-critical rules are enforced by PostgreSQL triggers and CHECK constraints, not application code. Application code has bugs. Database constraints do not.
The schema is the source of truth. No developer may add, remove, or rename a table or field without updating this specification document first.
Security is non-negotiable. All PII and health data is encrypted at rest. Row Level Security is enforced at the database engine level. No application role has more permissions than it needs.
The audit log is immutable. No application code writes to audit_log directly. Only database triggers write to it. No role has UPDATE or DELETE on audit_log ever.
Donor contact information is always masked. Hospitals never see donor phone numbers. All donor contact is mediated through the platform.

1.3  Technology Stack — Final, Non-Negotiable
Layer
Technology
Reason
Database
PostgreSQL on AWS RDS — Mumbai (ap-south-1)
Life-critical system. AWS Mumbai is used by NPCI/UPI and cannot be blocked by Indian government. Zero ban risk. Point-in-time recovery, automated backups, multi-AZ failover.
Dev Database
Neon (neon.tech)
Free serverless PostgreSQL. Same engine as production. Exports standard pg_dump. Migrate to RDS without schema changes.
Backend
Node.js + Express.js
Stable, well-documented, large ecosystem for Indian health tech.
Backend Hosting
AWS EC2 or Elastic Beanstalk — Mumbai
Same region as RDS. Low latency. Same compliance boundary.
File Storage
AWS S3 — Mumbai
Prescription PDFs, lab reports, MoU documents. Encrypted at rest.
Auth — OTP
MSG91
DLT pre-registered. WhatsApp Business API + SMS in same dashboard. Used by Practo and PharmEasy. India carrier routing.
Auth — 2FA
TOTP (Google Authenticator compatible)
Mandatory for hospital and blood bank accounts.
Digital MoU
LeegAlly API (Aadhaar eSign)
Legally valid under IT Act 2000 Section 5. No ASP license needed.
Email / Domain
Google Workspace for Nonprofits — choudhari.ngo
Free for NGOs. Institutional role accounts e.g. irwin@choudhari.ngo.
Frontend
React.js + Tailwind CSS
Responsive, mobile-first. Donor-facing UI in Marathi and Hindi.
Frontend Hosting
AWS Amplify or Vercel
Static hosting. CDN. Auto-deploy from GitHub.
WhatsApp
Meta WhatsApp Business API via MSG91
Official channel. Not a third-party wrapper. DLT compliant.
Encryption
AES-256 via AWS KMS
Two separate KMS keys: main application key and screening-only key.
Geographic Data
LGD (Local Government Directory)
Seeded from Ministry of Panchayati Raj public dataset. 640,000 villages, all districts, all talukas.

1.4  Repository Structure
All code lives in a single monorepo: /raktify
/raktify/backend — Node.js + Express API
/raktify/frontend — React web application
/raktify/database — PostgreSQL migration files in numbered order
/raktify/database/seeds — Reference data seed files (blood groups, components, compatibility matrix, LGD geographic data)
/raktify/database/triggers — All trigger functions as separate .sql files
/raktify/database/rls — All Row Level Security policies as separate .sql files
/raktify/scripts — Utility scripts for seeding, migration, backup
/raktify/docs — This specification document
RULE  Migrations are numbered sequentially: 001_geographic.sql, 002_reference.sql, 003_platform_users.sql etc. Migrations must be reversible. Each migration file ends with a commented-out rollback section.

SECTION 2 — PHASE 0: PROJECT SETUP AND INFRASTRUCTURE
PHASE 0: Project Setup and Infrastructure
Estimated effort: 2–3 days  ·  Start a fresh coding agent session for this phase
Set up the complete development environment, repository structure, database connection, environment configuration, and all infrastructure dependencies. No application features are built in this phase — only the foundation everything else runs on.

Phase 0 Deliverables — Acceptance Criteria
GitHub repository created with the folder structure in Section 1.4.
Neon PostgreSQL database created and connected. Connection string in .env.
AWS account configured with Mumbai region. RDS instance created (db.t3.micro for dev). S3 bucket created with server-side encryption enabled.
AWS KMS: two keys created. Key 1: main application encryption. Key 2: screening data only. Key ARNs in .env as KMS_MAIN_KEY_ARN and KMS_SCREENING_KEY_ARN.
Google Workspace for Nonprofits approved for choudhari.ngo. Admin console accessible.
MSG91 account created. WhatsApp Business API sandbox active. DLT sender ID registered or in progress.
LeegAlly API sandbox credentials obtained. Test signature flow working.
Node.js Express server running on port 3000. Single /health endpoint returns {status: 'ok', timestamp: ISO8601, environment: process.env.NODE_ENV}.
dotenv configured. .env.example committed. .env in .gitignore. All secrets in environment variables — none hardcoded.
ESLint and Prettier configured. Husky pre-commit hooks running lint and format checks.
GitHub Actions CI pipeline: runs on every push, executes lint check and migration dry-run.

Phase 0 Environment Variables
-- SQL
# Database
DATABASE_URL=postgresql://user:password@host:5432/raktify
DATABASE_URL_PROD=postgresql://user:password@rds-endpoint:5432/raktify

# AWS
AWS_REGION=ap-south-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
S3_BUCKET_NAME=raktify-documents
KMS_MAIN_KEY_ARN=arn:aws:kms:ap-south-1:...
KMS_SCREENING_KEY_ARN=arn:aws:kms:ap-south-1:...

# MSG91
MSG91_AUTH_KEY=
MSG91_SENDER_ID=BLDCNT
MSG91_WHATSAPP_NUMBER=
MSG91_TEMPLATE_OTP=
MSG91_TEMPLATE_EMERGENCY_MR=   # Marathi emergency alert
MSG91_TEMPLATE_EMERGENCY_HI=   # Hindi emergency alert
MSG91_TEMPLATE_THANKYOU_MR=
MSG91_TEMPLATE_REMINDER_MR=

# LeegAlly
LEEGALLY_API_KEY=
LEEGALLY_TEMPLATE_ID=

# Application
JWT_SECRET=
JWT_EXPIRES_IN=8h
NODE_ENV=development
PORT=3000
FRONTEND_URL=http://localhost:5173


SECTION 3 — PHASE 1: DATABASE FOUNDATION
PHASE 1: Database Foundation — All Tables, Triggers, RLS, and Seed Data
Estimated effort: 5–7 days  ·  Start a fresh coding agent session for this phase
Build the complete PostgreSQL schema. Every table, every field, every constraint, every trigger, every RLS policy, and all seed data. No API endpoints. No frontend. Only the database. This phase must be 100% complete and verified before Phase 2 begins.

CRITICAL ORDER  Migrations must run in this exact sequence. Each migration depends on tables created by the previous one. Running out of order will fail with foreign key errors.

Migration Sequence
File
Creates
Notes
001
states, districts, talukas, villages
Seed immediately from LGD dataset after creation. 4 tables, ~650,000 rows total.
002
blood_groups, blood_components, compatibility_matrix
Immutable reference data. Seeded from NBTC guidelines. Locked against user writes via RLS.
003
platform_users
Auth-only table. No profile data. Thin table — 17 fields.
004
institutions
Hospitals and blood banks. Self-referencing FK for in-house blood banks.
005
mou_versions
Archive of signed MoU versions per institution.
006
coordinators
Volunteer coordinator profiles and impact metrics.
007
communities
Coordinator-led donor groups. WhatsApp bridge config.
008
donors
Most complex table. 45 fields. Duplicate detection fields included.
009
institution_referrals
Donor-initiated blood bank referrals. Multi-referrer group support.
010
donation_history
One row per donation. Three source types (verified/self-reported/retroactive).
011
donor_screening
TTI results. Separate KMS key. Separate audit log. Most restricted table.
012
screening_audit_log
Append-only. Separate from main audit_log. KMS_SCREENING_KEY.
013
blood_inventory
One row per physical blood bag. ISBT barcode. Nine status codes.
014
thalassemia_patients
Scheduled transfusion patients. Paired donor support.
015
rare_blood_registry
Bombay group and rare phenotype donors. National broadcast flag.
016
blood_requests
Core operational table. 34 fields. Four source tiers.
017
request_assignments
Ownership chain. Auto-assign + claim mechanism.
018
request_documents
Prescriptions and patient reports. Immutable after upload.
019
donor_alerts
Per-alert response tracking. No-show confirmation.
020
escalation_log
Append-only escalation chain per request.
021
request_threads
Per-message rows for coordinator chat. Visibility control.
022
donation_camps
Camp drives. Organizer attribution. Impact tracking.
023
notification_log
Every WhatsApp and SMS sent. Delivery tracking. Cost tracking.
024
lookback_registry
Donor-to-recipient traceability chain. Legal requirement.
025
audit_log
BIGSERIAL PK. INSERT only. Hash chain. 7-year retention. Last migration — must exist before any trigger can write to it.

Critical Field Specifications — Highest Risk Tables
donors table — fields that are database-enforced clinical rules
-- SQL
CREATE TABLE donors (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mobile                        CHAR(13) NOT NULL UNIQUE,  -- encrypted, +91XXXXXXXXXX
  mobile_verified               BOOLEAN NOT NULL DEFAULT FALSE,
  mobile_verified_at            TIMESTAMPTZ,
  full_name                     TEXT NOT NULL,             -- encrypted
  date_of_birth                 DATE NOT NULL,
  gender                        CHAR(1) NOT NULL CHECK (gender IN ('M','F','O')),
  abha_id                       CHAR(17) UNIQUE,           -- encrypted, nullable
  aadhaar_last4                 CHAR(4),                   -- never full aadhaar
  preferred_language            CHAR(2) NOT NULL DEFAULT 'mr' CHECK (preferred_language IN ('mr','hi','en')),
  village_id                    INTEGER REFERENCES villages(id),
  address_line                  TEXT,                      -- encrypted
  pincode                       CHAR(6),
  latitude                      NUMERIC(9,6),              -- only with explicit consent
  longitude                     NUMERIC(9,6),
  max_travel_km                 SMALLINT NOT NULL DEFAULT 10,
  blood_group_self_reported     SMALLINT REFERENCES blood_groups(id), -- NEVER used in matching
  blood_group_verified          SMALLINT REFERENCES blood_groups(id), -- ONLY field used in matching
  blood_group_verified_at       TIMESTAMPTZ,
  blood_group_verified_by       UUID REFERENCES institutions(id),
  eligible_components           SMALLINT[],
  deferral_status               CHAR(1) NOT NULL DEFAULT 'A' CHECK (deferral_status IN ('A','T','P')),
  deferral_reason               TEXT,                      -- encrypted, blood_bank only
  deferral_until                DATE,
  next_eligible_date            DATE,
  total_donations               SMALLINT NOT NULL DEFAULT 0,
  total_units_ml                INTEGER NOT NULL DEFAULT 0,
  is_available                  BOOLEAN NOT NULL DEFAULT TRUE,
  available_hours_start         SMALLINT NOT NULL DEFAULT 6,
  available_hours_end           SMALLINT NOT NULL DEFAULT 22,
  emergency_override            BOOLEAN NOT NULL DEFAULT TRUE,
  preferred_contact_channel     CHAR(2) NOT NULL DEFAULT 'WA' CHECK (preferred_contact_channel IN ('WA','SM','CA')),
  whatsapp_opted_in             BOOLEAN NOT NULL DEFAULT FALSE,
  whatsapp_opted_in_at          TIMESTAMPTZ,
  sms_opted_in                  BOOLEAN NOT NULL DEFAULT TRUE,
  consent_data_use              BOOLEAN NOT NULL DEFAULT FALSE,
  consent_given_at              TIMESTAMPTZ,
  consent_version               SMALLINT NOT NULL DEFAULT 1,
  community_id                  UUID REFERENCES communities(id),
  referred_by_coordinator       UUID REFERENCES coordinators(id),
  platform_user_id              UUID REFERENCES platform_users(id),
  registration_source           CHAR(3) NOT NULL CHECK (registration_source IN ('QRC','WAB','WEB','APP','BBK','CAM')),
  suspected_duplicate_of        UUID REFERENCES donors(id),
  merged_into                   UUID REFERENCES donors(id),
  alternate_mobiles             TEXT[],
  no_show_count                 SMALLINT NOT NULL DEFAULT 0,
  reliability_score             SMALLINT NOT NULL DEFAULT 100 CHECK (reliability_score BETWEEN 0 AND 100),
  preferred_software_vendor     TEXT,  -- V2 integration tracking
  is_active                     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- DB-level clinical rules:
  CONSTRAINT age_min CHECK (date_of_birth &lt;= CURRENT_DATE - INTERVAL '18 years'),
  CONSTRAINT age_max CHECK (date_of_birth &gt;= CURRENT_DATE - INTERVAL '65 years'),
  CONSTRAINT travel_range CHECK (max_travel_km BETWEEN 1 AND 999),
  CONSTRAINT hours_range CHECK (available_hours_start BETWEEN 0 AND 23
                            AND available_hours_end BETWEEN 0 AND 23)
);


blood_inventory table — status transition enforcement
-- SQL
CREATE TABLE blood_inventory (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  isbt_barcode              TEXT NOT NULL UNIQUE,
  donation_id               UUID NOT NULL REFERENCES donation_history(id),
  donor_id                  UUID NOT NULL REFERENCES donors(id),  -- denormalized for lookback speed
  blood_bank_id             UUID NOT NULL REFERENCES institutions(id),
  blood_group_id            SMALLINT NOT NULL REFERENCES blood_groups(id),
  component_id              SMALLINT NOT NULL REFERENCES blood_components(id),
  volume_ml                 SMALLINT NOT NULL CHECK (volume_ml &gt; 0),
  collection_date           DATE NOT NULL,
  processing_date           DATE,
  expiry_date               DATE NOT NULL,  -- calculated by trigger: collection_date + shelf_life_days
  expiry_alert_sent_48h     BOOLEAN NOT NULL DEFAULT FALSE,
  expiry_alert_sent_24h     BOOLEAN NOT NULL DEFAULT FALSE,
  status                    CHAR(2) NOT NULL DEFAULT 'QA'
                            CHECK (status IN ('QA','AV','RE','IS','TR','US','EX','RC','WA')),
  status_changed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status_changed_by         UUID NOT NULL REFERENCES platform_users(id),
  storage_location          TEXT,
  reserved_for_request_id   UUID REFERENCES blood_requests(id),
  reserved_at               TIMESTAMPTZ,
  issued_to_institution_id  UUID REFERENCES institutions(id),
  issued_at                 TIMESTAMPTZ,
  is_recalled               BOOLEAN NOT NULL DEFAULT FALSE,
  recall_reason             TEXT,  -- encrypted
  recall_initiated_by       UUID REFERENCES platform_users(id),
  recall_initiated_at       TIMESTAMPTZ,
  source                    CHAR(2) NOT NULL DEFAULT 'MA'
                            CHECK (source IN ('MA','WB','RA','BP','ER','FH')),
  last_synced_at            TIMESTAMPTZ,
  external_id               TEXT,  -- ID in partner software (RAKT etc.) for V2 reconciliation
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


audit_log — the most critical table in the schema
-- SQL
CREATE TABLE audit_log (
  id                   BIGSERIAL PRIMARY KEY,  -- sequential for gap detection
  event_time           TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),  -- NOT NOW()
  event_type           TEXT NOT NULL CHECK (event_type IN
                       ('INSERT','UPDATE','DELETE','LOGIN','LOGOUT',
                        'ACCESS','ESCALATION','RECALL','MERGE','OVERRIDE')),
  table_name           TEXT NOT NULL,
  record_id            TEXT NOT NULL,  -- TEXT to hold UUID or BIGINT PKs
  field_name           TEXT,           -- NULL for INSERT/DELETE
  old_value            TEXT,           -- encrypted when source field is encrypted
  new_value            TEXT,           -- encrypted when source field is encrypted
  actor_user_id        UUID REFERENCES platform_users(id),
  actor_system_process TEXT,
  actor_role           TEXT NOT NULL,
  actor_institution_id UUID REFERENCES institutions(id),
  actor_ip_address     TEXT,           -- encrypted
  actor_session_id     TEXT,
  request_reference    TEXT,           -- denormalized BC-YYYY-DIST-NNNNN
  change_reason        TEXT,
  row_hash             CHAR(64) NOT NULL,       -- SHA-256 of key fields
  previous_row_hash    CHAR(64),                -- hash chain for tamper detection
  CONSTRAINT one_actor CHECK (
    (actor_user_id IS NOT NULL AND actor_system_process IS NULL) OR
    (actor_user_id IS NULL AND actor_system_process IS NOT NULL)
  )
);

-- CRITICAL: revoke all write permissions from application role
REVOKE INSERT, UPDATE, DELETE ON audit_log FROM app_user;
-- Only audit_writer role (used by triggers only) can insert:
GRANT INSERT ON audit_log TO audit_writer;
-- app_user can only read audit_log (via restricted view):
GRANT SELECT ON audit_log TO audit_reader;


Required Triggers — All Must Be Written as Separate .sql Files
Trigger
Table
What it does
trg_donors_validate_mobile
donors
On INSERT: validate mobile format matches +91[6-9]\d{9}. Reject if not Indian mobile number.
trg_donors_update_eligibility
donation_history
After INSERT/UPDATE: recalculate total_donations, total_units_ml, next_eligible_date on parent donors row.
trg_donors_updated_at
donors
After any UPDATE: set updated_at = clock_timestamp(). Write to audit_log.
trg_inventory_expiry
blood_inventory
On INSERT: calculate expiry_date from collection_date + blood_components.shelf_life_days. Reject if expiry_date &lt;= CURRENT_DATE.
trg_inventory_status_gate
blood_inventory
On UPDATE status to AV: verify donor_screening.overall_clearance = 'CL' for this donation. Reject if screening incomplete or reactive.
trg_inventory_recall
blood_inventory
On UPDATE is_recalled to TRUE: auto-set status=RC if AV; release reservation if RE; send urgent alert if IS.
trg_inventory_updated_at
blood_inventory
After any UPDATE: set updated_at, write to audit_log.
trg_screening_clearance
donor_screening
After UPDATE on any TTI field: recalculate overall_clearance. If IN: set donor deferral, recall all bags, create lookback_registry rows. All in one atomic transaction.
trg_requests_generate_ref
blood_requests
On INSERT: generate request_number as BC-YYYY-DISTCODE-NNNNN using per-district sequence.
trg_requests_auto_assign
blood_requests
On INSERT: assign on-duty coordinator for hospital's district. Set escalation_timeout_minutes and dho_alert_threshold_minutes.
trg_requests_fulfillment
blood_requests
On UPDATE units_fulfilled: if &gt;= units_required set status=FU and fulfilled_at=NOW(). If partial set status=PF.
trg_requests_status_validate
blood_requests
On UPDATE status: reject illegal transitions (e.g. FU→OP, CL→OP). Write to audit_log.
trg_audit_all_tables
All audited tables
Generic trigger function applied to all tables. Reads session variable for change_reason. Writes INSERT-only row to audit_log via audit_writer role.
trg_consent_protect
donors
On UPDATE consent_data_use: reject if actor_user_id's role != 'donor'. The donor can only set their own consent — no system process can set it.
trg_opt_out_propagate
notification_log
On UPDATE is_opt_out_trigger to TRUE: immediately update donors.sms_opted_in or whatsapp_opted_in. Same transaction — no delay.

Row Level Security — Policies by Role
RULE  Enable RLS on EVERY table: ALTER TABLE [name] ENABLE ROW LEVEL SECURITY. Then CREATE POLICY for each role. If no policy exists for a role on a table, that role sees zero rows.

donor role: SELECT own row from donors WHERE id = auth.uid(). Cannot see other donors. Cannot see donor_screening at all. Cannot UPDATE blood_group_verified, deferral_status, reliability_score, no_show_count.
blood_bank role: READ/WRITE donor_screening WHERE blood_bank_id = their institution_id only. READ blood_inventory WHERE blood_bank_id = their institution_id. WRITE blood_inventory status changes. CANNOT read donors.address_line, donors.aadhaar_last4, or any other donor PII beyond blood_group_verified and eligibility fields.
coordinator role: READ donors (name, blood_group_verified, village, availability, reliability_score only — mobile masked as +91XXXXX[last4]). WRITE donor_alerts.no_show_count only. ZERO access to donor_screening.
hospital role: READ blood_requests WHERE requesting_institution_id = their institution_id. READ blood_inventory availability counts only (no bag-level detail). ZERO access to donor PII. ZERO access to donor_screening.
ngo_admin role: READ all tables except screening_audit_log. WRITE platform_users, institutions, coordinators. CANNOT write TTI results. Reads audit_log via restricted view only.
super_admin role: Full read. Cannot UPDATE or DELETE audit_log or screening_audit_log under any circumstance. Every access to donor_screening logged with mandatory access_reason.

Seed Data Files
002a_seed_blood_groups.sql
-- SQL
INSERT INTO blood_groups (id, code, abo_type, rh_factor, is_rare, population_pct_india) VALUES
(1,'A+','A','+',FALSE,22.0), (2,'A-','A','-',FALSE,0.8),
(3,'B+','B','+',FALSE,38.0), (4,'B-','B','-',FALSE,1.5),
(5,'AB+','AB','+',FALSE,9.0), (6,'AB-','AB','-',FALSE,0.4),
(7,'O+','O','+',FALSE,36.0), (8,'O-','O','-',FALSE,2.0);

002b_seed_blood_components.sql — verify with medical advisor before seeding
-- SQL
-- Shelf life, Hb thresholds, and donor gaps MUST be validated by medical advisor
INSERT INTO blood_components
(id,code,name_en,name_hi,name_mr,shelf_life_days,
 storage_temp_min_c,storage_temp_max_c,requires_agitation,
 requires_crossmatch,can_self_donate,min_donor_hb_male,
 min_donor_hb_female,min_gap_days,volume_ml_typical,isbt_product_code)
VALUES
(1,'WB','Whole Blood','पूर्ण रक्त','संपूर्ण रक्त',35,2.0,6.0,FALSE,TRUE,TRUE,13.0,12.5,90,450,'E0700'),
(2,'PRBC','Packed Red Blood Cells','पैक्ड RBC','पॅक्ड RBC',35,2.0,6.0,FALSE,TRUE,TRUE,13.0,12.5,90,280,'E1800'),
(3,'PLT','Random Donor Platelets','प्लेटलेट्स RDP','प्लेटलेट्स RDP',5,20.0,24.0,TRUE,FALSE,TRUE,13.0,11.5,14,250,'T0010'),
(4,'SDP','Single Donor Platelets','प्लेटलेट्स SDP','प्लेटलेट्स SDP',5,20.0,24.0,TRUE,FALSE,FALSE,13.0,11.5,28,200,'T0020'),
(5,'FFP','Fresh Frozen Plasma','ताजा प्लाज्मा','फ्रेश प्लाझ्मा',365,-25.0,-18.0,FALSE,FALSE,TRUE,13.0,12.5,90,220,'B0000'),
(6,'CRYO','Cryoprecipitate','क्रायोप्रेसिपिटेट','क्रायोप्रेसिपिटेट',365,-25.0,-18.0,FALSE,FALSE,TRUE,13.0,12.5,90,15,'B1000');

002c_seed_compatibility_matrix.sql — CRITICAL patient safety data
WARNING  The compatibility matrix determines which blood is matched to which patient. Any error here is a patient safety event. Validate against medical advisor confirmation before seeding.
-- SQL
-- PRBC compatibility (component_id=2). is_preferred=TRUE for same-group matches.
-- Format: (component_id, donor_group_id, recipient_group_id, is_compatible, is_preferred, note)
INSERT INTO compatibility_matrix VALUES
-- O- universal donor (donor_group_id=8): compatible with all recipient groups
(2,8,1,TRUE,FALSE,'O- compatible — reserve for emergencies'),
(2,8,2,TRUE,FALSE,'O- compatible — reserve for emergencies'),
-- ... complete matrix for all 64 PRBC combinations
-- ... separate matrix for FFP (AB=6 is universal donor for plasma)
-- ... platelet matrix (ABO preferred, not absolute)
-- AFTER SEEDING: lock table against user writes
REVOKE INSERT,UPDATE,DELETE ON compatibility_matrix FROM app_user;


001_geographic_seed.sql — LGD data import
Download LGD dataset from lgdirectory.gov.in — State Master, District Master, Sub-district (Taluka) Master, Village Master.
Write a Node.js import script: /raktify/scripts/import_lgd.js
Script reads each CSV, maps columns to our schema fields (LGD state code → states.id, LGD district code → districts.id etc.), and inserts in batches of 1000.
Set is_active = FALSE for all states and districts. Only set TRUE for Maharashtra (state_id=27) and Amravati district for v1 launch.
Set has_blood_centre = FALSE for all districts. Updated when first blood bank onboards.

SECTION 4 — PHASE 2: AUTHENTICATION AND INSTITUTION ONBOARDING
PHASE 2: Authentication and Institution Onboarding
Estimated effort: 4–5 days  ·  Start a fresh coding agent session for this phase
Build authentication for all six roles, the digital MoU onboarding flow, Google Workspace account provisioning, and the institution management API. Donors and coordinators use mobile OTP. Hospitals and blood banks use email+password+TOTP. All six roles working by end of phase.

Authentication Flows by Role
Donors and Coordinators — Mobile OTP
POST /auth/otp/send — accepts mobile (+91XXXXXXXXXX format). Validates format. Generates 6-digit OTP. SHA-256 hash stored in platform_users.otp_hash. Expiry in platform_users.otp_expires_at = NOW() + 10 minutes. Sends OTP via MSG91 SMS. Rate limit: max 3 OTP requests per mobile per hour.
POST /auth/otp/verify — accepts mobile + otp. Compare SHA-256(submitted_otp) against stored hash. Check otp_expires_at &gt; NOW(). Increment otp_attempts on failure. Lock account after 5 failures (is_locked=TRUE, locked_until=NOW()+30min). On success: null otp_hash, return JWT (24-hour expiry for donors, 12-hour for coordinators).
JWT payload: { sub: platform_users.id, role: platform_users.role, institution_id: null, session_id: uuid }
Hospital and Blood Bank — Email + Password + TOTP
POST /auth/institutional/login — accepts email + password + totp_code. Lookup platform_users by email (lowercase). Verify bcrypt password hash. If totp_enabled=TRUE, verify TOTP code using authenticator library. Check is_locked. Check institution.onboarding_status = 'AC'. Return JWT (8-hour expiry).
POST /auth/institutional/setup-totp — generates TOTP secret, returns QR code data URL. Secret stored encrypted in platform_users.totp_secret. Not enabled until first successful verification via POST /auth/institutional/confirm-totp.
POST /auth/institutional/reset-password — only callable by ngo_admin role. Generates temp password. Sends via MSG91 WhatsApp to institution's primary_contact_mobile. Sets platform_users.force_password_change = TRUE.
JWT Middleware
All protected routes use verifyJWT middleware. Extracts Bearer token. Verifies signature. Checks platform_users.is_locked = FALSE. Attaches { userId, role, institutionId } to req.user.
requireRole(...roles) middleware: checks req.user.role is in the allowed roles array. Returns 403 if not.
requireInstitution middleware: for blood_bank and hospital roles, verifies req.user.institutionId matches the institution_id in the request body or URL param.

Digital MoU Onboarding Flow
POST /onboarding/apply — public endpoint (no auth). Accepts institution details (Schedule 1 fields). Creates institutions row with onboarding_status='PE'. Creates application record. Notifies ngo_admin via WhatsApp.
POST /onboarding/verify/:id — ngo_admin only. Records license verification. Sets license_verified_at and license_verified_by. Moves status to 'VE'.
POST /onboarding/generate-mou/:id — ngo_admin only. Calls PDF generation service. Populates MoU template with institution details from Schedule 1. Uploads to S3. Triggers LeegAlly API to send Aadhaar eSign request to institution's authorized signatory mobile.
POST /onboarding/mou-signed (webhook from LeegAlly) — receives signing confirmation. Sets mou_signed_at, mou_leegally_doc_id, mou_signatory_name. Calls Google Workspace API to create institutional email (shortname@choudhari.ngo). Creates platform_users record. Sends credentials to primary_contact_mobile via WhatsApp. Sets onboarding_status='AC'.

Phase 2 API Endpoints
Method
Endpoint
Auth
Purpose
POST
/auth/otp/send
Public
Send OTP to mobile. Rate limited.
POST
/auth/otp/verify
Public
Verify OTP. Return JWT.
POST
/auth/institutional/login
Public
Email+password+TOTP login.
POST
/auth/institutional/setup-totp
institutional
Generate TOTP secret and QR.
POST
/auth/institutional/confirm-totp
institutional
Activate TOTP after first success.
POST
/auth/institutional/reset-password
ngo_admin
Reset institutional password.
POST
/auth/logout
Any auth
Invalidate session.
POST
/onboarding/apply
Public
Institution application. Starts onboarding.
GET
/onboarding/applications
ngo_admin
List pending applications.
POST
/onboarding/verify/:id
ngo_admin
Mark institution verified.
POST
/onboarding/generate-mou/:id
ngo_admin
Generate and send MoU for signing.
POST
/onboarding/mou-signed
LeegAlly webhook
MoU signed. Provision credentials.
GET
/institutions
ngo_admin
List all institutions.
GET
/institutions/:id
ngo_admin, self
Get institution details.
PUT
/institutions/:id
ngo_admin
Update institution details.
POST
/institutions/:id/suspend
ngo_admin
Suspend institution.

SECTION 5 — PHASE 3: DONOR REGISTRATION AND ELIGIBILITY
PHASE 3: Donor Registration, Eligibility Screening, and Health Passport
Estimated effort: 4–5 days  ·  Start a fresh coding agent session for this phase
Build donor self-registration via web form and WhatsApp bot, the NBTC-compliant eligibility screening flow, volunteer-guided screening interface, duplicate detection, and the donor health passport.

Donor Registration Paths
Path 1 — Web Form Registration
GET /register — public page. Language auto-detected from browser. Marathi default for Maharashtra.
Step 1 — Pre-screening: 8 permanent exclusion questions shown first. If any YES — soft decline with explanation. Do not collect personal data.
Step 2 — Personal details: full_name, date_of_birth, gender, mobile (triggers OTP), village (searchable by name or pincode), address, ABHA ID (optional), preferred_language.
Step 3 — Eligibility: temporary deferral questions. Alcohol last 48h, fever, recent illness, tattoo/piercing date, pregnancy/breastfeeding, recent donation, medications.
Step 4 — Preferences and consent: availability toggle, DND hours, emergency override consent, WhatsApp opt-in, data use consent (explicit click — not pre-checked).
On submit: run duplicate detection before creating donor record (see Section 5.3). If no duplicate: create donors row with mobile_verified=FALSE, registration_source='WEB'. Send OTP to mobile.
Path 2 — QR Code at Camp
Each donation camp generates a unique QR code containing: camp_id and pre-filled camp location. Donor scans with phone. Opens registration form with camp details pre-filled. Same flow as Path 1 but registration_source='QRC' and registration_camp_id=camp.id.
Path 3 — WhatsApp Bot Registration
When donor sends any message to the platform WhatsApp number, bot responds in their language (detected from message content — Marathi/Hindi/English).
Bot conversation flow: name → date of birth → gender → village/city → blood group (self-reported, labelled unverified) → consent confirmation.
After conversation: creates donor record with registration_source='WAB'. Sends OTP to the same WhatsApp number to verify mobile.
Bot uses MSG91 WhatsApp API with DLT-registered conversation templates.

Duplicate Detection Logic
On every new donor registration, before INSERT, run these checks in sequence:
Check 1 — ABHA ID match: if submitted ABHA ID exists on another donor → block registration with message 'A profile already exists with this health ID. If you changed your number, contact support.'
Check 2 — Name + DOB exact match: same full_name (case-insensitive) + same date_of_birth → flag suspected_duplicate_of on new record. Allow registration but alert ngo_admin.
Check 3 — Aadhaar last4 + DOB match: same aadhaar_last4 + same date_of_birth → same action as Check 2.
Check 4 — Name soundex + DOB + district → log for periodic review. No immediate action.
POST /donors/merge — ngo_admin only. Accepts primary_donor_id and secondary_donor_id. Validates both. Updates all donation_history, donor_screening, donor_alerts, blood_inventory rows to point to primary. Copies worst-case deferral status. Sets secondary.merged_into=primary.id, secondary.is_active=FALSE. Adds secondary mobile to primary.alternate_mobiles. Writes merge event to audit_log.

Blood Group Verification Rule
CRITICAL  blood_group_self_reported is displayed everywhere with an 'Unverified' badge. It is NEVER used in any matching query. Only blood_group_verified is used in matching. blood_group_verified can ONLY be written by blood_bank role after lab typing. This is enforced by RLS: app_user role cannot UPDATE blood_group_verified. Only bb_writer role (used by blood bank API) can update it.

Donor Health Passport — GET /donors/:id/passport
Returns donor's complete donation history with source labels (Verified / Unverified / Retroactively Verified).
Returns hemoglobin readings from each verified donation.
Returns overall_clearance status (Cleared / Pending / Deferred) without revealing individual TTI field values.
Returns next_eligible_date with component breakdown.
Self-reported donations shown with 'Unverified — not used in matching' label.
Blood group shown as 'Lab verified: B+' or 'Self-reported (unverified): B+' with visual distinction.

SECTION 6 — PHASE 4: BLOOD INVENTORY AND DONATION WORKFLOW
PHASE 4: Blood Inventory, Donation Recording, and TTI Screening
Estimated effort: 4–5 days  ·  Start a fresh coding agent session for this phase
Build the blood bank inventory management interface, the donation event recording workflow (which drives inventory creation), TTI result entry with the four-eyes verification protocol, and the automated expiry and conservation alert jobs.

Inventory Creation — Event-Driven, Not Self-Reported
PRINCIPLE  Blood inventory is never created by staff typing a number. It is created as a consequence of the donation workflow. When a blood bank records a donation, blood_inventory rows are automatically created in QA (quarantine) status by a trigger. No separate inventory entry step exists for new donations. Self-reporting via WhatsApp is only for opening stock at onboarding.

Donation Recording Flow
POST /donations — blood_bank role only. Body: donor_id (or mobile to lookup), blood_bank_id, collection_date, component_id, volume_ml, hb_gdl, hb_method, isbt_barcode.
Validation: confirm donor deferral_status = 'A'. Confirm hb_gdl &gt;= blood_components.min_donor_hb for donor's gender and component. Confirm donation gap (next_eligible_date &lt;= today). Reject if any fails — return reason.
On success: INSERT donation_history (source='BB'). Trigger automatically INSERTs blood_inventory row with status='QA'. Returns donation_id and a list of blood_inventory bag IDs created.

TTI Result Entry — Four-Eyes Protocol
POST /donations/:id/screening — blood_bank role (entered_by). Accepts all TTI fields. Each TTI field accepts: PE (pending), NR (non-reactive), RR (reactive), ID (indeterminate). On submit: INSERT donor_screening row with overall_clearance='PE'. Write to screening_audit_log.
When any field is RR: overall_clearance remains PE until supervisor verifies. Alert sent to blood bank supervisor. Set verified_by=NULL — supervisor must explicitly verify.
POST /donations/:id/screening/verify — blood_bank role, supervisor only (second user). Confirms the reactive result. Sets verified_by and verified_at. TRIGGERS: donor deferral update, blood bag recall, lookback_registry creation, donor notification task queued (human call — not automated).
When all TTI fields NR: overall_clearance auto-calculated as 'CL' by trigger. blood_inventory bags move from QA to AV automatically. Donor receives WhatsApp thank-you with Hb reading and next eligible date.

Opening Stock — WhatsApp Bot for Manual Blood Banks
When blood bank staff sends a message in format 'UPDATE B+ 4 O+ 2 A+ 6' to the platform WhatsApp number from their registered mobile, the bot parses the message and creates blood_inventory rows with source='WB' (WhatsApp bot) and status='AV' (no TTI screening for legacy stock — clearly labelled).
Opening stock units are shown to coordinators with label 'Legacy stock — no TTI record' and are deprioritised below fully screened units in matching results.
Bot confirms: 'Stock updated. B+ = 4 units. O+ = 2 units. A+ = 6 units. O- = 0 — CRITICAL LOW.'

Scheduled Automated Jobs
Job
Schedule
What it does
expiry_alert_job
Every 6 hours
Find AV bags where expiry_date = today+2 AND expiry_alert_sent_48h=FALSE. Send WhatsApp to blood bank. Set flag. Same for 24h. Platelets checked every 6h due to 5-day shelf life.
auto_expire_job
Daily at midnight
Set status=EX for all AV bags where expiry_date &lt; CURRENT_DATE. Write wastage count to notification_log for daily blood bank report.
o_negative_conservation
Every 4 hours
Count AV O- units per blood bank. If &lt; 3 units, send alert to blood bank and assigned district coordinator.
stale_reservation_release
Hourly
Find RE bags where reserved_at &gt; 2h (Critical) or 4h (Urgent). Set status=AV, null reserved_for_request_id. Alert coordinator.
eligibility_reminder_job
Daily at 8 AM
Find donors where next_eligible_date = CURRENT_DATE + 7. Send WhatsApp reminder in preferred_language.
planned_request_upgrade
Every 15 minutes
Upgrade PL requests to UR if needed_by &lt; NOW()+4h. Upgrade UR to CR if needed_by &lt; NOW()+60min.
dho_alert_job
Every 15 minutes
Find open requests past dho_alert_threshold_minutes since raised_at. Send alert to ngo_admin for DHO notification.
annual_donor_checkup
Daily
Find donors with no donation in 12 months. Send WhatsApp: 'Is your record still current? Reply YES to confirm.'

SECTION 7 — PHASE 5: BLOOD REQUEST ENGINE AND MATCHING
PHASE 5: Blood Request Engine, Matching, Escalation, and Coordinator Platform
Estimated effort: 6–7 days  ·  Start a fresh coding agent session for this phase
The operational heart of the platform. Build the blood request submission flow for all four source tiers, the matching engine, the auto-escalation chain, the coordinator dashboard, request threads, and donor alert activation. This is the most complex phase.

Blood Request Submission — Four Source Tiers
Tier 1 (OH — Onboarded Hospital): POST /requests — hospital role. Full access. All urgency tiers. Documents uploaded at submission. Auto-approved. Matching engine starts immediately.
Tier 2 (GH — Guest Hospital): POST /requests/guest — coordinator role only. Coordinator creates on behalf of non-onboarded hospital. Accepts guest_hospital_name, guest_doctor_name, guest_doctor_reg_number. NMC registry check runs async. Full emergency response activated immediately. Post-emergency onboarding invitation sent within 24h.
Tier 3 (CR — Coordinator Request): POST /requests/community — coordinator role. On behalf of known patient. Requires hospital name and doctor name. Max urgency = URGENT. ngo_admin auto-alerted. No donor activation until ngo_admin confirms.
Tier 4 (CI — Citizen Request): POST /requests/citizen — donor role. Must provide hospital name, ward, doctor name. Max urgency = URGENT. Coordinator must verify before any donor is alerted. coordinator_verified_at must be set before donor_alerts are created.

The Matching Engine — POST /requests/:id/match
Step 1: Query blood_inventory WHERE blood_bank_id IN (onboarded banks in requesting hospital's district) AND blood_group_id IN (compatible groups for patient's group per compatibility_matrix) AND component_id = requested_component AND status = 'AV' AND expiry_date &gt; NOW() AND is_recalled = FALSE. ORDER BY is_preferred DESC (same group first), then expiry_date ASC (soonest expiry first — FIFO).
Step 2: If Step 1 returns sufficient units — reserve them (status=RE, reserved_for_request_id=request.id). Set request.matched_blood_bank_id. Set request.status='MT'. Set first_match_found_at=NOW(). If fallback group used: set compatibility_fallback_used=TRUE, fallback_blood_group_id. Send crossmatch warning.
Step 3: If inventory insufficient AND request.donor_activation_required=TRUE — query donors WHERE blood_group_verified IN (compatible groups) AND deferral_status='A' AND is_available=TRUE AND mobile_verified=TRUE AND consent_data_use=TRUE AND next_eligible_date &lt;= CURRENT_DATE AND village_id.district_id IN (request hospital district initially). ORDER BY reliability_score DESC, ST_Distance(donor coords, hospital coords) ASC. Create donor_alerts rows. Send WhatsApp alerts via MSG91.
Step 4: Insert escalation_log row for this ring. Set ring=1, radius_km=50, triggered_by='AU'.

Auto-Escalation Engine
A scheduled job runs every escalation_timeout_minutes (from the GENERATED column on blood_requests). For each open request past its timeout since last escalation ring:
Ring 1→2: Expand search to all districts in Maharashtra. Insert escalation_log ring=2, radius_km=150.
Ring 2→3: Expand to adjacent states. For rare blood groups — expand nationally immediately regardless of ring.
Ring 3→4: Alert DHO directly via WhatsApp and call.
CRITICAL requests: if unresolved at 30 minutes — ngo_admin receives a phone call (not just WhatsApp). This is implemented using MSG91 voice call API.

Coordinator Dashboard API
GET /coordinator/requests — returns all open requests for coordinator's district. Includes: request_number, urgency_tier (colour coded), units_required, units_fulfilled, time since raised_at, current status, is_current assignment.
POST /coordinator/requests/:id/accept — coordinator accepts assignment. Sets coordinator_accepted_at=NOW() on request_assignments row.
POST /coordinator/requests/:id/claim — coordinator claims unaccepted request from another coordinator after timeout. Creates new request_assignments row with assignment_type='CL'.
POST /coordinator/requests/:id/thread — add message to request_threads. Body: message_text, message_type, visible_to_roles array, optional attachment.
POST /coordinator/requests/:id/verify — for Tier 3 and 4 requests. Sets coordinator_verified_at. Activates matching engine.
POST /coordinator/requests/:id/noshow — mark a confirmed donor as no-show. Sets donor_alerts.donor_response='NS'. Increments donors.no_show_count by trigger. Recalculates reliability_score.
POST /coordinator/requests/:id/close — marks request fulfilled. Requires at least one bag_id linked. Sets fulfilled_at.

Request Thread Rules
Messages are rows in request_threads — never JSON blobs on the request row.
System auto-posts a message when: request status changes, escalation ring activates, coordinator is assigned, donor confirms availability.
Coordinators can edit their own messages within 5 minutes of sending. edit_original_text stores the pre-edit version. After 5 minutes: immutable.
visible_to_roles: default all parties. Coordinator can send message visible only to coordinators (excluding hospital). Useful for internal coordination notes.

SECTION 8 — PHASE 6: NOTIFICATIONS, WHATSAPP BOT, AND LOOKBACK
PHASE 6: Notification Engine, WhatsApp Bot, and Lookback Protocol
Estimated effort: 4–5 days  ·  Start a fresh coding agent session for this phase
Build the complete notification engine (WhatsApp + SMS + call escalation), the WhatsApp bot for donor registration and inventory updates, opt-out enforcement, and the lookback protocol for reactive TTI results.

Notification Engine Architecture
All notifications go through a single sendNotification(recipientId, templateType, variables, channel) service function. Never call MSG91 directly from route handlers.
The function: (1) checks opted-in status for the channel, (2) checks DND hours unless Critical tier override, (3) selects correct language template from MSG91, (4) calls MSG91 API, (5) writes to notification_log regardless of success or failure, (6) sets up delivery webhook listener for status update.
Fallback chain: if WhatsApp delivery fails after 3 minutes (delivery_status stays 'SE') → automatic SMS fallback. For Critical tier with emergency_override=TRUE: if SMS also fails → MSG91 voice call.
Opt-out enforcement: MSG91 webhooks POST to /webhooks/msg91/delivery. If delivery_status = 'OP' (opted out): immediately set donors.sms_opted_in=FALSE or whatsapp_opted_in=FALSE in same transaction. notification_log.is_opt_out_trigger=TRUE.

DLT Template Requirements
RULE  India's TRAI requires all bulk SMS/WhatsApp messages to use pre-registered DLT templates. Register the following templates with MSG91 before sending any notification. Template variables are in curly braces.
Template ID
Language
Template Content
BC_OTP_EN
English
Your Raktify verification code is {1}. Valid for 10 minutes. Do not share.
BC_EMG_MR
Marathi
🆘 {1} रुग्णालयाला {2} रक्ताची तातडीची गरज आहे. तुम्ही मदत करू शकता का? {3} वर उत्तर द्या.
BC_EMG_HI
Hindi
🆘 {1} अस्पताल को {2} रक्त की तत्काल आवश्यकता है। क्या आप मदद कर सकते हैं? {3} पर जवाब दें।
BC_THK_MR
Marathi
धन्यवाद! तुमचे रक्तदान नोंदवले गेले. रक्तगट: {1}. Hb: {2} g/dL. पुढचे दान: {3} पासून.
BC_THK_HI
Hindi
धन्यवाद! आपका रक्तदान दर्ज किया गया। रक्त समूह: {1}. Hb: {2} g/dL. अगला दान: {3} से।
BC_REM_MR
Marathi
तुम्ही {1} पासून पुन्हा रक्तदान करू शकता! Raktify वर नोंदणी करा.
BC_CRED
English
Your Raktify credentials: Email: {1} | Temp Password: {2} | Change password on first login at {3}

WhatsApp Bot — Registration and Inventory Update
All incoming WhatsApp messages POST to /webhooks/whatsapp/incoming from MSG91.
Bot router: identify sender mobile. If not registered: start registration conversation. If registered donor: handle donation-related queries, availability toggle, eligibility check. If registered blood bank staff: handle inventory updates.
Inventory update parsing: message matching pattern 'UPDATE [GROUP] [COUNT] [GROUP] [COUNT]...' → parse blood group codes (A+, B-, O+, etc.) and counts → create blood_inventory rows with source='WB'. Confirm back with current totals per group.
Registration conversation state stored in Redis (or a simple sessions table if Redis not available in v1) with TTL of 1 hour. State machine: IDLE → NAME → DOB → GENDER → VILLAGE → CONSENT → COMPLETE.
All bot messages use DLT-registered templates. Free-form messages from bot are not permitted under TRAI rules.

Lookback Protocol Implementation
CRITICAL  The lookback activation is a single atomic database transaction. If any part fails, the entire transaction rolls back. A partial lookback is worse than no lookback.
Triggered automatically when trg_screening_clearance fires with overall_clearance='IN'.
In one atomic transaction: (1) SET donors.deferral_status='P' or 'T'. (2) SET all blood_inventory WHERE donor_id=affected AND status IN ('QA','AV','RE') → status='RC'. (3) INSERT lookback_registry row for every donation_history row WHERE donor_id=affected AND trust_level='V'. (4) For IS-status bags: INSERT into a lookback_urgent_queue table that triggers immediate WhatsApp+call to receiving hospital. (5) Insert RECALL event in audit_log.
GET /lookback/:donor_id — ngo_admin only. Returns all lookback_registry rows for the donor with bag status, receiving institution, and current investigation status.
POST /lookback/:id/contact-hospital — ngo_admin only. Records that hospital was contacted. Sets hospital_contacted_at, hospital_contacted_by. Sets lookback_status='CN'.
POST /lookback/:id/close — ngo_admin only. Requires outcome_notes non-null. Sets lookback_status='CL', closed_at, closed_by. If tti_trigger contains HIV or HBsAg: requires dho_notified=TRUE before allowing close.

SECTION 9 — PHASE 7: FRONTEND — DONOR AND COORDINATOR INTERFACES
PHASE 7: Frontend — Donor Web App, Coordinator Dashboard, Hospital Portal
Estimated effort: 6–7 days  ·  Start a fresh coding agent session for this phase
Build the complete React frontend. Three distinct interfaces: (1) Donor-facing app in Marathi/Hindi/English, (2) Coordinator dashboard, (3) Hospital and blood bank portal. Mobile-first. Offline-capable PWA for donors and coordinators.

Donor Interface — Language and Mobile First
Default language: Marathi (mr). Auto-detect from browser navigator.language. User can change at any point — preference saved in localStorage and donor profile.
All donor-facing routes: /register, /login, /dashboard, /passport, /camps, /availability.
The /register route implements the 4-step eligibility and registration flow from Phase 3.
The /dashboard shows: availability toggle (large, prominent), next eligible date, total donations count, blood group (with verified/unverified badge), community name, recent request alerts.
The /passport shows the complete donation history health passport — one card per donation with date, location, component, Hb level, and verification status.
PWA configuration: service worker caches the app shell, donor profile, and last-known availability status. Donors can toggle availability offline — syncs when connection returns.

Coordinator Dashboard
Real-time request queue — WebSocket connection (Socket.io) updates the queue when new requests arrive without page refresh.
Each request card shows: BC request number, hospital name, blood group and component needed, urgency tier (colour: red/amber/gray), units required vs fulfilled, time elapsed since submission, current assignment status.
Clicking a request opens the request detail panel: full clinical notes, uploaded documents (pre-signed S3 URLs, 10-minute expiry), compatibility match found, matched blood bank details, donor alert status, request thread.
Thread input: text message, role-visibility selector, document attach. Messages appear in real-time via WebSocket.
Action buttons: Accept, Claim, Verify (Tier 3/4), Mark No-Show, Close Request.
Coordinator profile page: impact metrics displayed — total donors, total donations by community, requests fulfilled, response time median, reliability score.

Hospital Portal
Simple, focused interface. Primary action: Raise Blood Request.
Request form: blood group selector, component selector, units (1–20 spinner), urgency tier (3 large buttons with clinical examples), needed-by datetime picker, age group, brief clinical note, document upload.
Active requests list: shows BC request number, status (colour-coded), units fulfilled/required, matched blood bank or 'Searching...', coordinator name.
When request is fulfilled: hospital sees a confirm-crossmatch prompt before marking request closed. This updates crossmatch_confirmed=TRUE on the request.

Blood Bank Portal
Inventory dashboard: table showing available units per blood group and component with expiry colour coding (green &gt; 7 days, amber 2–7 days, red &lt; 48 hours).
Record donation button: opens donation recording form (donor mobile lookup → auto-fill if registered → Hb, component, volume, ISBT barcode).
TTI results entry: accordion per donation. Enter each TTI field. Submit for processing. If any RR: supervisor verification panel appears.
Incoming request alerts: real-time panel showing open requests that match their available inventory. 'Raise Hand' button to volunteer for fulfillment.
Opening stock entry: one-time form at onboarding. Staff enters current counts per blood group. Creates legacy stock inventory rows.

Frontend State Management and API Rules
Axios for all API calls. Interceptor adds Authorization: Bearer [JWT] header. Interceptor catches 401 (expired token) and redirects to login.
React Query for server state. Cache invalidation on mutations. No stale data shown to coordinators in emergency view.
Form validation: Zod schemas that mirror backend validation. Client validates first but backend always re-validates — client validation is UX only, never security.
All times displayed in IST (UTC+5:30). Store and transmit as UTC. Display only converts.

SECTION 10 — PHASE 8: ADMIN DASHBOARD, REPORTING, AND DEPLOYMENT
PHASE 8: NGO Admin Dashboard, DHO Reports, Security Hardening, and Production Deployment
Estimated effort: 4–5 days  ·  Start a fresh coding agent session for this phase
Build the NGO admin dashboard, hemovigilance and DHO reporting, security hardening (rate limiting, input sanitisation, CORS, helmet), integration testing, and production deployment to AWS Mumbai with monitoring.

NGO Admin Dashboard
Institution management: onboarding queue, active institutions, pending MoU renewals (60-day warning), CDSCO licence expiry tracker.
Coordinator management: verification queue, active coordinators, reliability scores, handover requests.
Duplicate donor review: list of suspected_duplicate pairs flagged by detection. Approve merge or clear flag.
Referral funnel: institution_referrals pipeline — New → Contacted → Interested → Onboarded. Conversion rate metrics.
Lookback tracker: all open lookback_registry investigations. Red highlight for cases open &gt; 14 days. DHO notification status per case.
Audit log viewer: filterable by table, actor, date range. Read-only. Shows old_value and new_value for permitted roles. Hash chain integrity check button.

DHO and Hemovigilance Reports
GET /reports/district/:district_id/summary?month=YYYY-MM — returns: total requests raised, fulfilled, expired unfulfilled. Average response time. Average time-to-match. Blood groups most in shortage. Donor pool size and active donors. Camp count and units collected. Wastage (expired units) count and reasons.
GET /reports/hemovigilance?month=YYYY-MM — returns: adverse transfusion reactions reported, lookback cases opened/closed, reactive TTI counts by type, replacement vs voluntary donation breakdown. Format must be exportable as PDF for DHO submission.
GET /reports/blood-bank/:id/performance — returns: inventory accuracy score (units donated vs accounted for), fulfillment rate, average TTI entry time, discrepancy count.
All reports available as JSON (for frontend charts) and CSV (for download). PDF generation via a simple HTML-to-PDF service (Puppeteer or wkhtmltopdf).

Security Hardening Checklist
Helmet.js: sets all security headers (CSP, HSTS, X-Frame-Options, X-Content-Type-Options).
CORS: whitelist only FRONTEND_URL and coordinator app URL. No wildcard origin.
Rate limiting (express-rate-limit): /auth/otp/send — 3 requests per mobile per hour. /auth/institutional/login — 10 requests per IP per 15 minutes. All API endpoints — 100 requests per IP per minute.
Input sanitization: all user inputs run through DOMPurify (frontend) and a custom sanitizeInput middleware (backend) before database writes.
SQL injection: Parameterized queries only via pg library. Zero string concatenation in SQL. ESLint rule added to catch template literal SQL.
File upload security: S3 presigned URL upload (browser uploads directly to S3, never through backend). MIME type verification. Max file size 10MB. Allowed types: PDF, JPG, PNG only.
Secrets: zero hardcoded credentials. All in environment variables. .env never committed. GitHub Actions uses GitHub Secrets. AWS uses IAM roles.

Production Deployment
Database — AWS RDS PostgreSQL
Instance: db.t3.micro for launch. db.t3.small when &gt; 500 donors.
Multi-AZ: enable from launch day. This is a life-critical system — single-AZ has no justification.
Automated backups: daily. 7-day retention. Point-in-time recovery enabled.
Encryption at rest: enabled. KMS key: same KMS_MAIN_KEY_ARN.
Security group: only accepts connections from backend EC2 security group. No public access.
Backend — AWS EC2 or Elastic Beanstalk
EC2: t3.small. Ubuntu 24.04. Node.js 22 LTS. PM2 process manager with cluster mode.
HTTPS only: SSL certificate via AWS Certificate Manager. Load balancer terminates SSL.
Health check: /health endpoint must return 200 within 5 seconds or instance is recycled.
Application logs: CloudWatch Logs. Retain 90 days. Alert on ERROR log count &gt; 10 per minute.
Monitoring and Alerting
AWS CloudWatch: CPU &gt; 80%, memory &gt; 85%, DB connections &gt; 80% of max → alert to ops@choudhari.ngo.
Uptime monitoring: UptimeRobot or Better Uptime. Check /health every 60 seconds. SMS alert if down. Target: 99.5% monthly uptime.
Error tracking: Sentry. Capture all unhandled exceptions. Alert on new error types immediately.

Go-Live Checklist
REQUIRED  All items below must be checked before the first real hospital or blood bank is given access to production.
✓
Item
□
All 25 migration files run successfully on production database with zero errors.
□
All reference data seeded: blood_groups (8 rows), blood_components (6 rows), compatibility_matrix (verified by medical advisor), LGD geographic data (active for Maharashtra).
□
All triggers tested: donation creates inventory, TTI reactive triggers deferral and lookback, blood request auto-assigns coordinator, audit_log writes on every change.
□
RLS policies verified: each role tested to confirm they can only access their permitted data. Test script in /scripts/test_rls.sql.
□
Audit log integrity: sample 100 rows. Verify hash chain is unbroken. Verify no UPDATE or DELETE possible on audit_log.
□
MSG91 DLT templates registered and approved for all required templates.
□
WhatsApp bot tested: registration flow in Marathi, Hindi, English. Inventory update parsing. Opt-out handling.
□
OTP flow tested: send, verify, expiry, lockout after 5 failures.
□
TOTP 2FA tested for hospital and blood bank accounts.
□
LeegAlly MoU signing tested end-to-end with a test institution.
□
Google Workspace admin account active. Test credential provisioning via API.
□
S3 presigned URL upload tested. MIME verification working. Max size enforced.
□
All scheduled jobs registered and tested in staging environment.
□
Offline PWA tested: donor can toggle availability offline. Syncs when online.
□
Lookback protocol tested end-to-end: enter reactive TTI → confirm deferral triggered → confirm inventory recalled → confirm lookback_registry rows created.
□
Medical advisor has confirmed: eligibility criteria, compatibility matrix, TTI deferral periods, component shelf lives.
□
Legal advisor has approved MoU template. First MoU signed with Irwin Hospital or PDMMC.
□
ngo_admin account created. super_admin account created. Both with TOTP enabled.
□
Offline emergency fallback sheet printed and delivered to all partner hospitals and blood banks.
□
Monitoring alerts tested: kill backend process, confirm CloudWatch alert fires within 5 minutes.

Phase Dependency Summary
Phase
Depends On
Cannot Start Until
Phase 0
Nothing
—
Phase 1
Phase 0
Infrastructure and environment variables in place.
Phase 2
Phase 1
All 25 migrations run. All seed data loaded. Triggers active.
Phase 3
Phase 2
Auth working. Institution onboarding working. At least one hospital account active.
Phase 4
Phase 3
Donor registration working. At least one donor registered.
Phase 5
Phase 4
Blood inventory creating correctly from donations. TTI workflow complete.
Phase 6
Phase 5
Request submission working. Matching engine returning results.
Phase 7
Phase 6
Backend APIs for all entities complete and tested.
Phase 8
Phase 7
All frontend interfaces complete. E2E test scenarios passing.

FINAL NOTE  This master prompt is a living document. When the medical advisor returns feedback on the 20 clinical questions, update the compatibility matrix seed data, TTI deferral periods, and any eligibility criteria before Phase 1 migration runs. When the lawyer returns feedback on the MoU, update the LeegAlly template before Phase 2 onboarding flow is built. No clinical data should be hardcoded in application code — all clinical reference data lives in the database and can be updated without a code deployment.

— End of Raktify Master Prompt v1.0 —
Choudhari EduHealth India Foundation  |  ops@choudhari.ngo  |  Amravati, Maharashtra