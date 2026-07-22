/**
 * Request fulfilment helper — shared by the coordinator and hospital
 * transfusion-confirmation endpoints.
 *
 * A request is FULFILLED once every bag committed to it has been transfused and
 * the clinical need (units_required) is met. "Committed" spans the whole custody
 * chain (RE/IS/RV/TR); the durable link is reserved_for_request_id while reserved
 * and fulfilled_request_id from issue onward (migration 301), so both are
 * COALESCEd. Returned (AV) and written-off (WA/US) bags drop out of "committed",
 * so they neither block fulfilment nor count toward it.
 */
async function fulfilIfAllTransfused(client, requestId) {
  const row = (
    await client.query(
      `SELECT br.units_required,
              COUNT(bi.*) FILTER (WHERE bi.status IN ('RE','IS','RV','TR'))::int AS committed,
              COUNT(bi.*) FILTER (WHERE bi.status = 'TR')::int AS transfused
         FROM blood_requests br
         LEFT JOIN blood_inventory bi
           ON COALESCE(bi.reserved_for_request_id, bi.fulfilled_request_id) = br.id
        WHERE br.id = $1
        GROUP BY br.units_required`,
      [requestId],
    )
  ).rows[0];
  if (!row) return { fulfilled: false };

  const allTransfused =
    row.transfused > 0 && row.transfused >= row.units_required && row.transfused === row.committed;
  if (!allTransfused) return { fulfilled: false };

  const r = await client.query(
    `UPDATE blood_requests
        SET status = 'FU',
            fulfilled_at = COALESCE(fulfilled_at, clock_timestamp()),
            units_fulfilled = GREATEST(units_fulfilled, $2)
      WHERE id = $1 AND status IN ('OP','MT','AS','PF')
      RETURNING id`,
    [requestId, row.transfused],
  );
  return { fulfilled: r.rowCount > 0 };
}

module.exports = { fulfilIfAllTransfused };
