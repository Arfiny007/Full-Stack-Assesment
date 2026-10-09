import type { Db } from "../../shared/db/index.js";
import type { Event } from "./schema.js";
export type RecordEvent = Event & {
  id: string;
  status: "ACCEPTED" | "PENDING_REFERENCE" | "REJECTED";
  reversed_by: string | null;
  acked_at: string | null;
  failure_reason: string | null;
  normalized_payload: Event;
};
export async function lockSources(db: Db, sources: string[]) {
  for (const source of [...new Set(sources)].sort()) {
    await db.query(
      "INSERT INTO production_sources(source_id) VALUES($1) ON CONFLICT DO NOTHING",
      [source],
    );
    await db.query(
      "SELECT source_id FROM production_sources WHERE source_id=$1 FOR UPDATE",
      [source],
    );
  }
}
export async function findEvent(
  db: Db,
  source: string,
  id: string,
): Promise<RecordEvent | undefined> {
  return (
    await db.query(
      "SELECT * FROM production_events WHERE source_id=$1 AND event_id=$2",
      [source, id],
    )
  ).rows[0];
}
export async function insertEvent(
  db: Db,
  e: Event,
  original: unknown,
  status: string,
  message: string,
): Promise<RecordEvent> {
  return (
    await db.query(
      `INSERT INTO production_events(source_id,event_id,type,quantity,target_event_id,event_time,original_payload,normalized_payload,status,failure_reason)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        e.source_id,
        e.event_id,
        e.type,
        e.quantity,
        e.target_event_id,
        e.event_time,
        JSON.stringify(original),
        JSON.stringify(e),
        status,
        status === "REJECTED" ? message : null,
      ],
    )
  ).rows[0];
}
export async function applyVoid(db: Db, voidId: string, countId: string) {
  await db.query(
    `UPDATE production_events SET status='ACCEPTED',failure_reason=NULL,applied_target_id=$2,acked_at=clock_timestamp(),acked_by='factory-auto' WHERE id=$1`,
    [voidId, countId],
  );
  await db.query("UPDATE production_events SET reversed_by=$2 WHERE id=$1", [
    countId,
    voidId,
  ]);
}
export async function rejectEvent(db: Db, id: string, message: string) {
  await db.query(
    "UPDATE production_events SET status='REJECTED',failure_reason=$2 WHERE id=$1",
    [id, message],
  );
}
export async function pendingVoids(
  db: Db,
  source: string,
  eventId: string,
): Promise<RecordEvent[]> {
  return (
    await db.query(
      "SELECT * FROM production_events WHERE source_id=$1 AND target_event_id=$2 AND status='PENDING_REFERENCE' ORDER BY id",
      [source, eventId],
    )
  ).rows;
}
