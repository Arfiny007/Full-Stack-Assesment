import type { Db } from '../../shared/db/index.js';
export async function findForAck(db:Db,id:string,source?:string) {
  return (await db.query(`SELECT id,source_id,status,acked_at FROM production_events WHERE event_id=$1 AND ($2::text IS NULL OR source_id=$2) ORDER BY source_id FOR UPDATE`,[id,source??null])).rows;
}
export async function markAck(db:Db,id:string) {
  await db.query("UPDATE production_events SET acked_at=clock_timestamp(),acked_by='supervisor-api' WHERE id=$1",[id]);
}
