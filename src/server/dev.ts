import { Readable } from 'node:stream';
import type { Plugin } from 'vite';
import { handleReceiptRequest } from './receipts';
import { createReceiptStore } from './receiptStore';
import {createMapsStore,handleMapsRequest} from './maps';

// Same handler in local Vite and Workers. No second server or dependency.
export function receiptApiPlugin():Plugin{return {
 name:'private-receipt-api',
 configureServer(server){server.middlewares.use(async(incoming,outgoing,next)=>{
  if(!incoming.url?.startsWith('/api/'))return next();
  const {SUPABASE_URL,SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY}=process.env;
  if(!SUPABASE_URL||!SUPABASE_ANON_KEY||!SUPABASE_SERVICE_ROLE_KEY){outgoing.statusCode=503;outgoing.end('{"error":"SERVER_NOT_CONFIGURED"}');return;}
  try{
   const headers=new Headers();for(const [key,value]of Object.entries(incoming.headers)){if(typeof value==='string')headers.set(key,value);else if(value)headers.set(key,value.join(','));}
   const request=new Request(new URL(incoming.url,'http://127.0.0.1:5173'),{method:incoming.method,headers,...(incoming.method==='GET'||incoming.method==='HEAD'?{}:{body:Readable.toWeb(incoming) as ReadableStream<Uint8Array>,duplex:'half'})} as RequestInit);
   const env={SUPABASE_URL,SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY};
   const response=incoming.url.startsWith('/api/routes/')?await handleMapsRequest(request,createMapsStore(env),process.env.GEOAPIFY_API_KEY):await handleReceiptRequest(request,createReceiptStore(env));
   outgoing.statusCode=response.status;response.headers.forEach((value,key)=>outgoing.setHeader(key,value));
   outgoing.end(Buffer.from(await response.arrayBuffer()));
  }catch{outgoing.statusCode=503;outgoing.end('{"error":"RECEIPT_SERVICE_UNAVAILABLE"}');}
 });}
};}
