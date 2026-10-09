import express from 'express';
import path from 'node:path';
import { z } from 'zod';
import { processEvents } from './modules/events/service.js';
import { acknowledge } from './modules/ack/service.js';
import * as state from './modules/state/repository.js';
import { mqttMetadata } from './modules/mqtt/worker.js';
export const app=express();
app.disable('x-powered-by');
app.use(express.json({limit:'1mb',strict:false}));
const route=(fn:(req:express.Request,res:express.Response)=>Promise<unknown>):express.RequestHandler=>(req,res,next)=>{fn(req,res).catch(next);};
app.post('/api/events',route(async(req,res)=>{
  if(!Array.isArray(req.body) && (!req.body || typeof req.body!=='object')) return res.status(400).json({error:'Expected an event object or event array'});
  res.json({results:await processEvents(Array.isArray(req.body)?req.body:[req.body])});
}));
app.get('/api/state',route(async(req,res)=>{
  const query=z.object({view:z.enum(['summary','pending','exceptions']).default('summary'),source_id:z.string().trim().min(1).optional()}).safeParse(req.query);
  if(!query.success) return res.status(400).json({error:query.error.flatten()});
  const {view,source_id}=query.data;
  const mqtt=await mqttMetadata();
  if(view==='summary') res.json({summary:await state.summary(source_id),mqtt});
  else res.json({[view]:await state[view](source_id),mqtt});
}));
app.post('/api/ack',route(async(req,res)=>{
  const parsed=z.object({event_ids:z.array(z.string().trim().min(1)).max(1000),source_id:z.string().trim().min(1).optional()}).safeParse(req.body);
  if(!parsed.success) return res.status(400).json({error:parsed.error.flatten()});
  res.json({results:await acknowledge(parsed.data.event_ids,parsed.data.source_id)});
}));
app.use('/api',(_req,res)=>{res.status(404).json({error:'Unknown API route'});});
app.use(express.static(path.resolve('frontend/dist')));
app.get('*',(_req,res)=>res.sendFile(path.resolve('frontend/dist/index.html')));
app.use((error:Error & {status?:number;type?:string},_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
  if(error.type==='entity.parse.failed') return res.status(400).json({error:'Malformed JSON'});
  if(error.status===413) return res.status(413).json({error:'JSON body exceeds 1 MB'});
  console.error(error); res.status(500).json({error:'Internal server error; transaction rolled back'});
});
