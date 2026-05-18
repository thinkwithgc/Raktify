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

  leegally: {
    apiKey: optional('LEEGALLY_API_KEY', null),
    templateId: optional('LEEGALLY_TEMPLATE_ID', null),
    baseUrl: optional('LEEGALLY_BASE_URL', 'https://api.leegally.com'),
  },

  lgd: {
    useApi: optional('LGD_USE_API', 'true') === 'true',
    apiBase: optional('LGD_API_BASE', 'https://lgdirectory.gov.in/api'),
    apiKey: optional('LGD_API_KEY', null),
    csvDir: optional('LGD_CSV_DIR', './data/lgd'),
  },
};

module.exports = env;
