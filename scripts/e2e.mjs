import { execFileSync, spawnSync } from 'node:child_process';
// Only the isolated local CLI status is read. Never load a linked project's credentials.
const config = execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8' });
const local = JSON.parse(config);
if (local.API_URL !== 'http://127.0.0.1:56321') throw Error('E2E requires the isolated Granja local stack');
const result = spawnSync('npx', ['playwright', 'test', ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, VITE_SUPABASE_URL: local.API_URL, VITE_SUPABASE_ANON_KEY: local.ANON_KEY, TEST_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY, SUPABASE_URL:local.API_URL, SUPABASE_ANON_KEY:local.ANON_KEY, SUPABASE_SERVICE_ROLE_KEY:local.SERVICE_ROLE_KEY } });
process.exit(result.status ?? 1);
