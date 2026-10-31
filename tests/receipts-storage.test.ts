import { beforeAll,afterAll,it,expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import worker from '../src/server/worker';

const local=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}));
if(local.API_URL!=='http://127.0.0.1:56321')throw Error('Storage tests require isolated Granja');
const environment={SUPABASE_URL:local.API_URL,SUPABASE_ANON_KEY:local.ANON_KEY,SUPABASE_SERVICE_ROLE_KEY:local.SERVICE_ROLE_KEY};
const admin=createClient(local.API_URL,local.SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const payment=randomUUID(),customer=randomUUID(),attempt=randomUUID();
const actors:{id:string;token:string;role:string}[]=[];
const password='Somente-fixture-2026!';
const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAQUAAaX2RUAAAAAASUVORK5CYII=','base64'));
async function handle(request:Request){return worker.fetch(request,{...environment,ASSETS:{fetch:async()=>new Response('asset')}});}
const request=(suffix:string,token:string,method='GET',body?:BodyInit,mime='image/png',id=attempt)=>new Request(`http://app.test/api/${suffix}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':mime,'X-Request-Id':id},body});
beforeAll(async()=>{
 for(const role of ['owner','driver']){
  const email=`receipt-${role}-${randomUUID()}@example.test`;
  const created=await admin.auth.admin.createUser({email,password,email_confirm:true});if(created.error)throw created.error;
  const profile=await admin.from('profiles').insert({id:created.data.user.id,role});if(profile.error)throw profile.error;
  const user=createClient(local.API_URL,local.ANON_KEY,{auth:{persistSession:false}});const session=await user.auth.signInWithPassword({email,password});if(session.error)throw session.error;
  actors.push({id:created.data.user.id,token:session.data.session!.access_token,role});
 }
 const c=await admin.from('customers').insert({id:customer,name:'Comprovante fictício integração',address:'Rua fictícia',weekday:2,position:1});if(c.error)throw c.error;
 const p=await admin.from('payments').insert({id:payment,customer_id:customer,amount_cents:10000,received_at:new Date().toISOString(),method:'pix',actor_id:actors[0].id});if(p.error)throw p.error;
});
afterAll(async()=>{
 const rows=await admin.storage.from('payment-receipts').list(payment);if(rows.error)throw rows.error;
 if(rows.data.length){const removed=await admin.storage.from('payment-receipts').remove(rows.data.map(row=>`${payment}/${row.name}`));if(removed.error)throw removed.error;}
 for(const [table,column,id]of [['payment_receipts','payment_id',payment],['payments','id',payment],['customers','id',customer]]){const removed=await admin.from(table).delete().eq(column,id);if(removed.error)throw removed.error;}
 // This test does not invoke financial mutation RPCs or leave request_events.
 for(const actor of actors){const removed=await admin.auth.admin.deleteUser(actor.id);if(removed.error)throw removed.error;}
});
it('real Storage: authenticated server upload, replay, download and bypass denial',async()=>{
 const owner=actors[0],driver=actors[1];
 expect((await handle(request(`payments/${payment}/receipt`,driver.token,'POST',png))).status).toBe(403);
 expect((await handle(request(`payments/${randomUUID()}/receipt`,owner.token,'POST',png))).status).toBe(404);
 expect((await handle(request(`payments/${payment}/receipt`,owner.token,'POST','<html>spoof</html>'))).status).toBe(415);
 const upload=()=>request(`payments/${payment}/receipt`,owner.token,'POST',png);
 const first=await handle(upload());expect(await first.clone().json()).toEqual({receiptId:attempt});expect(first.status).toBe(201);
 expect((await handle(upload())).status).toBe(200);
 const list=await handle(request(`payments/${payment}/receipts`,owner.token));expect((await list.json()).receipts).toHaveLength(1);
 const download=await handle(request(`receipts/${attempt}/download`,owner.token));expect(download.status).toBe(200);
 const {url,expiresIn}=await download.json();expect(expiresIn).toBe(300);
 const bytes=await fetch(url);expect(bytes.status).toBe(200);expect(bytes.headers.get('Content-Disposition')).toMatch(/attachment/);expect(new Uint8Array(await bytes.arrayBuffer())).toEqual(png);
 const path=`${payment}/${attempt}.png`;
 const anon=createClient(local.API_URL,local.ANON_KEY,{auth:{persistSession:false}});
 expect((await anon.storage.from('payment-receipts').download(path)).error).not.toBeNull();
 const ownerClient=createClient(local.API_URL,local.ANON_KEY,{auth:{persistSession:false},global:{headers:{Authorization:`Bearer ${owner.token}`}}});
 expect((await ownerClient.storage.from('payment-receipts').upload(`${payment}/${randomUUID()}.png`,png,{contentType:'image/png'})).error).not.toBeNull();
 expect((await admin.storage.from('payment-receipts').upload(`${payment}/${randomUUID()}.html`,'<html/>',{contentType:'text/html'})).error).not.toBeNull();
 expect((await admin.storage.from('payment-receipts').upload(`${payment}/${randomUUID()}.png`,new Uint8Array(5000001),{contentType:'image/png'})).error).not.toBeNull();
 const saved=await admin.from('payments').select('amount_cents').eq('id',payment).single();expect(saved.data?.amount_cents).toBe(10000);
});
