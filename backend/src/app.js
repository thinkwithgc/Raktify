const express = require('express');
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

  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  app.use((err, req, res, _next) => {
    req.log?.error({ err: err.message, stack: err.stack }, 'Unhandled error');
    res.status(err.status || 500).json({ error: err.code || 'internal_error' });
  });

  return app;
}

module.exports = createApp;
