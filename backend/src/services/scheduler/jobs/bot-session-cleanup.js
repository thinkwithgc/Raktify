/**
 * bot_session_cleanup — hourly. Drops bot_sessions rows past their TTL.
 */
const { withRlsContextRaw } = require('../../../middleware/rlsContext');

async function run() {
  return withRlsContextRaw(
    { actor_role: 'system', change_reason: 'bot_session_cleanup' },
    async (c) => {
      const r = await c.query(`DELETE FROM bot_sessions WHERE expires_at < NOW() RETURNING mobile`);
      return { dropped_count: r.rowCount };
    },
  );
}

module.exports = {
  run,
  name: 'bot_session_cleanup',
  cron: '15 * * * *',
  description: 'Drop expired bot_sessions',
};
