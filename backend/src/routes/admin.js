/**
 * Admin / ops endpoints (Phase 6).
 *
 *   GET  /admin/jobs          list registered scheduler jobs
 *   POST /admin/jobs/run      manually trigger one job (super_admin)
 */
const express = require('express');
const { z } = require('zod');

const { verifyJWT, requireRole } = require('../middleware/auth');
const scheduler = require('../services/scheduler');

const router = express.Router();

router.get('/jobs', verifyJWT, requireRole('ngo_admin', 'super_admin'), (_req, res) => {
  res.json({ jobs: scheduler.listJobs() });
});

router.post('/jobs/run', verifyJWT, requireRole('super_admin'), async (req, res) => {
  const schema = z.object({ name: z.string().min(2) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });

  try {
    const result = await scheduler.runJob(parsed.data.name);
    res.json(result);
  } catch (err) {
    if (/unknown_job/.test(err.message)) {
      return res.status(404).json({ error: err.message });
    }
    throw err;
  }
});

module.exports = router;
