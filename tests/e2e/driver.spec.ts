import {test,expect,type Page} from '@playwright/test';
import {createClient} from '@supabase/supabase-js';
import {execFileSync} from 'node:child_process';
const admin=createClient(process.env.VITE_SUPABASE_URL!,process.env.TEST_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
const email=`driver-flow-${Date.now()}@example.test`,ownerEmail=`driver-owner-${Date.now()}@example.test`,password='Motorista-ficticio-2026!';
let actor='',owner='',routeId='',vehicleId='',deliveryId='',adminRouteId='';const customers:string[]=[];
const date='2098-11-04';
async function login(page:Page,address:string){await page.goto('/login');await page.getByLabel('E-mail').fill(address);await page.getByLabel('Senha',{exact:true}).fill(password);await page.getByRole('button',{name:'Entrar',exact:true}).click();await expect(page.getByRole('button',{name:'Sair',exact:true})).toBeVisible();}
test.beforeAll(async()=>{
 for(const [address,role] of [[email,'driver'],[ownerEmail,'owner']]){const user=await admin.auth.admin.createUser({email:address,password,email_confirm:true});if(user.error)throw user.error;const id=user.data.user!.id;if(role==='driver')actor=id;else owner=id;const profile=await admin.from('profiles').insert({id,role});if(profile.error)throw profile.error;}
 const template=await admin.from('route_templates').select('id').limit(1).single();if(template.error)throw template.error;
 const vehicle=await admin.from('vehicles').insert({name:`Veículo fictício motorista ${Date.now()}`}).select('id').single();if(vehicle.error)throw vehicle.error;vehicleId=vehicle.data.id;
 const route=await admin.from('route_runs').insert({service_date:date,template_id:template.data.id,driver_id:actor,vehicle_id:vehicleId,status:'draft'}).select('id').single();if(route.error)throw route.error;routeId=route.data.id;
 const stop=await admin.from('route_stops').insert({route_id:routeId,kind:'pickup',name:'Coleta fictícia motorista',address:' ',position:1});if(stop.error)throw stop.error;
});
test.afterAll(async()=>{
 const ids=[actor,owner,routeId,deliveryId,adminRouteId,vehicleId,...customers].filter(Boolean);if(ids.some(id=>!/^[0-9a-f-]{36}$/i.test(id)))throw Error('Invalid fixture id');
 const routes=[routeId,deliveryId,adminRouteId].filter(Boolean).map(id=>`'${id}'`).join(',')||"null";const actors=[actor,owner].filter(Boolean).map(id=>`'${id}'`).join(',')||"null";const clients=customers.map(id=>`'${id}'`).join(',')||"null";
 execFileSync('podman',['exec','supabase_db_granja-da-patricia','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',`begin;
 update public.stock_balances set eggs=eggs-coalesce((select sum(eggs) from public.stock_events where route_id in(${routes}) and kind='return' and location='farm' and direction='in'),0),total_cost_cents=total_cost_cents-coalesce((select sum(cost_cents) from public.stock_events where route_id in(${routes}) and kind='return' and location='farm' and direction='in'),0) where balance_key='farm';
 delete from private.request_events where actor_id in(${actors});delete from public.delivery_corrections where route_id in(${routes});delete from public.stock_events where route_id in(${routes});delete from public.sales where customer_id in(${clients});delete from public.route_stops where route_id in(${routes});delete from public.weekly_order_items where order_id in(select id from public.weekly_orders where route_id in(${routes}));delete from public.weekly_orders where route_id in(${routes});delete from public.stock_balances where route_id in(${routes});delete from public.route_runs where id in(${routes});delete from public.customers where id in(${clients});delete from public.vehicles where id='${vehicleId}';commit;`],{stdio:'ignore'});
 for(const id of [actor,owner])if(id){const user=await admin.auth.admin.deleteUser(id);if(user.error)throw user.error;}
});
test('motorista sem atribuição vê estado vazio online',async({page})=>{
 await page.setViewportSize({width:390,height:900});await login(page,email);await page.goto('/entregas?dia=2098-11-05');
 await expect(page.getByText('Nenhuma rota atribuída para este dia.',{exact:true})).toBeVisible();await expect(page.getByText('Esta operação precisa de internet.',{exact:true})).toBeVisible();
});
test('coleta sem pedidos recupera confirmação incerta após reload e dona confere retorno',async({page})=>{
 await page.setViewportSize({width:390,height:900});await login(page,email);await page.goto(`/entregas?dia=${date}`);
 await page.getByLabel('Quilometragem inicial do painel',{exact:true}).fill('1000');
 await page.route('**/rest/v1/rpc/get_driver_route',request=>request.abort('failed'));
 await page.getByRole('button',{name:'Iniciar rota',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('Registro confirmado');
 await expect(page.getByRole('alert')).toContainText('atualizar');
 await expect(page.getByRole('button',{name:'Iniciar rota',exact:true})).toBeDisabled();
 await page.unroute('**/rest/v1/rpc/get_driver_route');await page.getByRole('button',{name:'Verificar e atualizar rota',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Coleta fictícia motorista',exact:true})).toBeVisible();await expect(page.getByText('Navegação indisponível. A entrega pode ser registrada normalmente.',{exact:true})).toBeVisible();
 let intercepted=false;
 await page.route('**/rest/v1/rpc/record_operational_stop',async request=>{intercepted=true;await request.fetch();await request.abort('timedout');});
 await page.getByRole('button',{name:'Concluir parada operacional',exact:true}).click();await expect.poll(()=>intercepted).toBe(true);await expect(page.getByRole('alert').first()).toContainText('Não foi possível confirmar');
 await expect(page.getByText('Registro confirmado.',{exact:true})).toHaveCount(0);
 const stored=await page.evaluate(()=>Object.entries(sessionStorage).filter(([key])=>key.includes('driver-action')).map(([,value])=>value));expect(stored).toHaveLength(1);expect(stored[0]).not.toContain('Coleta fictícia');expect(stored[0]).not.toContain('Rua de teste');
 await page.unroute('**/rest/v1/rpc/record_operational_stop');
 const session=await page.evaluate(()=>JSON.parse(localStorage.getItem('sb-127-auth-token')!));const revoked=await admin.auth.admin.signOut(session.access_token,'global');expect(revoked.error).toBeNull();
 await page.evaluate(()=>{const key='sb-127-auth-token';const session=JSON.parse(localStorage.getItem(key)!);session.expires_at=1;localStorage.setItem(key,JSON.stringify(session));});await page.reload();await expect(page.getByRole('alert')).toContainText('Sessão expirada');await login(page,email);await page.goto(`/entregas?dia=${date}`);await expect(page.getByRole('heading',{name:'Finalizar percurso',exact:true})).toBeVisible();
 await page.getByLabel('Quilometragem final do painel',{exact:true}).fill('1010');await page.getByLabel('Ovos que voltaram',{exact:true}).fill('0');await page.getByLabel('Ovos perdidos',{exact:true}).fill('0');await page.getByRole('button',{name:'Enviar para conferência',exact:true}).click();await expect(page.getByText('Percurso finalizado; aguardando conferência da dona.',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Sair',exact:true}).click();await login(page,ownerEmail);await page.goto(`/entregas?dia=${date}`);await expect(page.getByRole('heading',{name:'Conferir retorno',exact:true})).toBeVisible();await page.getByRole('button',{name:'Confirmar retorno e encerrar',exact:true}).click();await expect(page.getByText('Encerrada',{exact:true})).toBeVisible();
 const route=await admin.from('route_runs').select('status,final_odometer_km').eq('id',routeId).single();expect(route.error).toBeNull();expect(route.data).toMatchObject({status:'closed',final_odometer_km:1010});
});

test('entrega integral, não entrega e perdas ficam para conferência da dona',async({page},testInfo)=>{
 const farm=await admin.from('stock_balances').select('eggs,total_cost_cents').eq('balance_key','farm').single();expect(farm.data).toEqual({eggs:0,total_cost_cents:0});
 const template=await admin.from('route_templates').select('id').limit(1).single();if(template.error)throw template.error;
 const route=await admin.from('route_runs').insert({service_date:'2098-11-06',template_id:template.data.id,driver_id:actor,vehicle_id:vehicleId,status:'ready',load_eggs:60}).select('id').single();if(route.error)throw route.error;deliveryId=route.data.id;
 const stock=await admin.from('stock_balances').insert({balance_key:deliveryId,location:'vehicle',route_id:deliveryId,vehicle_id:vehicleId,eggs:60,total_cost_cents:600});if(stock.error)throw stock.error;
 const product=await admin.from('products').select('id').eq('eggs_per_tray',30).single();if(product.error)throw product.error;
 for(let index=1;index<=2;index++){
 const name=`Cliente fictício motorista ${index}`;const customer=await admin.from('customers').insert({name,address:'Endereço fictício Recife',weekday:2,position:index}).select('id').single();if(customer.error)throw customer.error;customers.push(customer.data.id);
 const order=await admin.from('weekly_orders').insert({customer_id:customer.data.id,customer_name:name,customer_address:'Endereço fictício Recife',route_id:deliveryId,delivery_date:'2098-11-06'}).select('id').single();if(order.error)throw order.error;
 const item=await admin.from('weekly_order_items').insert({order_id:order.data.id,product_id:product.data.id,eggs_per_tray:30,trays:1,price_cents:2200});if(item.error)throw item.error;
 const stop=await admin.from('route_stops').insert({route_id:deliveryId,kind:'customer',name,order_id:order.data.id,address:'Endereço fictício Recife',position:index});if(stop.error)throw stop.error;
 }
 const driver=createClient(process.env.VITE_SUPABASE_URL!,process.env.VITE_SUPABASE_ANON_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});const signed=await driver.auth.signInWithPassword({email,password});expect(signed.error).toBeNull();const projection=await driver.rpc('get_driver_route',{p_service_date:'2098-11-06'});expect(projection.error).toBeNull();expect(JSON.stringify(projection.data)).not.toMatch(/price|cost|amount/i);const restricted=await driver.from('weekly_order_items').select('price_cents');expect(restricted.data??[]).toEqual([]);await driver.auth.signOut();
 await page.setViewportSize({width:390,height:900});await login(page,email);await page.goto('/entregas?dia=2098-11-06');await page.getByLabel('Quilometragem inicial do painel',{exact:true}).fill('1020');await page.getByRole('button',{name:'Iniciar rota',exact:true}).click();
 await expect(page.getByText('1 bandeja',{exact:true})).toBeVisible();await page.screenshot({path:testInfo.outputPath('driver-mobile.png'),fullPage:true});await expect(page.locator('input')).toHaveCount(1);await expect(page.getByText(/22,00/)).toHaveCount(0);
 await page.getByRole('button',{name:'Ver lista da rota',exact:true}).click();await page.getByRole('button',{name:/2. Cliente fictício motorista 2/}).click();await expect(page.getByRole('heading',{name:'Cliente fictício motorista 2',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Não consegui entregar',exact:true}).click();await page.getByLabel('Motivo da não entrega',{exact:true}).fill('Cliente ausente, teste fictício');await page.getByRole('button',{name:'Registrar não entrega',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Cliente fictício motorista 1',exact:true})).toBeVisible();await page.getByRole('button',{name:'Confirmar entrega',exact:true}).click();await expect(page.getByText('Confirmar entrega integral para Cliente fictício motorista 1?',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Sim, confirmar entrega integral',exact:true}).click();
 await page.getByLabel('Quilometragem final do painel',{exact:true}).fill('1040');await page.getByLabel('Ovos que voltaram',{exact:true}).fill('25');await page.getByLabel('Ovos perdidos',{exact:true}).fill('5');await page.getByLabel('Motivo das perdas',{exact:true}).fill('Quebra fictícia na viagem');await page.getByRole('button',{name:'Enviar para conferência',exact:true}).click();await expect(page.getByText('Percurso finalizado; aguardando conferência da dona.',{exact:true})).toBeVisible();
 const before=await admin.from('stock_balances').select('eggs').eq('balance_key','farm').single();expect(before.data?.eggs).toBe(0);
 await page.getByRole('button',{name:'Sair',exact:true}).click();await login(page,ownerEmail);await page.goto('/entregas?dia=2098-11-06');await page.setViewportSize({width:1366,height:1000});await page.getByLabel('Motivo da conferência',{exact:true}).fill('Perda e retorno fictícios conferidos');await page.screenshot({path:testInfo.outputPath('owner-return-desktop.png'),fullPage:true});await page.getByRole('button',{name:'Confirmar retorno e encerrar',exact:true}).click();await expect(page.getByText('Encerrada',{exact:true})).toBeVisible();
 const after=await admin.from('stock_balances').select('eggs,total_cost_cents').eq('balance_key','farm').single();expect(after.data).toEqual({eggs:25,total_cost_cents:250});const sales=await admin.from('sales').select('eggs,amount_cents').in('customer_id',customers);expect(sales.data).toEqual([{eggs:30,amount_cents:2200}]);
});

test('dona confirma carga sem pedidos, reabre preparação e cancela com motivo',async({page})=>{
 const template=await admin.from('route_templates').select('id').limit(1).single();if(template.error)throw template.error;
 const route=await admin.from('route_runs').insert({service_date:'2098-11-07',template_id:template.data.id,driver_id:actor,vehicle_id:vehicleId,status:'draft'}).select('id').single();if(route.error)throw route.error;adminRouteId=route.data.id;
 await login(page,ownerEmail);await page.goto('/entregas?dia=2098-11-07');await expect(page.getByText('Total: 0 ovos',{exact:true})).toBeVisible();page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Confirmar carga e marcar pronta',exact:true}).click();await expect(page.getByText('Pronta',{exact:true})).toBeVisible();await page.getByText('Reabrir ou cancelar rota',{exact:true}).click();await page.getByLabel('Motivo da alteração da rota',{exact:true}).fill('Conferir novamente carga fictícia');await page.getByRole('button',{name:'Reabrir preparação',exact:true}).click();await expect(page.getByText('Em preparação',{exact:true})).toBeVisible();await page.getByLabel('Motivo da alteração da rota',{exact:true}).fill('Execução fictícia dispensada');page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Cancelar rota',exact:true}).click();await expect(page.getByText('Cancelada',{exact:true})).toBeVisible();
});
