import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createClient} from '@supabase/supabase-js';

// Password arrives through a hidden terminal prompt and stdin, never an argument.
const [email,role]=process.argv.slice(2);
const ref=process.env.SUPABASE_PROJECT_REF,url=`https://${ref}.supabase.co`;
let admin,createdId,complete=false;
try {
  if(!email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!['owner','driver'].includes(role))throw Error();
  const password=readFileSync(0,'utf8');
  if(password.length<12){console.error('Use uma senha com pelo menos 12 caracteres. Nenhum acesso foi criado.');process.exit(1);}
  if(readFileSync('supabase/.temp/project-ref','utf8').trim()!==ref)throw Error();
  const keys=JSON.parse(execFileSync('supabase',['projects','api-keys','--project-ref',ref,'-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
  function key(role){const value=keys.find(key=>key.name===role)?.api_key;const claims=JSON.parse(Buffer.from(value.split('.')[1],'base64url').toString());if(claims.ref!==ref||claims.role!==role)throw Error();return value;}
  const options={auth:{persistSession:false,autoRefreshToken:false}};
  admin=createClient(url,key('service_role'),options);
  const result=await admin.auth.admin.createUser({email,password,email_confirm:true});
  if(result.error||!result.data.user)throw Error();
  createdId=result.data.user.id;
  if((await admin.from('profiles').insert({id:createdId,role})).error)throw Error();
  const client=createClient(url,key('anon'),options);
  const login=await client.auth.signInWithPassword({email,password});
  if(login.error||login.data.user?.id!==createdId)throw Error();
  const profile=await client.from('profiles').select('role').single();
  if(profile.error||profile.data?.role!==role)throw Error();
  await client.auth.signOut();
  complete=true;
  console.log('Acesso criado no projeto exclusivo da Granja. Login e perfil verificados.');
}catch{
  console.error('Não foi possível concluir o acesso. Credenciais e respostas privadas não foram exibidas. Contas preexistentes não são alteradas.');
  process.exitCode=1;
}finally{
  if(createdId&&!complete){
    try{if((await admin.auth.admin.deleteUser(createdId)).error)throw Error();console.error('Somente a conta recém-criada incompleta foi removida.');}
    catch{console.error('Verifique o último acesso criado no painel: limpeza não confirmada.');}
  }
}
