import {test,expect} from '@playwright/test';
import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import type {Database} from '../../src/lib/database.types';
import {randomUUID} from 'node:crypto';
const admin=createClient<Database>(process.env.VITE_SUPABASE_URL!,process.env.TEST_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
const ownerId={value:''};const customerIds=[randomUUID(),randomUUID()];
const email=`dashboard-${Date.now()}@example.test`,password='Ficticio-apenas-teste-2026!';
let client:SupabaseClient<Database>;
async function okay(result:{error:unknown}){if(result.error)throw result.error;}
test.beforeAll(async()=>{
 const user=await admin.auth.admin.createUser({email,password,email_confirm:true});if(user.error||!user.data.user)throw user.error;ownerId.value=user.data.user.id;
 await okay(await admin.from('profiles').insert({id:ownerId.value,role:'owner'}));
 await okay(await admin.from('customers').insert(customerIds.map((id,index)=>({id,name:index?'Conta pendente fictícia':'Conta antecipada fictícia',address:'Rua fictícia',weekday:2,position:index+1}))));
 client=createClient<Database>(process.env.VITE_SUPABASE_URL!,process.env.VITE_SUPABASE_ANON_KEY!,{auth:{persistSession:false}});await okay(await client.auth.signInWithPassword({email,password}));
 const now=new Date().toISOString();const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Recife'}).format(new Date());
 await okay(await admin.from('sales').insert({customer_id:customerIds[0],amount_cents:3300,eggs:30,cost_cents:null,effective_at:now,actor_id:ownerId.value}));
 await okay(await client.rpc('record_payment',{p_customer_id:customerIds[0],p_amount_cents:10000,p_received_at:now,p_method:'pix',p_request_id:randomUUID()}));
 await okay(await client.rpc('set_opening_balance',{p_customer_id:customerIds[1],p_signed_cents:5000,p_as_of:date,p_reason:'Abertura fictícia',p_request_id:randomUUID()}));
 await okay(await client.rpc('record_expense',{p_event:{category:'other',description:'Despesa fictícia',amountCents:2000,paidAt:now},p_request_id:randomUUID()}));
});
test.afterAll(async()=>{
 if(!ownerId.value)return;
 await admin.from('payment_allocations').delete().in('customer_id',customerIds);
 await admin.from('sales').delete().in('customer_id',customerIds);
 await admin.from('payments').delete().in('customer_id',customerIds);
 await admin.from('customer_openings').delete().in('customer_id',customerIds);
 await admin.from('expenses').delete().eq('actor_id',ownerId.value);
 await admin.from('customers').delete().in('id',customerIds);
 // RPC request rows require the administrative fixture cleanup used by other suites.
 const {execFileSync}=await import('node:child_process');
 execFileSync('podman',['exec','supabase_db_granja-da-patricia','psql','-X','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',`delete from private.request_events where actor_id='${ownerId.value}'`]);
 await admin.auth.admin.deleteUser(ownerId.value);
});
test('dashboard e financeiro distinguem caixa, crédito e custo desconhecido',async({page})=>{
 await page.setViewportSize({width:390,height:900});await page.goto('/');
 await page.getByLabel('E-mail').fill(email);await page.getByLabel('Senha',{exact:true}).fill(password);await page.getByRole('button',{name:'Entrar',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Visão geral',exact:true})).toBeVisible();
 await expect(page.getByTestId('month-received')).toContainText('100,00');
 await expect(page.getByTestId('month-expenses')).toContainText('20,00');
 await expect(page.getByTestId('month-cash')).toContainText('80,00');
 await expect(page.getByText('Nenhuma rota para este dia.',{exact:true})).toBeVisible();
 await page.getByRole('link',{name:'Ver financeiro',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Financeiro',exact:true})).toBeVisible();
 await expect(page.getByTestId('financial-sales')).toContainText('33,00');
 await expect(page.getByTestId('financial-result')).toContainText('Resultado indisponível');
 await page.getByRole('link',{name:'Clientes a receber',exact:true}).click();
 await expect(page.getByText('Conta pendente fictícia',{exact:true})).toBeVisible();
 await expect(page.getByText('Conta antecipada fictícia',{exact:true})).toBeVisible();
 await page.getByLabel('Buscar conta').pressSequentially('Conta pendente');
 await expect(page.getByLabel('Buscar conta')).toBeFocused();
 await expect(page.getByText('Conta antecipada fictícia',{exact:true})).toHaveCount(0);
 await page.getByRole('link',{name:'Lançamentos',exact:true}).click();
 await expect(page.getByText('Despesa fictícia',{exact:true})).toBeVisible();
 await page.getByLabel('Descrição',{exact:true}).fill('Despesa adicional fictícia');
 await page.getByLabel('Valor da despesa (R$)',{exact:true}).fill('10,50');
 await page.getByRole('button',{name:'Registrar despesa paga',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'Despesa registrada'})).toBeVisible();
 await page.getByRole('listitem').filter({hasText:'Despesa adicional fictícia'}).getByRole('button',{name:'Corrigir lançamento',exact:true}).click();
 await page.getByLabel('Valor da despesa (R$)',{exact:true}).fill('15,00');
 await page.getByLabel('Motivo da correção',{exact:true}).fill('Valor fictício conferido');
 await page.getByRole('button',{name:'Confirmar correção',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'Despesa registrada'})).toBeVisible();
 const books=await admin.from('expenses').select('amount_cents,reversal_of').eq('actor_id',ownerId.value);
 expect(books.error).toBeNull();expect(books.data!.reduce((sum,row)=>sum+(row.reversal_of?-row.amount_cents:row.amount_cents),0)).toBe(3500);
 for(const width of [360,390,768,1440]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
 await page.evaluate(()=>document.documentElement.style.zoom='2');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.evaluate(()=>document.documentElement.style.zoom='');
 await page.screenshot({path:'/tmp/granja-financial-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:900});await page.screenshot({path:'/tmp/granja-financial-mobile.png',fullPage:true});
});
