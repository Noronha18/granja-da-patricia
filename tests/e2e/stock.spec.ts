import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
const admin=createClient(process.env.VITE_SUPABASE_URL!,process.env.TEST_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
const email=`stock-${Date.now()}@example.test`,password='Estoque-ficticio-2026!';
let userId='';
let baselineBalance:{eggs:number;total_cost_cents:number|null}|null=null;
test.beforeAll(async()=>{
 const {data,error}=await admin.auth.admin.createUser({email,password,email_confirm:true});if(error)throw error;userId=data.user!.id;
 const profile=await admin.from('profiles').insert({id:userId,role:'owner'});if(profile.error)throw profile.error;
});
test.afterAll(async()=>{
 if(!userId)return;
 let cleanupError:unknown;
 try{
  // Remove only synthetic rows authored by this test; never delete operational data.
  const stock=await admin.from('stock_events').select('id').eq('actor_id',userId);if(stock.error)throw stock.error;
  if(stock.data.length){
   const ids=stock.data.map(row=>row.id);const expenses=await admin.from('expenses').delete().in('stock_event_id',ids);if(expenses.error)throw expenses.error;
   const events=await admin.from('stock_events').delete().in('id',ids);if(events.error)throw events.error;
  }
  execFileSync('podman',['exec','supabase_db_granja-da-patricia','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',`delete from private.request_events where actor_id='${userId}'`],{stdio:'ignore'});
 }catch(error){cleanupError=error;}
 finally{
  // Only restore after the test has verified an empty baseline before its own writes.
  if(baselineBalance){const restore=await admin.from('stock_balances').update(baselineBalance).eq('balance_key','farm');if(restore.error)cleanupError??=restore.error;}
  const result=await admin.auth.admin.deleteUser(userId);if(result.error)cleanupError??=result.error;
 }
 if(cleanupError)throw cleanupError;
});
test('compra paga, resposta perdida e perda mantêm saldo do banco sem duplicar',async({page})=>{
 const before=await admin.from('stock_balances').select('eggs,total_cost_cents').eq('location','farm').single();if(before.error)throw before.error;
 // Shared local stack must be empty; do not disturb an initialized operation.
 expect(before.data).toMatchObject({eggs:0,total_cost_cents:0});
 baselineBalance={eggs:before.data.eggs,total_cost_cents:before.data.total_cost_cents};
 await page.goto('/estoque');await page.getByLabel('E-mail').fill(email);await page.getByLabel('Senha',{exact:true}).fill(password);await page.getByRole('button',{name:'Entrar',exact:true}).click();await page.getByRole('link',{name:'Estoque',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Estoque',exact:true})).toBeVisible();
 await expect(page.getByLabel('Tipo de entrada')).toHaveValue('opening');
 await page.getByLabel('Tipo de entrada').selectOption('purchase');await page.getByLabel('Quantidade em ovos',{exact:true}).fill('300');await page.getByLabel('Custo total (R$)').fill('300,00');
 await page.route('**/rest/v1/rpc/record_stock_event',async route=>{await route.fetch();await route.abort('failed');});
 await page.getByRole('button',{name:'Registrar entrada',exact:true}).click();await expect(page.getByRole('alert')).toContainText('confirmar');await expect(page.getByRole('button',{name:'Registrar entrada',exact:true})).toBeDisabled();
 await page.unroute('**/rest/v1/rpc/record_stock_event');await page.reload();await page.getByRole('button',{name:'Verificar envio anterior',exact:true}).click();await expect(page.getByRole('status')).toContainText('Movimento registrado');
 const result=await admin.from('stock_events').select('id').eq('actor_id',userId);expect(result.data).toHaveLength(1);
 const expense=await admin.from('expenses').select('amount_cents').in('stock_event_id',result.data!.map(row=>row.id));expect(expense.data).toEqual([{amount_cents:30000}]);
 await expect(page.getByTestId('farm-eggs')).toHaveText('300 ovos');
 await page.getByLabel('Quantidade perdida em ovos').fill('300');await page.getByLabel('Motivo da perda').fill('Quebra fictícia de teste');await page.getByRole('button',{name:'Registrar perda',exact:true}).click();await expect(page.getByTestId('farm-eggs')).toHaveText('0 ovos');
 for(const width of [360,390,768,1440]){await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
 await page.screenshot({path:'/tmp/granja-stock-desktop.png',fullPage:true});await page.setViewportSize({width:360,height:1000});await page.screenshot({path:'/tmp/granja-stock-mobile.png',fullPage:true});
});
