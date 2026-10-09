import { z } from 'zod';
const id=z.string().trim().min(1).max(200);
const common={source_id:id,event_id:id,event_time:z.string().datetime({offset:true}).refine(v=>Number.isFinite(Date.parse(v)),'Invalid timestamp')};
export const eventSchema=z.discriminatedUnion('type',[
  z.object({...common,type:z.literal('COUNT'),quantity:z.number().int().positive().max(2147483647),target_event_id:z.null().optional()}),
  z.object({...common,type:z.literal('VOID'),quantity:z.null().optional(),target_event_id:id})
]);
export type Event = {source_id:string;event_id:string;type:'COUNT'|'VOID';quantity:number|null;target_event_id:string|null;event_time:string};
export function normalize(input:unknown):Event {
  const e=eventSchema.parse(input);
  return {...e,quantity:e.quantity??null,target_event_id:e.target_event_id??null,event_time:new Date(e.event_time).toISOString()};
}
export function canonical(value:unknown):string {
  if (value===null || typeof value!=='object') return JSON.stringify(value);
  if (Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical((value as Record<string,unknown>)[k])).join(',')+'}';
}
