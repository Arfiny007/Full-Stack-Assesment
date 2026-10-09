import { transaction, type Db } from '../../shared/db/index.js';
import { normalize,canonical,type Event } from './schema.js';
import * as repo from './repository.js';
import { recordAttempt,type Context,type Outcome } from '../audit/repository.js';
export async function processEvents(items:unknown[],context:Context={transport:'REST'},existingDb?:Db):Promise<Outcome[]> {
  const run=async(db:Db)=>{
    const parsed=items.map(original=>{
      try { return {original,event:normalize(original),error:undefined}; }
      catch(error) { return {original,event:undefined,error:error instanceof Error?error.message:'Invalid event'}; }
    });
    await repo.lockSources(db,parsed.flatMap(p=>p.event?[p.event.source_id]:[]));
    const results:Outcome[]=[];
    for (const p of parsed) {
      let result:Outcome; let recordId:string|undefined;
      if (!p.event) {
        const raw=p.original && typeof p.original==='object'?p.original as Record<string,unknown>:{};
        result={event_id:typeof raw.event_id==='string'?raw.event_id:null,status:'REJECTED',message:p.error!};
      } else {
        const e=p.event; const prior=await repo.findEvent(db,e.source_id,e.event_id);
        if(prior) {
          recordId=prior.id;
          result={event_id:e.event_id,source_id:e.source_id,status:canonical(prior.normalized_payload)===canonical(e)?'DUPLICATE':'CONFLICT',message:canonical(prior.normalized_payload)===canonical(e)?'Identical event already stored':'Scoped event ID has different normalized data'};
        } else {
          let status:Outcome['status']='ACCEPTED'; let message='Event processed';
          let target:repo.RecordEvent|undefined;
          if(e.type==='VOID') {
            target=await repo.findEvent(db,e.source_id,e.target_event_id!);
            if(e.target_event_id===e.event_id) {status='REJECTED';message='VOID cannot reference itself';}
            else if(!target) {status='PENDING_REFERENCE';message='Waiting for target COUNT';}
            else if(target.type!=='COUNT' || target.status!=='ACCEPTED') {status='REJECTED';message='Target is not a completed COUNT';}
            else if(target.reversed_by) {status='REJECTED';message='COUNT already reversed';}
          }
          const stored=await repo.insertEvent(db,e,p.original,status,message); recordId=stored.id;
          if(e.type==='VOID' && status==='ACCEPTED') await repo.applyVoid(db,stored.id,target!.id);
          // Insertion also resolves references to IDs that turn out to be VOID records.
          const waiting=await repo.pendingVoids(db,e.source_id,e.event_id);
          for(let i=0;i<waiting.length;i++) {
            if(e.type==='COUNT' && i===0) await repo.applyVoid(db,waiting[i].id,stored.id);
            else await repo.rejectEvent(db,waiting[i].id,e.type==='COUNT'?'Competing VOID: earlier stored VOID won':'Target is a VOID, not COUNT');
          }
          result={event_id:e.event_id,source_id:e.source_id,status,message};
        }
      }
      await recordAttempt(db,p.original,p.event,result,context,recordId); results.push(result);
    }
    return results;
  };
  return existingDb?run(existingDb):transaction(run);
}
