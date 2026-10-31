import {test,expect,type Page} from '@playwright/test';
import {createClient} from '@supabase/supabase-js';
const admin=createClient(process.env.VITE_SUPABASE_URL!,process.env.TEST_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
const suffix=Date.now(),password='Ui-ux-fixture-only-2026!',ownerEmail=`ux-owner-${suffix}@example.test`,driverEmail=`ux-driver-${suffix}@example.test`;
let owner='',driver='',customer='',vehicle='';const routes:string[]=[];
async function login(page:Page,email:string){await page.goto('/login');await page.getByLabel('E-mail').fill(email);await page.getByLabel('Senha',{exact:true}).fill(password);await page.getByRole('button',{name:'Entrar',exact:true}).click();await expect(page.getByRole('button',{name:'Sair',exact:true})).toBeVisible();}
test.beforeAll(async()=>{
 for(const [email,role]of [[ownerEmail,'owner'],[driverEmail,'driver']]){const user=await admin.auth.admin.createUser({email,password,email_confirm:true});if(user.error)throw user.error;const id=user.data.user!.id;if(role==='owner')owner=id;else driver=id;expect((await admin.from('profiles').insert({id,role})).error).toBeNull();}
 const v=await admin.from('vehicles').insert({name:`Veículo UX ${suffix}`}).select('id').single();if(v.error)throw v.error;vehicle=v.data.id;
 const c=await admin.from('customers').insert({name:`Cliente UX ${suffix}`,address:'Rua fictícia, 100, Recife',weekday:2,position:9999}).select('id').single();if(c.error)throw c.error;customer=c.data.id;
 const template=await admin.from('route_templates').select('id').eq('weekday',2).single();const product=await admin.from('products').select('id').eq('eggs_per_tray',30).single();
 for(const [date,status]of [['2095-08-02','ready'],['2095-08-03','in_progress']]){
  const run=await admin.from('route_runs').insert({template_id:template.data!.id,service_date:date,status,driver_id:driver,vehicle_id:vehicle,load_eggs:60,...(status==='in_progress'?{initial_odometer_km:1000}:{})}).select('id').single();if(run.error)throw run.error;routes.push(run.data.id);
  const order=await admin.from('weekly_orders').insert({route_id:run.data.id,customer_id:customer,delivery_date:date,customer_name:'Mercado fictício com nome comprido',customer_address:'Rua fictícia, 100, Recife'}).select('id').single();if(order.error)throw order.error;
  expect((await admin.from('weekly_order_items').insert({order_id:order.data.id,product_id:product.data!.id,eggs_per_tray:30,trays:2,price_cents:3300})).error).toBeNull();
  expect((await admin.from('route_stops').insert(Array.from({length:12},(_,i)=>({route_id:run.data.id,position:i+1,kind:i===0?'departure':i===1?'customer':i===11?'arrival':'pickup',name:i===1?'Mercado fictício com nome comprido':`Parada fictícia ${i+1}`,address:'Rua fictícia, 100, Recife',status:status==='in_progress'&&i===0?'completed':'pending',...(i===1?{order_id:order.data.id}:{})})))).error).toBeNull();
 }
});
test.afterAll(async()=>{
 for(const route of routes){expect((await admin.from('route_stops').delete().eq('route_id',route)).error).toBeNull();const orders=await admin.from('weekly_orders').select('id').eq('route_id',route);for(const order of orders.data??[])expect((await admin.from('weekly_order_items').delete().eq('order_id',order.id)).error).toBeNull();expect((await admin.from('weekly_orders').delete().eq('route_id',route)).error).toBeNull();expect((await admin.from('route_runs').delete().eq('id',route)).error).toBeNull();}
 if(customer)expect((await admin.from('customers').delete().eq('id',customer)).error).toBeNull();if(vehicle)expect((await admin.from('vehicles').delete().eq('id',vehicle)).error).toBeNull();for(const id of [owner,driver])if(id)expect((await admin.auth.admin.deleteUser(id)).error).toBeNull();
});
test('driver starts before long preview and next stop action fits mobile viewport',async({page})=>{
 await login(page,driverEmail);
 for(const width of [360,390]){
  await page.setViewportSize({width,height:844});await page.goto('/entregas?dia=2095-08-02');const start=page.getByRole('button',{name:'Iniciar rota',exact:true});await expect(start).toBeVisible();const box=await start.boundingBox();expect(box!.y+box!.height).toBeLessThan(764);await expect(page.getByLabel('Quilometragem inicial do painel')).toHaveAttribute('inputmode','numeric');
  await page.goto('/entregas?dia=2095-08-03');const confirm=page.getByRole('button',{name:'Confirmar entrega',exact:true});await expect(confirm).toBeVisible();const action=await confirm.boundingBox();expect(action!.y+action!.height).toBeLessThan(764);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
 await expect(page.getByRole('navigation',{name:'Navegação no celular'}).getByRole('link',{name:'Minha rota'})).toHaveAttribute('aria-current','page');
 await page.screenshot({path:'/tmp/granja-ux-driver-mobile.png',fullPage:true});
});
test('driver confirmation and failure move focus and restore it on cancel',async({page})=>{
 await page.setViewportSize({width:390,height:844});await login(page,driverEmail);await page.goto('/entregas?dia=2095-08-03');await page.getByRole('button',{name:'Confirmar entrega',exact:true}).click();await expect(page.getByRole('heading',{name:/Confirmar entrega integral para/})).toBeFocused();await page.getByRole('button',{name:'Voltar',exact:true}).click();await expect(page.getByRole('button',{name:'Confirmar entrega',exact:true})).toBeFocused();
 await page.getByRole('button',{name:'Não consegui entregar',exact:true}).click();await expect(page.getByLabel('Motivo da não entrega')).toBeFocused();await page.getByRole('button',{name:'Voltar',exact:true}).click();await expect(page.getByRole('button',{name:'Não consegui entregar',exact:true})).toBeFocused();
});
test('driver fuel prioritizes form and checkbox uses consistent touch target',async({page})=>{
 await page.setViewportSize({width:360,height:800});await login(page,driverEmail);await page.goto('/combustivel');await expect(page.getByRole('heading',{name:'Novo abastecimento'})).toBeVisible();await expect(page.getByRole('heading',{name:'Consumo medido'})).toHaveCount(0);const field=await page.getByLabel('Data e hora').boundingBox();expect(field!.y).toBeLessThan(600);const checkbox=await page.getByRole('checkbox',{name:'Tanque cheio'}).boundingBox();expect(checkbox!.width).toBe(24);expect(checkbox!.height).toBe(24);await expect(page.getByRole('navigation',{name:'Navegação no celular'}).getByRole('link',{name:'Combustível'})).toHaveAttribute('aria-current','page');
});
test('owner mobile menu supports focus escape and return',async({page})=>{
 await page.setViewportSize({width:360,height:800});await login(page,ownerEmail);await page.getByRole('button',{name:'Mais',exact:true}).click();await expect(page.getByRole('navigation',{name:'Mais opções'}).getByRole('link',{name:'Clientes',exact:true})).toBeFocused();await page.keyboard.press('Escape');await expect(page.getByRole('navigation',{name:'Mais opções'})).toHaveCount(0);await expect(page.getByRole('button',{name:'Mais',exact:true})).toBeFocused();
 await expect(page.getByRole('link',{name:'Preparar semana',exact:true})).toBeVisible();
 await page.goto('/importar-clientes');await expect(page.getByRole('heading',{name:'Importar clientes (CSV)',exact:true})).toBeVisible();await expect(page.getByLabel('Arquivo CSV',{exact:true})).toBeVisible();
});
test('login recovery gives administrators a realistic manual path',async({page})=>{
 await page.goto('/login');await page.getByText('Precisa recuperar o acesso?',{exact:true}).click();await expect(page.getByText(/responsável técnico que cadastrou/)).toBeVisible();await expect(page.getByText('Dona ou administrador',{exact:true})).toBeVisible();
});

test('approved desktop navigation stays beside the workspace and all modules fit mobile',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});await login(page,ownerEmail);const navigation=page.getByRole('navigation',{name:'Navegação principal'});const sidebar=await navigation.boundingBox();const content=await page.getByRole('heading',{name:'Visão geral',exact:true}).boundingBox();expect(sidebar!.height).toBeGreaterThan(500);expect(sidebar!.x+sidebar!.width).toBeLessThan(content!.x);await expect(navigation.getByRole('link',{name:'Configurações',exact:true})).toBeVisible();
 await page.screenshot({path:'/tmp/granja-applied-owner-desktop.png',fullPage:true});
 for(const width of [360,390,900,1024]){await page.setViewportSize({width,height:844});for(const url of ['/','/clientes','/pedidos','/entregas','/financeiro','/pagamentos','/estoque','/combustivel','/configuracoes','/importar-clientes','/conferencias']){await page.goto(url);await expect(page.getByRole('button',{name:'Sair',exact:true})).toBeVisible();await expect(page.getByRole('heading',{level:1})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),url).toBe(true);}}
});
