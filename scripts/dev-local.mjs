import { execFileSync,spawnSync } from 'node:child_process';
// Runtime only: never print or persist local keys.
const local=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}));
if(local.API_URL!=='http://127.0.0.1:56321')throw Error('Local dev requires isolated Granja stack');
const child=spawnSync('npx',['vite','--host','127.0.0.1',...process.argv.slice(2)],{stdio:'inherit',env:{...process.env,VITE_SUPABASE_URL:local.API_URL,VITE_SUPABASE_ANON_KEY:local.ANON_KEY,SUPABASE_URL:local.API_URL,SUPABASE_ANON_KEY:local.ANON_KEY,SUPABASE_SERVICE_ROLE_KEY:local.SERVICE_ROLE_KEY}});
process.exit(child.status??1);
