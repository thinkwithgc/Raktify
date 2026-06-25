const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function optional(name, fallback) {
  return process.env[name] ?? fallback;
}

const env = {
  nodeEnv: optional('NODE_ENV', 'development'),
  port: parseInt(optional('PORT', '3000'), 10),
  frontendUrl: optional('FRONTEND_URL', 'http://localhost:5173'),
  logLevel: optional('LOG_LEVEL', 'info'),

  // Staging-only: when true, /auth/otp/send returns the OTP in the response
  // body so a live staging site can be demoed without a working SMS/WhatsApp
  // channel. MUST be false (unset) in real production.
  otpEcho: optional('OTP_ECHO', 'false') === 'true',

  jwt: {
    secret: required('JWT_SECRET'),
    expiresIn: optional('JWT_EXPIRES_IN', '8h'),
  },

  db: {
    url: required('DATABASE_URL'),
    urlProd: optional('DATABASE_URL_PROD', null),
  },

  aws: {
    region: optional('AWS_REGION', 'ap-south-1'),
    s3Bucket: optional('S3_BUCKET_NAME', null),
    kmsMainKeyArn: optional('KMS_MAIN_KEY_ARN', null),
    kmsScreeningKeyArn: optional('KMS_SCREENING_KEY_ARN', null),
  },

  providers: {
    encryption: optional('ENCRYPTION_PROVIDER', 'local'),
    notifications: optional('NOTIFICATIONS_PROVIDER', 'console'),
    storage: optional('STORAGE_PROVIDER', 'local'),
    mail: optional('MAIL_PROVIDER', 'console'),
  },

  local: {
    encryptionKeyHex: optional('LOCAL_ENCRYPTION_KEY_HEX', null),
    screeningEncryptionKeyHex: optional('LOCAL_SCREENING_ENCRYPTION_KEY_HEX', null),
    storageDir: optional('LOCAL_STORAGE_DIR', './.local-storage'),
    outboxDir: optional('LOCAL_OUTBOX_DIR', './.outbox'),
  },

  msg91: {
    authKey: optional('MSG91_AUTH_KEY', null),
    senderId: optional('MSG91_SENDER_ID', 'RAKTFY'),
    whatsappNumber: optional('MSG91_WHATSAPP_NUMBER', null),
    templates: {
      otp: optional('MSG91_TEMPLATE_OTP', null),
      emergencyMr: optional('MSG91_TEMPLATE_EMERGENCY_MR', null),
      emergencyHi: optional('MSG91_TEMPLATE_EMERGENCY_HI', null),
      thankyouMr: optional('MSG91_TEMPLATE_THANKYOU_MR', null),
      reminderMr: optional('MSG91_TEMPLATE_REMINDER_MR', null),
      cred: optional('MSG91_TEMPLATE_CRED', null),
    },
  },

  // WhatsApp Business Cloud API (Meta-hosted, direct — no BSP/DLT).
  // Activates when NOTIFICATIONS_PROVIDER=whatsapp_cloud and these are set.
  whatsapp: {
    phoneNumberId: optional('WHATSAPP_PHONE_NUMBER_ID', null),
    accessToken: optional('WHATSAPP_ACCESS_TOKEN', null),
    wabaId: optional('WHATSAPP_WABA_ID', null),
    webhookVerifyToken: optional('WHATSAPP_WEBHOOK_VERIFY_TOKEN', null),
    appSecret: optional('WHATSAPP_APP_SECRET', null),
    apiVersion: optional('WHATSAPP_API_VERSION', 'v21.0'),
    // Meta-approved template names, keyed by templateType (lower-cased).
    // Add a new entry here when registering a new template in the provider.
    templates: {
      otp: optional('WHATSAPP_TEMPLATE_OTP', null),
      emg: optional('WHATSAPP_TEMPLATE_EMERGENCY', null),
      thk: optional('WHATSAPP_TEMPLATE_THANKYOU', null),
      rem: optional('WHATSAPP_TEMPLATE_REMINDER', null),
      cred: optional('WHATSAPP_TEMPLATE_CRED', null),
      // institutional_setup_link — replaces the rejected `institutional_credentials`
      // template. Used by /onboarding/mou-signed to deliver the magic password-setup
      // link instead of a temp password. See docs/Raktify_WhatsApp_Templates.md.
      setup_link: optional('WHATSAPP_TEMPLATE_SETUP_LINK', null),
    },
  },

  // Leegality (Aadhaar eSign — leegality.com). The legacy `leegally` typo is
  // intentionally retained on the DB columns (mou_versions.leegally_doc_id,
  // .leegally_template_id) to avoid a migration; everywhere else uses the
  // correct spelling. Old LEEGALLY_* env vars are no longer read.
  leegality: {
    authToken: optional('LEEGALITY_AUTH_TOKEN', null),
    privateSalt: optional('LEEGALITY_PRIVATE_SALT', null),
    // Note: Leegality calls this `profileId` (Workflow ID). Our env name
    // is historical — it IS the workflow ID from the dashboard.
    templateId: optional('LEEGALITY_TEMPLATE_ID', null),
    // Production: https://app1.leegality.com/api · Sandbox: https://sandbox.leegality.com/api
    baseUrl: optional('LEEGALITY_BASE_URL', 'https://app1.leegality.com/api'),
  },

  lgd: {
    useApi: optional('LGD_USE_API', 'true') === 'true',
    apiBase: optional('LGD_API_BASE', 'https://lgdirectory.gov.in/api'),
    apiKey: optional('LGD_API_KEY', null),
    csvDir: optional('LGD_CSV_DIR', './data/lgd'),
  },
};

module.exports = env;
