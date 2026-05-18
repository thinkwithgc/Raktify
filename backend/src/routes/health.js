const express = require('express');
const env = require('../config/env');
const { query } = require('../config/db');
const logger = require('../config/logger');

const router = express.Router();

router.get('/', async (_req, res) => {
  const payload = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: env.nodeEnv,
    service: 'raktify-api',
    version: '0.1.0',
  };

  try {
    const r = await query('SELECT 1 AS ok');
    payload.db = r.rows[0].ok === 1 ? 'ok' : 'degraded';
  } catch (err) {
    logger.warn({ err: err.message }, 'Health check: db unreachable');
    payload.db = 'unreachable';
    payload.status = 'degraded';
  }

  res.status(payload.status === 'ok' ? 200 : 503).json(payload);
});

module.exports = router;
