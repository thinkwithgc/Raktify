/**
 * Scheduler — registers cron jobs and exposes a manual-trigger interface.
 *
 * Jobs are autoloaded from ./jobs/*.js and must export
 *   { name, cron, description, run(): Promise<any> }
 *
 * In dev (NODE_ENV=development), cron registration is OPT-IN via
 *   SCHEDULER_ENABLED=true
 * so the smoke test doesn't fight a parallel cron tick. The manual
 * trigger (services/scheduler.runJob(name)) and the
 * POST /admin/jobs/run endpoint always work regardless.
 */
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const env = require('../../config/env');
const logger = require('../../config/logger');

const jobsDir = path.join(__dirname, 'jobs');
const jobs = new Map();

function loadJobs() {
  for (const file of fs.readdirSync(jobsDir)) {
    if (!file.endsWith('.js')) continue;
    const job = require(path.join(jobsDir, file));
    if (!job.name || !job.cron || typeof job.run !== 'function') {
      logger.warn({ file }, 'scheduler: skipping malformed job');
      continue;
    }
    jobs.set(job.name, job);
  }
}

function listJobs() {
  return [...jobs.values()].map((j) => ({
    name: j.name,
    cron: j.cron,
    description: j.description || '',
  }));
}

async function runJob(name) {
  const job = jobs.get(name);
  if (!job) throw new Error(`unknown_job: ${name}`);
  const start = Date.now();
  try {
    const result = await job.run();
    const duration_ms = Date.now() - start;
    logger.info({ job: name, duration_ms, result }, 'scheduler: job completed');
    return { name, ok: true, duration_ms, result };
  } catch (err) {
    const duration_ms = Date.now() - start;
    logger.error({ job: name, duration_ms, err: err.message }, 'scheduler: job failed');
    return { name, ok: false, duration_ms, error: err.message };
  }
}

function startCron() {
  if (env.nodeEnv === 'development' && process.env.SCHEDULER_ENABLED !== 'true') {
    logger.info(
      'scheduler: cron registration skipped in dev (set SCHEDULER_ENABLED=true to enable)',
    );
    return [];
  }
  const tasks = [];
  for (const job of jobs.values()) {
    const t = cron.schedule(job.cron, () => runJob(job.name), {
      scheduled: true,
      timezone: 'Asia/Kolkata',
    });
    tasks.push({ name: job.name, task: t });
    logger.info({ job: job.name, cron: job.cron }, 'scheduler: registered');
  }
  return tasks;
}

loadJobs();

module.exports = { listJobs, runJob, startCron };
