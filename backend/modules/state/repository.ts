import { pool, type Db } from "../../shared/db/index.js";
export async function summary(source?: string, db?: Db) {
  const conn = db ?? pool;
  const { rows } = await conn.query(
    `SELECT
    COALESCE((SELECT SUM(quantity)::bigint FROM production_events WHERE type='COUNT' AND status='ACCEPTED' AND reversed_by IS NULL AND ($1::text IS NULL OR source_id=$1)),0)::text AS net_total,
    (SELECT COUNT(*) FROM production_events WHERE status='ACCEPTED' AND ($1::text IS NULL OR source_id=$1))::text AS processed_events,
    (SELECT COUNT(*) FROM production_events WHERE status='ACCEPTED' AND acked_at IS NULL AND ($1::text IS NULL OR source_id=$1))::text AS pending_ack,
    (SELECT COUNT(*) FROM production_events WHERE status='PENDING_REFERENCE' AND ($1::text IS NULL OR source_id=$1))::text AS unresolved,
    (SELECT COUNT(*) FROM submission_attempts WHERE status='DUPLICATE' AND ($1::text IS NULL OR source_id=$1))::text AS duplicates,
    (SELECT COUNT(*) FROM submission_attempts WHERE status='CONFLICT' AND ($1::text IS NULL OR source_id=$1))::text AS conflicts`,
    [source ?? null],
  );
  return Object.fromEntries(
    Object.entries(rows[0]).map(([k, v]) => [k, Number(v)]),
  ) as Record<
    | "net_total"
    | "processed_events"
    | "pending_ack"
    | "unresolved"
    | "duplicates"
    | "conflicts",
    number
  >;
}
export async function pending(source?: string) {
  return (
    await pool.query(
      `SELECT source_id,event_id,type,quantity,target_event_id,status,event_time,received_at,acked_at,reversed_by FROM production_events
    WHERE status='ACCEPTED' AND acked_at IS NULL AND ($1::text IS NULL OR source_id=$1) ORDER BY id`,
      [source ?? null],
    )
  ).rows;
}
export async function exceptions(source?: string) {
  return (
    await pool.query(
      `SELECT source_id,event_id,type,status,message,received_at,kind FROM (
    SELECT source_id,event_id,type,status,COALESCE(failure_reason,'Waiting for target COUNT: '||target_event_id) AS message,received_at,'event' AS kind,id FROM production_events WHERE status IN ('PENDING_REFERENCE','REJECTED')
    UNION ALL SELECT source_id,event_id,original_payload->>'type' AS type,status,message,received_at,'attempt' AS kind,id FROM submission_attempts WHERE status IN ('REJECTED','CONFLICT')
    ) entries WHERE ($1::text IS NULL OR source_id=$1) ORDER BY received_at DESC,id DESC`,
      [source ?? null],
    )
  ).rows;
}
