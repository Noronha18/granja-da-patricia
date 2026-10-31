import {execFileSync} from 'node:child_process';
import {randomUUID,randomBytes} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import assert from 'node:assert/strict';

// Explicit real-provider check. Only public provider-example coordinates, never customer data.
if(!process.argv.includes('--run'))throw Error('Use --run para teste externo autorizado.');
const ref=process.env.SUPABASE_PROJECT_REF,site=process.env.GRANJA_SITE_URL;
let admin,actor,route;let success=false;
try{
 const keys=JSON.parse(execFileSync('supabase',['projects','api-keys','--project-ref',ref,'-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
 const key=role=>{const value=keys.find(item=>item.name===role)?.api_key;const claims=JSON.parse(Buffer.from(value.split('.')[1],'base64url').toString());assert.equal(claims.ref,ref);assert.equal(claims.role,role);return value;};
 const options={auth:{persistSession:false,autoRefreshToken:false}};
 admin=createClient(`https://${ref}.supabase.co`,key('service_role'),options);
 const email=`maps-live-${randomUUID()}@example.test`,password=randomBytes(32).toString('base64url');
 const user=await admin.auth.admin.createUser({email,password,email_confirm:true});assert(!user.error&&user.data.user);actor=user.data.user.id;
 assert(!(await admin.from('profiles').insert({id:actor,role:'owner'})).error);
 const template=await admin.from('route_templates').select('id').limit(1).single();assert(!template.error);
 const run=await admin.from('route_runs').insert({template_id:template.data.id,service_date:'2099-12-31'}).select('id').single();assert(!run.error);route=run.data.id;
 assert(!(await admin.from('route_stops').insert([
  {route_id:route,kind:'departure',position:1,name:'Origem pública de teste',address:'50.679023,4.569876'},
  {route_id:route,kind:'arrival',position:2,name:'Destino público de teste',address:'50.66170,4.578667'}
 ])).error);
 const client=createClient(`https://${ref}.supabase.co`,key('anon'),options);
 const login=await client.auth.signInWithPassword({email,password});assert(!login.error&&login.data.session);
 const response=await fetch(`${site}/api/routes/${route}/distance`,{method:'POST',headers:{Authorization:`Bearer ${login.data.session.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({expectedVersion:1}),signal:AbortSignal.timeout(60000)});
 const result=await response.json();
 if(response.status!==200){const allowed=['MAPS_PROVIDER_ERROR','MAPS_ROUTE_RESPONSE_INVALID','MAPS_KEY_REJECTED','MAPS_PROVIDER_LIMIT','ADDRESS_UNCERTAIN','INCOMPLETE_ROUTE','MAPS_LIMIT','MAPS_NOT_CONFIGURED','MAPS_UNAVAILABLE'];console.log('Resultado do endpoint:',allowed.includes(result.error)?result.error:'falha não detalhada','etapa:',['authorization','context','provider','recheck'].includes(result.stage)?result.stage:'não informada');throw Error();}
 assert(Number.isFinite(result.distanceMetres)&&result.distanceMetres>0&&Number.isFinite(result.durationSeconds)&&result.durationSeconds>0);
 console.log(JSON.stringify({distanceMetres:result.distanceMetres,durationSeconds:result.durationSeconds,provider:result.provider}));
 assert(!(await client.auth.signOut()).error);success=true;
}catch{process.exitCode=1;console.error('Consulta real não confirmada; credenciais e respostas privadas omitidas.');}
finally{
 try{
  if(route){assert(!(await admin.from('route_stops').delete().eq('route_id',route)).error);assert(!(await admin.from('route_runs').delete().eq('id',route)).error);}
  if(actor)assert(!(await admin.auth.admin.deleteUser(actor)).error);
  console.log('Fixtures desta execução removidas. Acessos e dados preexistentes preservados.');
 }catch{success=false;process.exitCode=1;console.error('Limpeza não confirmada; conferir somente fixtures deste teste.');}
}
if(success)console.log('Geoapify real aprovado por chamada ao Worker publicado.');
