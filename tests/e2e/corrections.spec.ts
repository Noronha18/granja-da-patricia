import {test,expect} from '@playwright/test';
import {createClient} from '@supabase/supabase-js';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const admin=createClient(process.env.VITE_SUPABASE_URL!,process.env.TEST_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
const email=`price-correction-${Date.now()}@example.test`,password='Correcao-ficticia-2026!';
let owner='';const customer=randomUUID(),route=randomUUID(),order=randomUUID(),stop=randomUUID(),sale=randomUUID(),date='2395-06-04';
const product='30000000-0000-0000-0000-000000000030';
async function okay(result:{error:unknown}){if(result.error)throw result.error;}
test.beforeAll(async()=>{
 const user=await admin.auth.admin.createUser({email,password,email_confirm:true});if(user.error||!user.data.user)throw user.error;owner=user.data.user.id;
 await okay(await admin.from('profiles').insert({id:owner,role:'owner'}));
 await okay(await admin.from('customers').insert({id:customer,name:'Cliente fictício para correção',address:'Rua fictícia',weekday:2,position:1}));
 await okay(await admin.from('route_runs').insert({id:route,template_id:'50000000-0000-0000-0000-000000000002',service_date:date,status:'closed'}));
 await okay(await admin.from('weekly_orders').insert({id:order,customer_id:customer,route_id:route,delivery_date:date,customer_name:'Cliente fictício para correção',customer_address:'Rua fictícia',status:'delivered'}));
 await okay(await admin.from('weekly_order_items').insert({order_id:order,product_id:product,eggs_per_tray:30,trays:1,price_cents:3300}));
 await okay(await admin.from('route_stops').insert({id:stop,route_id:route,order_id:order,kind:'customer',position:1,name:'Cliente fictício para correção',status:'delivered'}));
 await okay(await admin.from('sales').insert({id:sale,customer_id:customer,order_id:order,stop_id:stop,amount_cents:3300,eggs:30,cost_cents:3000,items:[{productId:product,eggsPerTray:30,trays:1,priceCents:3300}],effective_at:new Date().toISOString(),actor_id:owner}));
});
test.afterAll(async()=>{
 if(!owner)return;
 execFileSync('podman',['exec','supabase_db_granja-da-patricia','psql','-X','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',`begin;delete from public.payment_allocations where customer_id='${customer}';delete from public.delivery_corrections where route_id='${route}';delete from public.sales where customer_id='${customer}';delete from public.route_stops where route_id='${route}';delete from public.weekly_orders where route_id='${route}';delete from public.route_runs where id='${route}';delete from public.customers where id='${customer}';delete from private.request_events where actor_id='${owner}';commit;`],{stdio:'ignore'});
 await admin.auth.admin.deleteUser(owner);
});
test('correção de preço aceita reais com vírgula sem alterar ovos ou custo',async({page})=>{
 await page.goto('/login');await page.getByLabel('E-mail').fill(email);await page.getByLabel('Senha',{exact:true}).fill(password);await page.getByRole('button',{name:'Entrar',exact:true}).click();await expect(page.getByRole('heading',{name:'Visão geral',exact:true})).toBeVisible();
 await page.goto(`/entregas?dia=${date}`);await page.getByText('Corrigir registro de entrega ou preço',{exact:true}).click();
 await page.getByRole('combobox',{name:/^Parada para corrigir/}).selectOption(stop);
 const input=page.getByLabel('Preço por bandeja de 30 ovos (R$)',{exact:true});await expect(input).toHaveValue('33,00');await input.fill('33,50');await page.getByLabel('Motivo da correção',{exact:true}).fill('Preço fictício conferido');await page.getByRole('button',{name:'Corrigir preço da venda',exact:true}).click();await expect(page.getByRole('status')).toContainText('Operação confirmada');
 const result=await admin.from('sales').select('amount_cents,eggs,cost_cents,reversal_of').eq('customer_id',customer);expect(result.error).toBeNull();expect(result.data).toHaveLength(3);
 expect(result.data!.reduce((sum,row)=>sum+(row.reversal_of?-row.amount_cents:row.amount_cents),0)).toBe(3350);expect(result.data!.reduce((sum,row)=>sum+(row.reversal_of?-row.eggs:row.eggs),0)).toBe(30);expect(result.data!.reduce((sum,row)=>sum+(row.reversal_of?-row.cost_cents:row.cost_cents),0)).toBe(3000);
 const stock=await admin.from('stock_events').select('id').eq('route_id',route);expect(stock.data).toEqual([]);
});
