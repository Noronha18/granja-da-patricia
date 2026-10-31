import {test,expect,type Page}from '@playwright/test';
import {createClient}from '@supabase/supabase-js';
import {execFileSync}from 'node:child_process';
const admin=createClient(process.env.VITE_SUPABASE_URL!,process.env.TEST_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
const owner=createClient(process.env.VITE_SUPABASE_URL!,process.env.VITE_SUPABASE_ANON_KEY!,{auth:{persistSession:false}});
const suffix=crypto.randomUUID(),source=`csv-teste-${suffix}`,email=`settings-${suffix}@example.test`,driverEmail=`driver-settings-${suffix}@example.test`,password='Configuracao-ficticia-2026!';
const ids:string[]=[],vehicles:string[]=[];const localName=`Base fictícia ${suffix.slice(0,8)}`;
let original:any;
test.beforeAll(async()=>{
 for(const[address,role]of [[email,'owner'],[driverEmail,'driver']]as const){const result=await admin.auth.admin.createUser({email:address,password,email_confirm:true});if(result.error||!result.data.user)throw result.error??Error('No fixture user');ids.push(result.data.user.id);const profile=await admin.from('profiles').insert({id:result.data.user.id,role});if(profile.error)throw profile.error;}
 const login=await owner.auth.signInWithPassword({email,password});if(login.error)throw login.error;const settings=await owner.rpc('get_operational_settings');if(settings.error)throw settings.error;original=settings.data;
});
test.afterAll(async()=>{
 const errors:unknown[]=[];
 if(original){const current=await owner.rpc('get_operational_settings');if(current.error)errors.push(current.error);else{const restored=await owner.rpc('save_operational_settings',{p_expected_version:(current.data as any).version,p_settings:original,p_request_id:crypto.randomUUID()});if(restored.error)errors.push(restored.error);}}
 const mappings=await admin.from('customer_sources').select('customer_id').eq('source',source);if(mappings.error)errors.push(mappings.error);else if(mappings.data.length){const deleted=await admin.from('customers').delete().in('id',mappings.data.map(row=>row.customer_id));if(deleted.error)errors.push(deleted.error);}
 for(const result of [await admin.from('customer_import_batches').delete().eq('actor_id',ids[0]),await admin.from('operational_locations').delete().eq('name',localName)])if(result.error)errors.push(result.error);
 for(const id of vehicles)if(id!==original?.vehicle?.id){const result=await admin.from('vehicles').delete().eq('id',id);if(result.error)errors.push(result.error);}
 for(const id of ids){try{execFileSync('podman',['exec','supabase_db_granja-da-patricia','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',`delete from private.request_events where actor_id='${id}'`],{stdio:'ignore'});}catch(error){errors.push(error);}const deleted=await admin.auth.admin.deleteUser(id);if(deleted.error)errors.push(deleted.error);}
 await owner.auth.signOut();if(errors.length)throw new AggregateError(errors,'Settings/import fixture cleanup failed');
});
async function enter(page:Page,address=email){await page.goto('/login');await page.getByLabel('E-mail').fill(address);await page.getByLabel('Senha',{exact:true}).fill(password);await page.getByRole('button',{name:'Entrar',exact:true}).click();await expect(page.getByRole('button',{name:'Sair',exact:true})).toBeVisible();}
test('configura locais pendentes, veículo e motorista sem sobrescrever versão concorrente',async({page,context})=>{
 await page.setViewportSize({width:360,height:800});await enter(page);await page.getByRole('button',{name:'Mais',exact:true}).click();await page.getByRole('link',{name:'Configurações',exact:true}).click();
 await page.getByLabel('Nome do veículo',{exact:true}).fill('Veículo fictício da configuração');await page.getByLabel('Motorista padrão',{exact:true}).selectOption(ids[1]);
 await page.getByRole('button',{name:'Adicionar local',exact:true}).click();await page.getByLabel('Nome do local 1',{exact:true}).fill(localName);await page.getByLabel('Endereço do local 1',{exact:true}).fill('Endereço parcial fictício');await page.getByLabel('Origem — Segunda-feira',{exact:true}).selectOption({label:localName});
 await page.getByRole('button',{name:'Salvar configurações',exact:true}).click();await expect(page.getByRole('status')).toContainText('Configurações salvas');
 const settings=await owner.rpc('get_operational_settings');if(settings.error)throw settings.error;vehicles.push((settings.data as any).vehicle.id);
 expect((settings.data as any).locations.find((location:any)=>location.name===localName).confirmed).toBe(false);await expect(page.getByLabel('Destino — Terça-feira',{exact:true})).toHaveValue('');await expect(page.getByText('Consulte distância e duração na preparação das entregas. O cálculo depende da chave gratuita e de endereços completos.',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'/tmp/granja-settings-mobile.png',fullPage:true});
 const other=await context.newPage();await other.goto('/configuracoes');await other.getByLabel('Nome do veículo',{exact:true}).fill('Veículo salvo em outra aba');await other.getByRole('button',{name:'Salvar configurações',exact:true}).click();await expect(other.getByRole('status')).toContainText('Configurações salvas');
 await page.getByLabel('Nome do veículo',{exact:true}).fill('Meu rascunho do veículo');await page.getByRole('button',{name:'Salvar configurações',exact:true}).click();await expect(page.getByRole('alert')).toContainText('outra sessão');await expect(page.getByLabel('Nome do veículo',{exact:true})).toHaveValue('Meu rascunho do veículo');await page.getByRole('button',{name:'Recarregar configurações',exact:true}).click();await expect(page.getByLabel('Nome do veículo',{exact:true})).toHaveValue('Veículo salvo em outra aba');await other.close();
});
const csv=['source_id,name,phone,address,weekday,position,eggs_per_tray,trays','a,Cliente CSV fictício,81999990000,"Rua fictícia, 10",4,1,15,1','a,Cliente CSV fictício,81999990000,"Rua fictícia, 10",4,1,30,2','b,Outro CSV fictício,81999990000,Rua B fictícia,4,2,20,1','c,Grupo bloqueado,81999990000,Rua C fictícia,4,3,15,1','c,Grupo bloqueado,81999990000,Rua C fictícia,4,3,18,1'].join('\n');
async function preview(page:Page){await page.getByLabel('Fonte dos identificadores',{exact:true}).fill(source);await page.getByLabel('Arquivo CSV',{exact:true}).setInputFiles({name:'clientes-ficticios.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});await page.getByRole('button',{name:'Conferir arquivo',exact:true}).click();await expect(page.getByText('2 clientes aprovados para conferência.',{exact:true})).toBeVisible();await page.getByLabel('Conferi os clientes e autorizo somente os grupos aprovados.',{exact:true}).check();}
test('prévia CSV exclui grupo inválido, confirma multi-produto e recupera resposta perdida',async({page})=>{
 await enter(page);await page.goto('/importar-clientes');await expect(page.getByText('A planilha real ainda não foi analisada.',{exact:true})).toBeVisible();await preview(page);
 const before=await admin.from('customer_sources').select('customer_id').eq('source',source);expect(before.data).toEqual([]);await expect(page.getByText('Use 15, 20 ou 30',{exact:false})).toBeVisible();
 await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'/tmp/granja-import-desktop.png',fullPage:true});
 await page.getByRole('button',{name:'Confirmar importação',exact:true}).click();await expect(page.getByRole('status')).toContainText('2 criados, 0 atualizados');
 const mappings=await admin.from('customer_sources').select('source_id,customer_id').eq('source',source);if(mappings.error)throw mappings.error;expect(mappings.data.map(row=>row.source_id).sort()).toEqual(['a','b']);const items=await admin.from('standing_order_items').select('trays').eq('customer_id',mappings.data.find(row=>row.source_id==='a')!.customer_id);expect(items.data?.map(row=>row.trays).sort()).toEqual([1,2]);
 await preview(page);await page.route('**/rest/v1/rpc/commit_customer_import',async route=>{await route.fetch();await route.abort('failed');});await page.getByRole('button',{name:'Confirmar importação',exact:true}).click();await expect(page.getByRole('alert')).toContainText('confirmar');
 const pending=await page.evaluate(()=>Object.entries(sessionStorage).filter(([key])=>key.includes('commit_customer_import-request')));expect(pending).toHaveLength(1);expect(pending[0][1]).toMatch(/^[a-f0-9-]{36}$/);
 await page.unroute('**/rest/v1/rpc/commit_customer_import');await page.reload();await expect(page.getByRole('status')).toContainText('Envio anterior confirmado');const repeated=await admin.from('customer_sources').select('customer_id').eq('source',source);expect(repeated.data).toHaveLength(2);
});
test('motorista não acessa importação nem configurações por URL',async({page})=>{await enter(page,driverEmail);await page.goto('/configuracoes');await expect(page.getByRole('heading',{name:'Acesso não permitido',exact:true})).toBeVisible();await page.goto('/importar-clientes');await expect(page.getByRole('heading',{name:'Acesso não permitido',exact:true})).toBeVisible();});
