import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const ref = process.env.SUPABASE_PROJECT_REF;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const url = `https://${ref}.supabase.co`;
function keyFor(keys, role) {
  const key = keys.find(key => key.name === role)?.api_key;
  if (typeof key !== 'string') throw Error('Chave esperada indisponível.');
  let claims;
  try { claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()); }
  catch { throw Error('Formato de chave inesperado.'); }
  if (claims.ref !== ref || claims.role !== role) throw Error('Chave de projeto ou perfil diferente.');
  return key;
}
if (process.argv.includes('--self-test')) {
  const fake = (project, role) => `test.${Buffer.from(JSON.stringify({ref:project,role})).toString('base64url')}.test`;
  assert.equal(keyFor([{name:'anon',api_key:fake(ref,'anon')}],'anon'), fake(ref,'anon'));
  for (const keys of [[], [{name:'anon',api_key:'invalid'}], [{name:'anon',api_key:fake('other','anon')}], [{name:'anon',api_key:fake(ref,'service_role')}]] ) {
    assert.throws(() => keyFor(keys, 'anon'));
  }
  console.log('Proteções de projeto/perfil aprovadas.');
  process.exit(0);
}
function run(file, args, options = {}) {
  try { return execFileSync(file, args, {encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:4*1024*1024,...options}); }
  // Never propagate subprocess output: it may contain credentials or user data.
  catch { throw Error(`Etapa falhou: ${file} ${args[0]}. Saída retida por segurança.`); }
}
function files(directory) {
  return readdirSync(directory, {withFileTypes:true}).flatMap(entry => entry.isDirectory() ? files(join(directory,entry.name)) : [join(directory,entry.name)]);
}
function workerWithSecrets(args, options) {
  // Node uses a socket for child stdin; /dev/stdin cannot reopen that socket.
  // Python supplies an OS pipe, keeping the JSON only in memory.
  return run('python3', ['-c', 'import subprocess,sys; r=subprocess.run(sys.argv[1:],input=sys.stdin.buffer.read(),capture_output=True); sys.stdout.buffer.write(r.stdout); sys.stderr.buffer.write(r.stderr); sys.exit(r.returncode)', 'node_modules/.bin/wrangler', ...args], options);
}
let stage = 'conferência de destino';
try {
  const config = JSON.parse(readFileSync('wrangler.jsonc','utf8'));
  assert.equal(config.name,'granja-da-patricia');
  assert.equal(config.account_id,account);
  assert.equal(readFileSync('supabase/.temp/project-ref','utf8').trim(),ref);
  const projects = JSON.parse(run('supabase',['projects','list','-o','json']));
  assert(projects.some(project => project.id === ref && project.name === 'granja_da_patricia' && project.status === 'ACTIVE_HEALTHY'));
  const wrangler = 'node_modules/.bin/wrangler';
  stage = 'autenticação Cloudflare';
  assert(run(wrangler,['whoami']).includes(account));
  stage = 'obtenção das chaves autorizadas';
  const keys = JSON.parse(run('supabase',['projects','api-keys','--project-ref',ref,'-o','json']));
  stage = 'validação do projeto e perfil das chaves';
  const anon = keyFor(keys,'anon'), service = keyFor(keys,'service_role');
  const env = {...process.env,VITE_SUPABASE_URL:url,VITE_SUPABASE_ANON_KEY:anon,WRANGLER_SEND_METRICS:'false'};
  delete env.SUPABASE_SERVICE_ROLE_KEY;
  stage = 'build';
  run('npm',['run','check'],{env});
  stage = 'teste do adaptador no runtime Workers';
  run('node',['scripts/test-maps-runtime.mjs'],{env});
  stage = 'proteção do bundle';
  for (const file of files('dist')) assert(!readFileSync(file).includes(Buffer.from(service)), 'Chave administrativa no bundle. Publicação bloqueada.');
  const input = JSON.stringify({SUPABASE_URL:url,SUPABASE_ANON_KEY:anon,SUPABASE_SERVICE_ROLE_KEY:service});
  stage = 'simulação do Worker';
  workerWithSecrets(['deploy','--dry-run','--secrets-file','/dev/stdin'],{input,env});
  console.log('Build, destino, ausência de chave administrativa no frontend e dry-run aprovados.');
  if (process.argv.includes('--publish')) {
    stage = 'publicação do Worker';
    const output = workerWithSecrets(['deploy','--secrets-file','/dev/stdin'],{input,env});
    const address = output.match(/https:\/\/granja-da-patricia\.[a-z0-9-]+\.workers\.dev/);
    console.log('Worker publicado.', address?.[0] ?? 'Confira URL no painel Cloudflare.');
  } else console.log('Nenhuma publicação executada. Use --publish somente com autorização.');
} catch (error) {
  console.error(`Publicação interrompida na etapa: ${stage}. Saídas de subprocessos e credenciais não foram exibidas.`);
  process.exitCode = 1;
}
