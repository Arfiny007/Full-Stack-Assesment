import { beforeAll,beforeEach,afterAll,describe,it,expect } from 'vitest';
import request from 'supertest';
import { app } from '../backend/app.js';
import { pool,transaction } from '../backend/shared/db/index.js';
import { migrate } from '../backend/shared/db/migrate.js';
import { processEvents } from '../backend/modules/events/service.js';
import { handleChallenge } from '../backend/modules/mqtt/service.js';
import { summary } from '../backend/modules/state/repository.js';
const count=(id='C1',quantity=12,source='line-a')=>({source_id:source,event_id:id,type:'COUNT',quantity,event_time:'2026-10-09T08:00:00+06:00'});
const voidEvent=(id='V1',target='C1',source='line-a')=>({source_id:source,event_id:id,type:'VOID',target_event_id:target,event_time:'2026-10-09T08:01:00+06:00'});
const challenge=(id='CH1',events:unknown[]=[count()])=>({protocol_version:'1.0',candidate_id:'integration-only',challenge_id:id,command:'PROCESS_EVENTS',expires_at:'2099-01-01T00:00:00Z',events});
beforeAll(migrate);
beforeEach(async()=>{await pool.query('TRUNCATE production_events,production_sources,submission_attempts,mqtt_challenges,mqtt_challenge_history RESTART IDENTITY CASCADE');});
afterAll(()=>pool.end());
describe('PostgreSQL REST and shared business service',()=>{
  it('new COUNT increases real database total and exposes exactly six indicators',async()=>{
    const response=await request(app).post('/api/events').send(count()).expect(200);
    expect(response.body.results[0].status).toBe('ACCEPTED');
    const state=(await request(app).get('/api/state').expect(200)).body;
    expect(state.summary).toEqual({net_total:12,processed_events:1,pending_ack:1,unresolved:0,duplicates:0,conflicts:0});
    expect(state.mqtt.enabled).toBe(false);
  });
  it('identical COUNT with reordered keys/optional nulls/timezone never double counts',async()=>{
    await processEvents([count()]);
    const results=await processEvents([{event_time:'2026-10-09T02:00:00Z',quantity:12,type:'COUNT',event_id:'C1',source_id:'line-a',target_event_id:null}]);
    expect(results[0].status).toBe('DUPLICATE');expect((await summary()).net_total).toBe(12);expect((await summary()).duplicates).toBe(1);
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM submission_attempts')).rows[0].n).toBe(2);
  });
  it('VOID before COUNT resolves automatically; VOID auto ACK and COUNT pending supervisor',async()=>{
    expect((await processEvents([voidEvent()]))[0].status).toBe('PENDING_REFERENCE');expect((await summary()).unresolved).toBe(1);
    await processEvents([count()]);
    expect(await summary()).toMatchObject({net_total:0,processed_events:2,pending_ack:1,unresolved:0});
    const result=await request(app).post('/api/ack').send({event_ids:['V1']}).expect(200);expect(result.body.results[0].status).toBe('ALREADY_ACKED');
  });
  it('repeated ACK including repeated IDs is durable and idempotent',async()=>{
    await processEvents([count()]);
    const first=await request(app).post('/api/ack').send({event_ids:['C1','C1','missing']}).expect(200);
    expect(first.body.results.map((r:any)=>r.status)).toEqual(['ACKED','ALREADY_ACKED','NOT_FOUND']);
    expect((await request(app).post('/api/ack').send({event_ids:['C1']})).body.results[0].status).toBe('ALREADY_ACKED');
    expect((await summary()).pending_ack).toBe(0);await processEvents([voidEvent()]);expect((await summary()).net_total).toBe(0);
  });
  it('replayed MQTT challenge returns persisted ORIGINAL response and no repeated attempts',async()=>{
    const body=challenge();const first=await handleChallenge(body,'integration-only');
    await processEvents([count('other',5)]);
    const repeated=await handleChallenge({...body,events:[{...count()}]},'integration-only');
    expect(repeated).toEqual(first);expect(repeated.status).toBe('COMPLETED');expect(repeated.state).toMatchObject({net_total:12});
    expect((await summary()).net_total).toBe(17);expect((await summary()).duplicates).toBe(0);
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM submission_attempts')).rows[0].n).toBe(2);
  });
  it('mixed invalid batch commits valid siblings in order and audits invalid records',async()=>{
    const res=await request(app).post('/api/events').send([count(),{...count('bad'),quantity:-1},null,voidEvent()]).expect(200);
    expect(res.body.results.map((r:any)=>r.status)).toEqual(['ACCEPTED','REJECTED','REJECTED','ACCEPTED']);expect((await summary()).net_total).toBe(0);
    expect((await request(app).get('/api/state?view=exceptions')).body.exceptions).toHaveLength(2);
    await request(app).post('/api/events').send('42').set('Content-Type','application/json').expect(400);
    await request(app).post('/api/events').send('{oops').set('Content-Type','application/json').expect(400);
  });
  it('changed payload conflicts and original data remains',async()=>{
    await processEvents([count()]);expect((await processEvents([count('C1',99)]))[0].status).toBe('CONFLICT');
    expect(await summary()).toMatchObject({net_total:12,conflicts:1});
  });
  it('earliest competing pending VOID wins and later VOID is rejected',async()=>{
    await processEvents([voidEvent('V1'),voidEvent('V2')]);await processEvents([count()]);
    const rows=(await pool.query("SELECT event_id,status,acked_at FROM production_events WHERE type='VOID' ORDER BY id")).rows;
    expect(rows.map(r=>r.status)).toEqual(['ACCEPTED','REJECTED']);expect(rows[0].acked_at).toBeTruthy();
    expect((await processEvents([voidEvent('V3')]))[0].status).toBe('REJECTED');expect((await summary()).net_total).toBe(0);
    expect((await request(app).post('/api/ack').send({event_ids:['V2']})).body.results[0].status).toBe('NOT_READY');
  });
  it('composite IDs allow different sources; ambiguous ACK refuses to choose',async()=>{
    await processEvents([count('C1',12,'a'),count('C1',7,'b'),voidEvent('VB','C1','b')]);
    expect((await summary('a')).net_total).toBe(12);expect((await summary('b')).net_total).toBe(0);
    expect((await request(app).post('/api/ack').send({event_ids:['C1']})).body.results[0].status).toBe('NOT_READY');
    expect((await request(app).post('/api/ack').send({event_ids:['C1'],source_id:'a'})).body.results[0].status).toBe('ACKED');
  });
  it('concurrent duplicates and reversals apply one effect only',async()=>{
    const results=await Promise.all(Array.from({length:8},()=>processEvents([count()])));
    expect(results.filter(r=>r[0].status==='ACCEPTED')).toHaveLength(1);expect((await summary()).net_total).toBe(12);
    const reversals=await Promise.all(Array.from({length:6},(_,i)=>processEvents([voidEvent('V'+i)])));
    expect(reversals.filter(r=>r[0].status==='ACCEPTED')).toHaveLength(1);expect((await summary()).net_total).toBe(0);
  });
  it('concurrent MQTT replay serializes on challenge and rejects changed body',async()=>{
    const responses=await Promise.all(Array.from({length:5},()=>handleChallenge(challenge(),'integration-only')));
    expect(responses.every(r=>JSON.stringify(r)===JSON.stringify(responses[0]))).toBe(true);
    const conflict=await handleChallenge(challenge('CH1',[count('C1',99)]),'integration-only');expect(conflict.error_code).toBe('CHALLENGE_CONFLICT');
    expect((await summary()).duplicates).toBe(0);expect((await summary()).net_total).toBe(12);
  });
  it('challenge validation failures are durable and individual invalid events still COMPLETE',async()=>{
    expect((await handleChallenge({...challenge(),protocol_version:'2.0'},'integration-only')).error_code).toBe('UNSUPPORTED_PROTOCOL');
    expect((await handleChallenge({...challenge('CH2'),candidate_id:'wrong'},'integration-only')).error_code).toBe('CANDIDATE_MISMATCH');
    expect((await handleChallenge({...challenge('CH3'),expires_at:'2000-01-01T00:00:00Z'},'integration-only')).error_code).toBe('CHALLENGE_EXPIRED');
    expect((await handleChallenge({...challenge('CH4'),events:'wrong'},'integration-only')).error_code).toBe('VALIDATION_ERROR');
    const mixed=await handleChallenge(challenge('CH5',[count(),{bad:true}]),'integration-only');expect(mixed.status).toBe('COMPLETED');expect((mixed.results as any[])[1].status).toBe('REJECTED');
  });
  it('unexpected enclosing transaction failure rolls back event and audit together',async()=>{
    await expect(transaction(async db=>{await processEvents([count()],{transport:'REST'},db);throw new Error('Injected failure');})).rejects.toThrow('Injected failure');
    expect((await summary()).processed_events).toBe(0);expect((await pool.query('SELECT COUNT(*)::int AS n FROM submission_attempts')).rows[0].n).toBe(0);
  });
  it('invalid source-less attempts are excluded from source filters',async()=>{
    await processEvents([{event_id:'bad'}, {...count('bad-a'),quantity:0}]);
    expect((await request(app).get('/api/state?view=exceptions')).body.exceptions).toHaveLength(2);
    expect((await request(app).get('/api/state?view=exceptions&source_id=line-a')).body.exceptions).toHaveLength(1);
  });
  it('missing references cannot ACK and references to VOID are rejected on arrival',async()=>{
    await processEvents([voidEvent('V1','V2')]);
    expect((await request(app).post('/api/ack').send({event_ids:['V1']})).body.results[0].status).toBe('NOT_READY');
    await processEvents([voidEvent('V2','C1')]);
    expect((await pool.query("SELECT status FROM production_events WHERE event_id='V1'")).rows[0].status).toBe('REJECTED');
  });
});
