import { it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomUUID, randomBytes, createHash, createCipheriv, createDecipheriv } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import worker from '../src/server/worker';

// Never propagate subprocess errors: SQL input may contain fixture password hashes.
function command(file:string,args:string[],input?:string,cwd?:string):string {
 try{return execFileSync(file,args,{input,cwd,encoding:'utf8',stdio:['pipe','pipe','pipe']});}
 catch{throw Error(`Recovery subprocess failed: ${file}`);}
}
const definitions=[{cwd:process.cwd(),url:'http://127.0.0.1:56321',project:'granja-da-patricia'},{cwd:'/tmp/granja-coldcheck-20261029',url:'http://127.0.0.1:57321',project:'granja-coldcheck-20261029'}];
function stack(def:typeof definitions[number]) {
 const status=JSON.parse(command('supabase',['status','-o','json'],undefined,def.cwd));
 if(status.API_URL!==def.url)throw Error('Recovery refused unexpected local API');
 const container=`supabase_db_${def.project}`;
 const name=command('podman',['inspect','--format','{{.Name}}',container]).trim();
 if(name!==container&&name!==`/${container}`)throw Error('Recovery refused unexpected container');
 const admin=createClient(def.url,status.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const sql=(query:string)=>command('podman',['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],query);
 const client=(token?:string)=>createClient(def.url,status.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false},...(token?{global:{headers:{Authorization:`Bearer ${token}`}}}:{})});
 const handle=(path:string,token?:string,method='GET',body?:Uint8Array,id?:string)=>worker.fetch(new Request(`http://fixture.test/api/${path}`,{method,headers:{...(token?{Authorization:`Bearer ${token}`} :{}),'Content-Type':'image/png',...(id?{'X-Request-Id':id}:{})},body:body ? new Uint8Array(body).buffer : undefined}),{SUPABASE_URL:def.url,SUPABASE_ANON_KEY:status.ANON_KEY,SUPABASE_SERVICE_ROLE_KEY:status.SERVICE_ROLE_KEY,ASSETS:{fetch:async()=>new Response('fixture')}});
 return {admin,sql,client,handle};
}
function ok<T extends {error:unknown}>(value:T):T {if(value.error)throw Error('Recovery API operation failed');return value;}
const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const schemaQuery="select coalesce(jsonb_agg(version order by version),'[]') from supabase_migrations.schema_migrations;";
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAQUAAaX2RUAAAAAASUVORK5CYII=','base64');

it('encrypted fixture archive restores Auth, financial replay and private receipt on a separate cold schema',async()=>{
 const source=stack(definitions[0]),target=stack(definitions[1]);
 const actors:{id:string;email:string;password:string;token:string;role:string}[]=[];
 const customer=randomUUID(),requestId=randomUUID(),receipt=randomUUID();
 let payment:string|undefined;
 const directory=mkdtempSync(join(tmpdir(),'granja-recovery-')),archive=join(directory,'fixtures.aesgcm');
 const key=randomBytes(32),iv=randomBytes(12);
 async function cleanup(s:ReturnType<typeof stack>){
  if(payment){ok(await s.admin.storage.from('payment-receipts').remove([`${payment}/${receipt}.png`]));s.sql(`delete from public.payment_receipts where id='${receipt}';delete from public.payments where id='${payment}';`);}
  s.sql(`delete from private.request_events where request_id='${requestId}';delete from public.customers where id='${customer}';`);
  for(const actor of actors)s.sql(`delete from auth.users where id='${actor.id}';`);
 }
 try {
  for(const role of ['owner','driver']){
   const email=`recovery-${role}-${randomUUID()}@example.test`,password=randomBytes(24).toString('base64url');
   const user=ok(await source.admin.auth.admin.createUser({email,password,email_confirm:true})).data.user!;
   actors.push({id:user.id,email,password,token:'',role});
   ok(await source.admin.from('profiles').insert({id:user.id,role}));
   actors.at(-1)!.token=ok(await source.client().auth.signInWithPassword({email,password})).data.session!.access_token;
  }
  ok(await source.admin.from('customers').insert({id:customer,name:'Recovery fixture',address:'Rua fictícia',weekday:2,position:1}));
  const payload={p_customer_id:customer,p_amount_cents:12345,p_received_at:new Date().toISOString(),p_method:'pix',p_request_id:requestId};
  const initial=ok(await source.client(actors[0].token).rpc('record_payment',payload)).data;
  payment=initial.paymentId;expect(initial.creditCents).toBe(12345);
  expect((await source.handle(`payments/${payment}/receipt`,actors[0].token,'POST',png,receipt)).status).toBe(201);
  const ids=actors.map(a=>`'${a.id}'`).join(',');
  const tables=[['auth.users',`id in (${ids})`],['auth.identities',`user_id in (${ids})`],['public.profiles',`id in (${ids})`],['public.customers',`id='${customer}'`],['public.payments',`id='${payment}'`],['public.payment_receipts',`id='${receipt}'`],['private.request_events',`request_id='${requestId}'`]];
  const rows=tables.map(([table,filter])=>({table,rows:JSON.parse(source.sql(`select coalesce(jsonb_agg(to_jsonb(t)),'[]') from ${table} t where ${filter};`))}));
  expect(rows.map(r=>r.rows.length)).toEqual([2,2,2,1,1,1,1]);
  const object=ok(await source.admin.storage.from('payment-receipts').download(`${payment}/${receipt}.png`)).data!;
  const bytes=Buffer.from(await object.arrayBuffer());expect(digest(bytes)).toBe(digest(png));
  const manifest={format:1,objects:1,sha256:digest(bytes),schema:source.sql(schemaQuery)};
  expect(JSON.parse(manifest.schema)).toHaveLength(9);
  const cipher=createCipheriv('aes-256-gcm',key,iv);
  const encrypted=Buffer.concat([cipher.update(Buffer.from(JSON.stringify({manifest,rows,object:bytes.toString('base64')}))),cipher.final()]);
  writeFileSync(archive,Buffer.concat([iv,encrypted,cipher.getAuthTag()]),{mode:0o600});
  expect(statSync(archive).mode&0o777).toBe(0o600);
  // Delete source fixtures before restore; no source row or object is used afterwards.
  await cleanup(source);
  const stored=readFileSync(archive),decipher=createDecipheriv('aes-256-gcm',key,stored.subarray(0,12));
  decipher.setAuthTag(stored.subarray(-16));
  const saved=JSON.parse(Buffer.concat([decipher.update(stored.subarray(12,-16)),decipher.final()]).toString());
  expect(saved.manifest.sha256).toBe(digest(Buffer.from(saved.object,'base64')));
  expect(target.sql(schemaQuery)).toBe(saved.manifest.schema);
  for(const entry of saved.rows){
   if(entry.table==='public.payment_receipts')for(const row of entry.rows)row.status='pending';
   // auth.identities.email is generated; restore only writable columns.
   const columns=target.sql(`select string_agg(quote_ident(column_name),',' order by ordinal_position) from information_schema.columns where table_schema='${entry.table.split('.')[0]}' and table_name='${entry.table.split('.')[1]}' and is_generated='NEVER';`).trim();
   const delimiter=`$fixture_${randomBytes(8).toString('hex')}$`;
   target.sql(`insert into ${entry.table} (${columns}) select ${columns} from jsonb_populate_recordset(null::${entry.table},${delimiter}${JSON.stringify(entry.rows)}${delimiter}::jsonb);`);
  }
  for(const actor of actors){
   const session=ok(await target.client().auth.signInWithPassword({email:actor.email,password:actor.password})).data;
   expect(session.user!.id).toBe(actor.id);actor.token=session.session!.access_token;
  }
  ok(await target.admin.storage.from('payment-receipts').upload(`${payment}/${receipt}.png`,Buffer.from(saved.object,'base64'),{contentType:'image/png'}));
  ok(await target.admin.rpc('complete_payment_receipt',{p_id:receipt}));
  expect(ok(await target.admin.from('payment_receipts').select('status').eq('id',receipt).single()).data!.status).toBe('ready');
  const download=await target.handle(`receipts/${receipt}/download`,actors[0].token);expect(download.status).toBe(200);
  const signed=await download.json(),restored=await fetch(signed.url);
  expect(restored.status).toBe(200);expect(restored.headers.get('Content-Disposition')).toMatch(/attachment/);
  expect(digest(new Uint8Array(await restored.arrayBuffer()))).toBe(saved.manifest.sha256);
  expect((await target.handle(`receipts/${receipt}/download`,actors[1].token)).status).toBe(403);
  expect((await target.handle(`receipts/${receipt}/download`)).status).toBe(401);
  for(const token of [undefined,actors[1].token]){
   expect((await target.client(token).storage.from('payment-receipts').download(`${payment}/${receipt}.png`)).error!==null).toBe(true);
   const metadata=await target.client(token).from('payment_receipts').select('id').eq('id',receipt);
   if(metadata.error)expect(metadata.error.code).toBe('42501');else expect(metadata.data).toHaveLength(0);
  }
  const replay=ok(await target.client(actors[0].token).rpc('record_payment',payload)).data;
  expect(replay.paymentId).toBe(payment);expect(replay.creditCents).toBe(12345);
  expect(ok(await target.admin.from('payments').select('id').eq('customer_id',customer)).data).toHaveLength(1);
  expect(ok(await target.client(actors[0].token).rpc('get_customer_account',{p_customer_id:customer})).data.creditCents).toBe(12345);
 } finally {
  const results=await Promise.allSettled([cleanup(source),cleanup(target)]);
  rmSync(directory,{recursive:true,force:true});key.fill(0);
  if(results.some(r=>r.status==='rejected'))throw Error('Recovery fixture cleanup failed');
 }
});
