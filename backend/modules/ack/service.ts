import { transaction } from '../../shared/db/index.js';
import { findForAck,markAck } from './repository.js';
export async function acknowledge(ids:string[],source?:string) {
  return transaction(async db=>{
    const results=[];
    // Lock all requested event rows in deterministic ID order to avoid cross-batch deadlocks.
    for(const id of [...new Set(ids)].sort()) await findForAck(db,id,source);
    for(const event_id of ids) {
      const rows=await findForAck(db,event_id,source); let status:string; let message:string;
      if(!rows.length) {status='NOT_FOUND';message='Event not found';}
      else if(rows.length>1) {status='NOT_READY';message='Ambiguous event ID; supply source_id';}
      else if(rows[0].status!=='ACCEPTED') {status='NOT_READY';message='Event is unresolved or rejected';}
      else if(rows[0].acked_at) {status='ALREADY_ACKED';message='Already acknowledged';}
      else {await markAck(db,rows[0].id);status='ACKED';message='Acknowledged';}
      results.push({event_id,status,message});
    }
    return results;
  });
}
