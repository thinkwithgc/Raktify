const express = require('express');
require('express-async-errors'); // patches Express 4 to forward async errors to the error handler
const helmet = require('helmet');
const cors = require('cors');
const env = require('./config/env');
const logger = require('./config/logger');
const healthRouter = require('./routes/health');
const authRouter = require('./routes/auth');
const onboardingRouter = require('./routes/onboarding');
const institutionsRouter = require('./routes/institutions');
const donorsRouter = require('./routes/donors');
const donationsRouter = require('./routes/donations');
const inventoryRouter = require('./routes/inventory');
const requestsRouter = require('./routes/requests');
const coordinatorRouter = require('./routes/coordinator');
const lookbackRouter = require('./routes/lookback');
const webhooksRouter = require('./routes/webhooks');
const adminRouter = require('./routes/admin');

function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(
    cors({
      origin: [env.frontendUrl],
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));

  app.use((req, _res, next) => {
    req.log = logger.child({ method: req.method, path: req.path });
    next();
  });

  app.use('/health', healthRouter);
  app.use('/auth', authRouter);
  app.use('/onboarding', onboardingRouter);
  app.use('/institutions', institutionsRouter);
  app.use('/donors', donorsRouter);
  app.use('/donations', donationsRouter);
  app.use('/inventory', inventoryRouter);
  app.use('/requests', requestsRouter);
  app.use('/coordinator', coordinatorRouter);
  app.use('/lookback', lookbackRouter);
  app.use('/webhooks', webhooksRouter);
  app.use('/admin', adminRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  app.use((err, req, res, _next) => {
    const status = err.status || 500;
    const logFn = status >= 500 ? 'error' : 'warn';
    req.log?.[logFn](
      { err: err.message, status, stack: status >= 500 ? err.stack : undefined },
      'Request error',
    );
    // err.code (canonical machine code) > err.message (human, not safe for prod 500s) > 'internal_error'
    const errorCode = err.code || (status < 500 ? err.message : null) || 'internal_error';
    const body = { error: errorCode };
    if (err.detail) body.detail = err.detail;
    res.status(status).json(body);
  });

  return app;
}

module.exports = createApp;
