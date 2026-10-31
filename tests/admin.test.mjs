import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
test('local administrator creates only explicit profiles and recovers access', async () => {
 const local = JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}));
 assert.equal(local.API_URL,'http://127.0.0.1:56321');
 const admin=createClient(local.API_URL,local.SERVICE_ROLE_KEY,{auth:{persistSession:false}});
 const email=`admin-test-${Date.now()}@example.test`;
 const password='Ficticio-temporario-2026!';
 const run=(args,password)=>spawnSync(process.execPath,['scripts/manage-local-user.mjs',...args],{encoding:'utf8',env:{...process.env,TEMPORARY_PASSWORD:password}});
 try {
  assert.equal(run(['create',email,'owner'],password).status,0,'administrative create command succeeds');
  const {data}=await admin.auth.admin.listUsers();
  const user=data.users.find(u=>u.email===email); assert.ok(user);
  const {data:profile}=await admin.from('profiles').select('role').eq('id',user.id).single();assert.equal(profile.role,'owner');
  const client=createClient(local.API_URL,local.ANON_KEY,{auth:{persistSession:false}});
  assert.equal((await client.auth.signInWithPassword({email,password})).error,null);
  const changed='Ficticio-recuperado-2026!';
  assert.equal(run(['recover',user.id],changed).status,0);
  assert.ok((await client.auth.signInWithPassword({email,password})).error);
  assert.equal((await client.auth.signInWithPassword({email,password:changed})).error,null);
  assert.notEqual(run(['create',email,'admin'],password).status,0,'arbitrary role refused');
 } finally {
  const {data}=await admin.auth.admin.listUsers();
  for(const user of data.users.filter(u=>u.email===email)) await admin.auth.admin.deleteUser(user.id);
 }
});
