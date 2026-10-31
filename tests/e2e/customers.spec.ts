import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { promisify } from 'node:util';
const execute=promisify(execFile);
const admin = createClient(process.env.VITE_SUPABASE_URL!, process.env.TEST_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const password = 'Cliente-ficticio-teste-2026!';
const email = `customers-${Date.now()}@example.test`;
let userId = '';
const customerIds: string[] = [];
const customerNames: string[] = [];
test.beforeAll(async () => {
 const {data,error}=await admin.auth.admin.createUser({email,password,email_confirm:true});
 if(error||!data.user) throw error??Error('No test user'); userId=data.user.id;
 const profile=await admin.from('profiles').insert({id:userId,role:'owner'});if(profile.error) throw profile.error;
});
test.afterAll(async () => {
 const failures:unknown[]=[];
 for(const id of customerIds) {const {error}=await admin.from('customers').delete().eq('id',id);if(error) failures.push(error);}
 if(customerNames.length) {const {error}=await admin.from('customers').delete().in('name',customerNames);if(error) failures.push(error);}
 const product=await admin.from('products').delete().eq('eggs_per_tray',42).eq('name','Produto fictício de teste');if(product.error) failures.push(product.error);
 if(userId) {
  if(!/^[a-f0-9-]{36}$/.test(userId)) throw Error('Invalid fixture id');
  try {execFileSync('podman',['exec','supabase_db_granja-da-patricia','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',`delete from private.request_events where actor_id='${userId}'`],{stdio:'ignore'});}catch(error){failures.push(error);}
  const {error}=await admin.auth.admin.deleteUser(userId);if(error) failures.push(error);
 }
 if(failures.length) throw new AggregateError(failures,'Customer fixture cleanup failed');
});

async function enter(page: Page) {
 await page.goto('/clientes');await page.getByLabel('E-mail').fill(email);await page.getByLabel('Senha',{exact:true}).fill(password);await page.getByRole('button',{name:'Entrar',exact:true}).click();
 if((page.viewportSize()?.width??1280)<=720){await expect(page.getByRole('button',{name:'Mais',exact:true})).toBeVisible();await page.getByRole('button',{name:'Mais',exact:true}).click();}
 await expect(page.getByRole('link',{name:'Clientes',exact:true})).toBeVisible();await page.getByRole('link',{name:'Clientes',exact:true}).click();
}
async function fillCustomer(page: Page, name: string) {
 customerNames.push(name);
 await page.getByRole('button',{name:'Novo cliente',exact:true}).click();
 await page.getByLabel('Nome do cliente',{exact:true}).fill(name);
 await page.getByRole('textbox',{name:/^Endereço/}).fill('Rua fictícia, 10');
 await page.getByLabel('Telefone',{exact:true}).fill('81999990000');
 await page.getByRole('combobox',{name:/^Dia da rota/}).selectOption('4');
 await page.getByLabel('Posição na rota',{exact:true}).fill('2');
 await page.getByLabel('Bandejas — Bandeja de 30',{exact:true}).fill('6');
 await page.getByLabel('Preço combinado — Bandeja de 30 (R$)',{exact:true}).fill('30,00');
}
async function remember(name: string) {
 const {data,error}=await admin.from('customers').select('id').eq('name',name).single();if(error) throw error;customerIds.push(data.id);
}

test('nome repetido fica em conferência sem indicar várias entregas semanais',async({page})=>{
 const name=`Cliente fictício dois dias ${Date.now()}`;
 const group={key:'fixture-two-days',days:[2,4],rows:[7,14]};
 const result=await admin.from('customers').insert([2,4].map((day,i)=>({name,address:`Rua fictícia ${i+1}`,weekday:day,position:i+1,active:false,review_pending:true,source_details:{row:i?14:7,deliveryGroup:group}}))).select('id');
 if(result.error)throw result.error;customerIds.push(...result.data.map(r=>r.id));
 await enter(page);await page.getByLabel('Buscar cliente',{exact:true}).fill(name);
 await expect(page.locator('.customer-list').getByText('Entregas deste cliente: Terça-feira, Quinta-feira',{exact:true})).toHaveCount(0);
 await expect(page.locator('.customer-list').getByRole('paragraph').filter({hasText:/^Em conferência$/})).toHaveCount(2);
 await expect(page.locator('.customer-list').getByText('Rua fictícia 1',{exact:true})).toBeVisible();
 await expect(page.locator('.customer-list').getByText('Rua fictícia 2',{exact:true})).toBeVisible();
});

test('cadastro importado pendente mostra origem e preserva observações sem exigir dia',async({page})=>{
 const name=`Importado fictício ${Date.now()}`;
 const source={row:7,cells:{C:'X',N:'SEGUNDA',L:'1',M:'',K:'Entregar na portaria'},reviewReasons:['Conferir dia']};
 const created=await admin.from('customers').insert({name,address:'Rua fictícia, 7',active:false,weekday:null,position:7,notes:'Entregar na portaria <script>literal</script>',review_pending:true,source_details:source}).select('id').single();
 if(created.error)throw created.error;customerIds.push(created.data.id);
 await page.setViewportSize({width:390,height:844});await enter(page);
 await page.getByLabel('Buscar cliente',{exact:true}).fill(name);
 await page.getByLabel('Filtrar por atividade',{exact:true}).selectOption('review');
 await expect(page.getByText('1 clientes cadastrados',{exact:true})).toBeVisible();
 await expect(page.locator('.customer-list').getByRole('paragraph').filter({hasText:/^Em conferência$/})).toBeVisible();
 await expect(page.getByText('Dia a conferir · posição 7 · Inativo',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:`Editar ${name}`,exact:true}).click();
 await expect(page.getByLabel('Observações do cadastro',{exact:true})).toHaveValue('Entregar na portaria <script>literal</script>');
 await expect(page.getByLabel('Dia da rota',{exact:true})).toHaveValue('');
 await expect(page.getByLabel('Cliente ativo',{exact:true})).toBeDisabled();
 await page.getByText('Dados preservados da planilha',{exact:true}).click();
 await expect(page.getByText('Linha original: 7',{exact:true})).toBeVisible();
 await expect(page.getByText('Dia na planilha: SEGUNDA',{exact:true})).toBeVisible();
 await page.getByLabel('Observações do cadastro',{exact:true}).fill('Observação corrigida sem inventar dia');
 await page.getByRole('button',{name:'Salvar cliente',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('Cliente salvo');
 const saved=await admin.from('customers').select('notes,weekday,active,source_details,review_pending').eq('id',created.data.id).single();if(saved.error)throw saved.error;
 expect(saved.data).toEqual({notes:'Observação corrigida sem inventar dia',weekday:null,active:false,source_details:source,review_pending:true});
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);expect(overflow).toBe(false);
});
test('cadastro mobile, vários itens, preço BRL, edição e inativação', async ({page}) => {
 await page.setViewportSize({width:360,height:800});await enter(page);
 const name=`Cliente fictício ${Date.now()}`;await fillCustomer(page,name);
 await page.getByLabel('Bandejas — Bandeja de 15',{exact:true}).fill('1');
 await expect(page.getByText('195 ovos · R$ 197,00',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Salvar cliente',exact:true}).click();await expect(page.getByRole('status')).toContainText('Cliente salvo');await remember(name);
 await page.getByRole('button',{name:`Editar ${name}`,exact:true}).click();
 await expect(page.getByLabel('Preço combinado — Bandeja de 30 (R$)',{exact:true})).toHaveValue('30,00');
 await page.getByLabel('Cliente ativo',{exact:true}).uncheck();await page.getByRole('textbox',{name:/^Endereço/}).fill('Rua alterada');
 await page.getByRole('button',{name:'Salvar cliente',exact:true}).click();await expect(page.getByRole('status')).toContainText('Cliente salvo');
 await page.getByRole('button',{name:`Editar ${name}`,exact:true}).click();await expect(page.getByLabel('Cliente ativo')).not.toBeChecked();await expect(page.getByRole('textbox',{name:/^Endereço/})).toHaveValue('Rua alterada');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await expect(page.getByLabel('Nome do cliente',{exact:true})).toBeEnabled();await page.getByLabel('Nome do cliente',{exact:true}).focus();await page.keyboard.press('Tab');await expect(page.getByRole('textbox',{name:/^Endereço/})).toBeFocused();
 await page.screenshot({path:'/tmp/granja-customers-mobile.png',fullPage:true});
});
test('texto HTML não executa e conflito mantém rascunho até recarregar', async ({page,context}) => {
 await page.setViewportSize({width:1440,height:1000});await enter(page);const name=`<img src=x onerror=alert(1)> ${Date.now()}`;
 await fillCustomer(page,name);await page.getByRole('button',{name:'Salvar cliente',exact:true}).click();await expect(page.getByRole('status')).toContainText('Cliente salvo');await remember(name);
 await page.getByRole('button',{name:`Editar ${name}`,exact:true}).click();
 const other=await context.newPage();await other.goto('/clientes');await other.getByRole('button',{name:`Editar ${name}`,exact:true}).click();
 await other.getByRole('textbox',{name:/^Endereço/}).fill('Endereço salvo na outra aba');await other.getByRole('button',{name:'Salvar cliente',exact:true}).click();await expect(other.getByRole('status')).toContainText('Cliente salvo');
 await page.getByRole('textbox',{name:/^Endereço/}).fill('Meu rascunho');await page.getByRole('button',{name:'Salvar cliente',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('alterado em outra sessão');await expect(page.getByRole('textbox',{name:/^Endereço/})).toHaveValue('Meu rascunho');
 await page.getByRole('button',{name:'Recarregar cadastro',exact:true}).click();await expect(page.getByRole('textbox',{name:/^Endereço/})).toHaveValue('Endereço salvo na outra aba');
 await expect(page.locator('img')).toHaveCount(0);
 await page.screenshot({path:'/tmp/granja-customers-desktop.png',fullPage:true});await other.close();
});
test('catálogo cadastra produto e preço padrão com vírgula', async ({page}) => {
 await enter(page);await page.getByRole('button',{name:'Cadastrar produto',exact:true}).click();
 await page.getByLabel('Nome do produto',{exact:true}).fill('Produto fictício de teste');await page.getByLabel('Ovos por bandeja',{exact:true}).fill('42');await page.getByLabel('Preço padrão (R$)',{exact:true}).fill('45,50');
 await page.getByRole('button',{name:'Salvar produto',exact:true}).click();await expect(page.getByRole('status')).toContainText('Produto salvo');
 const {data}=await admin.from('products').select('id,default_price_cents').eq('eggs_per_tray',42).single();expect(data?.default_price_cents).toBe(4550);
});

test('envio bloqueia edição durante resposta atrasada', async ({page}) => {
 await enter(page);const name=`Envio lento ${Date.now()}`;await fillCustomer(page,name);
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 let saved!:()=>void;const reached=new Promise<void>(resolve=>{saved=resolve;});
 await page.route('**/rest/v1/rpc/save_customer',async route=>{const response=await route.fetch();saved();await gate;await route.fulfill({response});});
 await page.getByRole('button',{name:'Salvar cliente',exact:true}).click();await reached;await remember(name);
 try {await expect(page.getByLabel('Nome do cliente',{exact:true})).toBeDisabled();await expect(page.getByRole('textbox',{name:/^Endereço/})).toBeDisabled();}
 finally {release();}
 await expect(page.getByRole('status')).toContainText('Cliente salvo');
});
test('falha de atualização não desfaz confirmação de salvamento',async ({page})=>{
 await enter(page);const name=`Consulta falha ${Date.now()}`;await fillCustomer(page,name);
 await page.getByRole('button',{name:'Salvar cliente',exact:true}).click();await expect(page.getByRole('status')).toContainText('Cliente salvo');await remember(name);
 await page.route(url=>url.pathname==='/rest/v1/customers',route=>route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({message:'Consulta indisponível',code:'TEST_QUERY_FAILURE'})}));
 await page.getByRole('textbox',{name:/^Endereço/}).fill('Endereço salvo apesar da falha de consulta');
 await page.getByRole('button',{name:'Salvar cliente',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('Cliente salvo');
 await expect(page.getByRole('alert')).toContainText('atualizar a lista');
 await expect(page.getByRole('alert')).not.toContainText('confirmar o envio');
 const {data,error}=await admin.from('customers').select('address,version').eq('name',name).single();if(error) throw error;
 expect(data).toEqual({address:'Endereço salvo apesar da falha de consulta',version:2});
});
test('timeout consulta tentativa antes de novo cadastro e recarga recupera envio', async ({page}) => {
 await enter(page);const name=`Resposta perdida ${Date.now()}`;await fillCustomer(page,name);
 await page.route('**/rest/v1/rpc/save_customer',async route=>{await route.fetch();await route.abort('failed');});
 await page.getByRole('button',{name:'Salvar cliente',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();await remember(name);
 const pending=await page.evaluate(()=>sessionStorage.getItem('granja:customer-request'));expect(pending).toMatch(/^[a-f0-9-]{36}$/);
 await page.unroute('**/rest/v1/rpc/save_customer');
 await page.getByRole('button',{name:'Novo cliente',exact:true}).click();
 await expect(page.getByLabel('Nome do cliente',{exact:true})).toHaveValue(name);
 await expect(page.getByRole('status')).toContainText('recuperado');
 expect(await page.evaluate(()=>sessionStorage.getItem('granja:customer-request'))).toBeNull();
 await fillCustomer(page,`${name} segundo`);await page.getByRole('button',{name:'Salvar cliente',exact:true}).click();await expect(page.getByRole('status')).toContainText('Cliente salvo');await remember(`${name} segundo`);
 await page.getByRole('textbox',{name:/^Endereço/}).fill('Recuperado após recarga');
 await page.route('**/rest/v1/rpc/save_customer',async route=>{await route.fetch();await route.abort('failed');});
 await page.getByRole('button',{name:'Salvar cliente',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();
 await page.unroute('**/rest/v1/rpc/save_customer');await page.reload();
 await expect(page.getByRole('status')).toContainText('recuperado');await expect(page.getByRole('textbox',{name:/^Endereço/})).toHaveValue('Recuperado após recarga');
 expect(await page.evaluate(()=>sessionStorage.getItem('granja:customer-request'))).toBeNull();
});
test('filtros consultam dia e atividade com paginação no servidor e resumo do pedido',async ({page})=>{
 const prefix=`Filtros ${Date.now()}`;
 const fixtures=Array.from({length:51},(_,i)=>({name:`${prefix} ${String(i).padStart(2,'0')}`,address:'Rua fictícia',active:true,weekday:4,position:i+1}));
 const {data,error}=await admin.from('customers').insert([...fixtures,{...fixtures[0],name:`${prefix} inativo`,active:false},{...fixtures[0],name:`${prefix} sexta`,weekday:5}]).select('id');if(error) throw error;customerIds.push(...data.map(row=>row.id));
 const {data:product,error:productError}=await admin.from('products').select('id').eq('eggs_per_tray',30).single();if(productError) throw productError;
 const item=await admin.from('standing_order_items').insert({customer_id:data[0].id,product_id:product.id,trays:2});if(item.error) throw item.error;
 await enter(page);await page.getByLabel('Buscar cliente',{exact:true}).fill(prefix);
 await page.getByLabel('Filtrar por dia',{exact:true}).selectOption('4');await page.getByLabel('Filtrar por atividade',{exact:true}).selectOption('active');
 await expect(page.getByText('51 clientes cadastrados',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:`Editar ${prefix} inativo`,exact:true})).toHaveCount(0);
 await expect(page.getByText('2 bandejas de 30 · 60 ovos',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Próxima',exact:true}).click();await expect(page.getByText('Página 2 de 2',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:`Editar ${prefix} 50`,exact:true})).toBeVisible();
 await page.getByLabel('Filtrar por atividade',{exact:true}).selectOption('inactive');await expect(page.getByText('1 clientes cadastrados',{exact:true})).toBeVisible();await expect(page.getByText('Página 1 de 1',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:`Editar ${prefix} inativo`,exact:true})).toBeVisible();
});

test('revalidação real da sessão preserva rascunho ao retornar à aba',async ({page})=>{
 await enter(page);const name=`Rascunho de sessão ${Date.now()}`;await fillCustomer(page,name);
 // Native visibility event reaches Supabase's real recovery path; no auth response is mocked.
 let revalidated!:()=>void;const checked=new Promise<void>(resolve=>{revalidated=resolve;});
 page.on('response',response=>{if(response.url().includes('/auth/v1/user')) revalidated();});
 await page.evaluate(()=>{
  Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});window.dispatchEvent(new Event('visibilitychange'));
  Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});window.dispatchEvent(new Event('visibilitychange'));
 });
 await checked;
 await expect(page.getByLabel('Nome do cliente',{exact:true})).toHaveValue(name);
 await expect(page.getByRole('textbox',{name:/^Endereço/})).toHaveValue('Rua fictícia, 10');
});

async function sql(statement:string) {
 const result=await execute('podman',['exec','supabase_db_granja-da-patricia','psql','-X','-A','-t','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',statement]);return result.stdout.trim();
}
async function holdTransaction(statement:string) {
 const child=spawn('podman',['exec','-i','supabase_db_granja-da-patricia','psql','-X','-A','-t','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});
 let output='',errors='';child.stdout.on('data',data=>{output+=data;});child.stderr.on('data',data=>{errors+=data;});
 const ended=new Promise<void>((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(errors||`SQL exited ${code}`)));});
 child.stdin.write(`begin; select set_config('request.jwt.claim.sub','${userId}',true); set local role authenticated; ${statement};\n\\echo TRANSACTION_READY\n`);
 try {await expect.poll(()=>output,{timeout:10000}).toContain('TRANSACTION_READY');}
 catch(error){child.stdin.end('rollback;\n');await ended;throw error;}
 return async()=>{child.stdin.end('commit;\n');await ended;};
}
test('reconciliação serializa duas conexões e bloqueia save tardio após encerramento',async()=>{
 const owner=createClient(process.env.VITE_SUPABASE_URL!,process.env.VITE_SUPABASE_ANON_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
 const login=await owner.auth.signInWithPassword({email,password});if(login.error) throw login.error;
 const details={name:`Concorrência ${Date.now()}`,address:'Rua fictícia',active:true,weekday:4,position:1};customerNames.push(details.name);
 const firstRequest=crypto.randomUUID(),firstCustomer=crypto.randomUUID();customerIds.push(firstCustomer);
 const write={p_customer_id:firstCustomer,p_expected_version:0,p_details:details,p_items:[],p_prices:[],p_request_id:firstRequest};
 let release=await holdTransaction(`select public.save_customer('${firstCustomer}',0,'${JSON.stringify(details)}','[]','[]','${firstRequest}')`);
 let reconciled=false;const reconciliation=owner.rpc('reconcile_customer_request',{p_request_id:firstRequest}).retry(false).then(result=>{reconciled=true;return result;});
 try {await expect.poll(()=>sql("select count(*) from pg_stat_activity where wait_event='transactionid' and query like '%reconcile_customer_request%'"),{timeout:10000}).toBe('1');expect(reconciled).toBe(false);}
 finally {await release();}
 const result=await reconciliation;if(result.error) throw result.error;expect(result.data).toEqual({status:'saved',result:{id:firstCustomer,version:1}});
 const closedRequest=crypto.randomUUID(),lateCustomer=crypto.randomUUID();customerIds.push(lateCustomer);
 release=await holdTransaction(`select public.reconcile_customer_request('${closedRequest}')`);
 let finished=false;const lateSave=owner.rpc('save_customer',{...write,p_customer_id:lateCustomer,p_request_id:closedRequest}).retry(false).then(result=>{finished=true;return result;});
 try {await expect.poll(()=>sql("select count(*) from pg_stat_activity where wait_event='transactionid' and query like '%save_customer%'"),{timeout:10000}).toBe('1');expect(finished).toBe(false);}
 finally {await release();}
 const rejected=await lateSave;expect(rejected.error?.code).toBe('55000');expect(rejected.error?.message).toBe('REQUEST_CLOSED');
 const absent=await admin.from('customers').select('id').eq('id',lateCustomer);if(absent.error) throw absent.error;expect(absent.data).toEqual([]);
 await owner.auth.signOut();
});

test('tentativa sem resposta preserva ID até reconciliação e recarga encerra envio ausente',async ({page})=>{
 await enter(page);const name=`Envio ausente ${Date.now()}`;await fillCustomer(page,name);
 await page.route('**/rest/v1/rpc/save_customer',route=>route.abort('failed'));
 await page.getByRole('button',{name:'Salvar cliente',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();
 const pending=await page.evaluate(()=>sessionStorage.getItem('granja:customer-request'));expect(pending).toMatch(/^[a-f0-9-]{36}$/);
 await page.route('**/rest/v1/rpc/reconcile_customer_request',route=>route.abort('failed'));
 await page.getByRole('button',{name:'Novo cliente',exact:true}).click();await expect(page.getByRole('alert')).toContainText('verificar');
 expect(await page.evaluate(()=>sessionStorage.getItem('granja:customer-request'))).toBe(pending);await expect(page.getByLabel('Nome do cliente',{exact:true})).toHaveValue(name);
 await page.unroute('**/rest/v1/rpc/reconcile_customer_request');await page.unroute('**/rest/v1/rpc/save_customer');await page.reload();
 await expect(page.getByRole('status')).toContainText('encerrada sem salvar');expect(await page.evaluate(()=>sessionStorage.getItem('granja:customer-request'))).toBeNull();
 await fillCustomer(page,`${name} confirmado`);await page.getByRole('button',{name:'Salvar cliente',exact:true}).click();await expect(page.getByRole('status')).toContainText('Cliente salvo');await remember(`${name} confirmado`);
});
