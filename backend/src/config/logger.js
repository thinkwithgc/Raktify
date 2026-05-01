const pino = require('pino');
const env = require('./env');

const transport =
  env.nodeEnv === 'development'
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' } }
    : undefined;

const logger = pino({
  level: env.logLevel,
  base: { service: 'bloodconnect-api', env: env.nodeEnv },
  transport,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.otp',
      '*.otp_hash',
      '*.aadhaar*',
      '*.token',
      '*.secret',
    ],
    remove: true,
  },
});

module.exports = logger;
