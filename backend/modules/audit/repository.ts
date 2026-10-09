import type { Db } from '../../shared/db/index.js';
import type { Event } from '../events/schema.js';
export type Outcome={event_id:string|null;source_id?:string;status:'ACCEPTED'|'DUPLICATE'|'CONFLICT'|'PENDING_REFERENCE'|'REJECTED';message:string};
export type Context={transport:'REST'|'MQTT';challenge_id?:string};
export async function recordAttempt(db:Db,original:unknown,normalized:Event|undefined,result:Outcome,context:Context,recordId?:string) {
  const raw=original && typeof original==='object' ? original as Record<string,unknown> : {};
  const source=typeof raw.source_id==='string' && raw.source_id.trim() ? raw.source_id.trim() : null;
  await db.query(`INSERT INTO submission_attempts(source_id,event_id,production_event_id,transport,challenge_id,original_payload,normalized_payload,status,message)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[normalized?.source_id??source,result.event_id,recordId??null,context.transport,context.challenge_id??null,JSON.stringify(original??null),normalized?JSON.stringify(normalized):null,result.status,result.message]);
}
