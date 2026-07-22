/**
 * issued_receipt_timeout — half-hourly.
 *
 * The leg between "blood bank issued the unit" (IS) and "requestor confirmed
 * receipt" (RV) is where a unit can go missing in transit. This job finds bags
 * stuck in IS past a receipt window and raises an IN-APP alert in the case
 * thread (message_type 'SY'), so the coordinator sees it on the dashboard they
 * keep open — deliberately NOT a WhatsApp nudge, which would be noise when many
 * cases are live (founder preference).
 *
 * Windows: CRITICAL requests > 6h, everything else > 24h. One alert per request
 * per 12h (dedupe on a stable phrase) so the thread isn't spammed each tick.
 */
const { withRlsContextRaw } = require('../../../middleware/rlsContext');

const OVERDUE_PHRASE = 'not been confirmed received';

async function run() {
  return withRlsContextRaw(
    { actor_role: 'system', change_reason: 'issued_receipt_timeout' },
    async (c) => {
      const candidates = await c.query(
        `SELECT br.id AS request_id,
                br.urgency_tier,
                COUNT(*)::int AS overdue_units,
                MIN(bi.issued_at) AS oldest_issue
           FROM blood_inventory bi
           JOIN blood_requests br ON br.id = bi.fulfilled_request_id
          WHERE bi.status = 'IS'
            AND bi.issued_at < CASE br.urgency_tier
                                 WHEN 'CR' THEN NOW() - INTERVAL '6 hours'
                                 ELSE NOW() - INTERVAL '24 hours'
                               END
            AND NOT EXISTS (
                  SELECT 1 FROM request_threads rt
                   WHERE rt.request_id = br.id
                     AND rt.message_type = 'SY'
                     AND rt.message_text LIKE $1
                     AND rt.posted_at > NOW() - INTERVAL '12 hours')
          GROUP BY br.id, br.urgency_tier`,
        [`%${OVERDUE_PHRASE}%`],
      );

      let flagged = 0;
      for (const row of candidates.rows) {
        const hrs = Math.max(
          1,
          Math.round((Date.now() - new Date(row.oldest_issue).getTime()) / 3_600_000),
        );
        const text =
          `⚠ ${row.overdue_units} unit(s) issued ~${hrs}h ago have ${OVERDUE_PHRASE}. ` +
          `Coordinator: please verify delivery with the requestor and confirm receipt.`;
        await c.query(
          `INSERT INTO request_threads
             (request_id, message_type, message_text, author_role, author_user_id)
           VALUES ($1, 'SY', $2, 'system', NULL)`,
          [row.request_id, text],
        );
        flagged += 1;
      }
      return { flagged_requests: flagged, candidates_examined: candidates.rowCount };
    },
  );
}

module.exports = {
  run,
  name: 'issued_receipt_timeout',
  cron: '30 * * * *',
  description: 'Flag issued bags overdue for receipt confirmation in the case thread',
};
