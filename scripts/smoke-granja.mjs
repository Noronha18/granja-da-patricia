import {execFileSync} from 'node:child_process';
import {randomUUID,randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';

// Opt-in only: creates and removes two fictitious access accounts, no business events.
if (!process.argv.includes('--run')) throw Error('Use --run somente para o smoke check autorizado da Granja.');
const ref=process.env.SUPABASE_PROJECT_REF,url=`https://${ref}.supabase.co`;
const site=process.env.GRANJA_SITE_URL;
let admin;
const actors=[];
let failed=false;
try {
  const keys=JSON.parse(execFileSync('supabase',['projects','api-keys','--project-ref',ref,'-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
  function key(role){const value=keys.find(key=>key.name===role)?.api_key;const claims=JSON.parse(Buffer.from(value.split('.')[1],'base64url').toString());assert.equal(claims.ref,ref);assert.equal(claims.role,role);return value;}
  const anon=key('anon');
  const options={auth:{persistSession:false,autoRefreshToken:false}};
  admin=createClient(url,key('service_role'),options);
  const settings=await fetch(`${url}/auth/v1/settings`,{headers:{apikey:anon}});
  assert.equal(settings.status,200);
  assert.equal((await settings.json()).disable_signup,true);
  const home=await fetch(site);assert.equal(home.status,200);assert((await home.text()).includes('/assets/'));
  assert.equal((await fetch(`${site}/api/receipts/orphans`)).status,401);
  for(const role of ['owner','driver']){
    const email=`release-${randomUUID()}@example.test`,password=randomBytes(32).toString('base64url');
    const created=await admin.auth.admin.createUser({email,password,email_confirm:true});
    assert(!created.error&&created.data.user);
    const id=created.data.user.id;actors.push(id);
    assert(!(await admin.from('profiles').insert({id,role})).error);
    const client=createClient(url,anon,options);
    const login=await client.auth.signInWithPassword({email,password});assert(!login.error&&login.data.session);
    const profile=await client.from('profiles').select('role').single();assert.equal(profile.data?.role,role);
    const response=await fetch(`${site}/api/receipts/orphans`,{headers:{Authorization:`Bearer ${login.data.session.access_token}`}});
    assert.equal(response.status,role==='owner'?200:403);
    if(role==='owner')assert.deepEqual((await response.json()).paths,[]);
    const maps=await fetch(`${site}/api/routes/00000000-0000-4000-8000-000000000001/distance`,{method:'POST',headers:{Authorization:`Bearer ${login.data.session.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({expectedVersion:1})});
    if(role==='driver')assert.equal(maps.status,403);
    else{assert([409,503].includes(maps.status));assert(['MAPS_NOT_CONFIGURED','VERSION_CONFLICT'].includes((await maps.json()).error));}
    assert(!(await client.auth.signOut()).error);
  }
}catch{failed=true;}
finally{
  for(const id of actors){try{if((await admin.auth.admin.deleteUser(id)).error)failed=true;}catch{failed=true;}}
}
if(failed){console.error('Smoke check reprovado; nenhuma credencial ou saída de API foi exibida. Confira contagens antes de repetir.');process.exitCode=1;}
else console.log('Smoke remoto aprovado: página 200, cadastro público bloqueado, login/perfis reais, comprovantes dona 200/motorista 403/anônimo 401; contas fictícias removidas.');
