import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
const execute=promisify(execFile);
const container='supabase_db_granja-da-patricia';
const args=['exec',container,'psql','-X','-At','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'];
async function sql(statement){return (await execute('podman',[...args,'-c',statement])).stdout.trim();}
async function until(check){const deadline=Date.now()+10000;while(Date.now()<deadline){if(await check())return;await new Promise(resolve=>setTimeout(resolve,50));}throw Error('Timed out waiting for observable PostgreSQL lock');}
const owner=randomUUID(),customer=randomUUID(),request=randomUUID(),driver=randomUUID(),vehicle=randomUUID(),secondCustomer=randomUUID(),secondOrder=randomUUID(),secondStop=randomUUID();
let stockBefore,lifecycleStarted=false;
const monday=new Date(Date.UTC(2100+Math.floor(Math.random()*100),Math.floor(Math.random()*12),1));monday.setUTCDate(monday.getUTCDate()+(8-monday.getUTCDay())%7);
const week=monday.toISOString().slice(0,10);
let routes=[];
let held;
const triggerName=`test_snapshot_${owner.replaceAll('-','')}`;
const nextWeek=new Date(monday);nextWeek.setUTCDate(nextWeek.getUTCDate()+7);const snapshotWeek=nextWeek.toISOString().slice(0,10);
let generation;
try{
 assert.equal(await sql(`select count(*) from public.route_runs where service_date between '${week}'::date and '${week}'::date+11`),'0','Concurrency fixture week must be unused');
 await sql(`begin; insert into auth.users(id) values('${owner}');insert into public.profiles values('${owner}','owner');insert into public.customers(id,name,address,weekday,position) values('${customer}','Concorrência de pedido fictício','Rua fictícia',4,1);insert into public.standing_order_items values('${customer}','30000000-0000-0000-0000-000000000030',6);select set_config('request.jwt.claim.sub','${owner}',true);set local role authenticated;select public.generate_week('${week}','${request}');commit;`);
 routes=JSON.parse(await sql(`select json_agg(id) from public.route_runs where service_date between '${week}'::date and '${week}'::date+4`));
 const order=JSON.parse(await sql(`select row_to_json(o) from public.weekly_orders o where customer_id='${customer}'`));
 const before=await sql(`select json_build_object('version',o.version,'items',(select json_agg(i order by product_id) from public.weekly_order_items i where i.order_id=o.id)) from public.weekly_orders o where o.id='${order.id}'`);
 for(const status of ['ready','in_progress']){
  await sql(`update public.route_runs set status='draft' where id='${order.route_id}'`);
  held=spawn('podman',['exec','-i',container,'psql','-X','-At','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});
  let output='',errors='';held.stdout.on('data',chunk=>output+=chunk);held.stderr.on('data',chunk=>errors+=chunk);
  const ended=new Promise((resolve,reject)=>{held.on('error',reject);held.on('exit',code=>code===0?resolve():reject(Error(errors)));});
  held.stdin.write(`begin;update public.route_runs set status='${status}',version=version+1 where id='${order.route_id}';\n\\echo ROUTE_LOCKED_FOR_TEST\n`);
  await until(()=>output.includes('ROUTE_LOCKED_FOR_TEST'));
  const editing=sql(`set application_name='granja-order-editor-${owner}';begin;select set_config('request.jwt.claim.sub','${owner}',true);set local role authenticated;select public.save_weekly_order('${order.id}',1,'[{"productId":"30000000-0000-0000-0000-000000000030","trays":2}]',false,'${randomUUID()}');commit;`).then(value=>({value}),error=>({error}));
  try{await until(async()=>await sql(`select count(*) from pg_stat_activity where application_name='granja-order-editor-${owner}' and wait_event='transactionid'`)==='1');}
  finally{held.stdin.end('commit;\n');await ended;held=null;}
  const result=await editing;assert.ok(result.error,`Order editor must fail after ${status}`);assert.match(result.error.stderr,/ROUTE_LOCKED/);
  assert.equal(await sql(`select json_build_object('version',o.version,'items',(select json_agg(i order by product_id) from public.weekly_order_items i where i.order_id=o.id)) from public.weekly_orders o where o.id='${order.id}'`),before,'Rejected editor cannot change order quantities');
 }
 // Test-only trigger pauses insertion to expose implementations that read items in a later statement.
 await sql(`create function public.${triggerName}() returns trigger language plpgsql as $trigger$ begin if new.customer_id='${customer}' then perform pg_advisory_xact_lock(571943201);end if;return new;end $trigger$;create trigger ${triggerName} after insert on public.weekly_orders for each row execute function public.${triggerName}();`);
 held=spawn('podman',['exec','-i',container,'psql','-X','-At','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});
 let gateOutput='';held.stdout.on('data',chunk=>gateOutput+=chunk);const gateEnded=new Promise((resolve,reject)=>{held.on('error',reject);held.on('exit',code=>code===0?resolve():reject(Error('Snapshot gate failed')));});
 held.stdin.write('select pg_advisory_lock(571943201);\n\\echo SNAPSHOT_GATE_READY\n');await until(()=>gateOutput.includes('SNAPSHOT_GATE_READY'));
 generation=sql(`set application_name='granja-snapshot-${owner}';begin;select set_config('request.jwt.claim.sub','${owner}',true);set local role authenticated;select public.generate_week('${snapshotWeek}','${randomUUID()}');commit;`).then(value=>({value}),error=>({error}));
 await until(async()=>await sql(`select count(*) from pg_stat_activity where application_name='granja-snapshot-${owner}' and wait_event='advisory'`)==='1');
 await sql(`begin;update public.customers set address='Rua futura' where id='${customer}';update public.standing_order_items set trays=9 where customer_id='${customer}';insert into public.customer_prices values('${customer}','30000000-0000-0000-0000-000000000030',1234);commit;`);
 held.stdin.end('select pg_advisory_unlock(571943201);\n');await gateEnded;held=null;const outcome=await generation;generation=null;if(outcome.error)throw outcome.error;
 routes.push(...JSON.parse(await sql(`select json_agg(id) from public.route_runs where service_date between '${snapshotWeek}'::date and '${snapshotWeek}'::date+4`)));
 const snapshot=JSON.parse(await sql(`select json_build_object('address',o.customer_address,'trays',i.trays,'price',i.price_cents) from public.weekly_orders o join public.weekly_order_items i on i.order_id=o.id where customer_id='${customer}' and delivery_date between '${snapshotWeek}'::date and '${snapshotWeek}'::date+4`));
 assert.deepEqual(snapshot,{address:'Rua fictícia',trays:6,price:3300},'Generation must capture customer fields, items and price in one snapshot');
 await sql(`drop trigger ${triggerName} on public.weekly_orders;drop function public.${triggerName}();`);
 // Real lifecycle RPCs now exercise the same locks as the editor.
 stockBefore=JSON.parse(await sql("select row_to_json(b) from public.stock_balances b where balance_key='farm'"));
 assert.equal(stockBefore.eggs,0,'Lifecycle concurrency requires an empty isolated test farm');
 assert.equal(await sql('select count(*) from public.stock_balances where eggs>0'),'0','No operational load may be present');
 lifecycleStarted=true;
 const otherRoute=routes.find(id=>id!==order.route_id);
 assert.ok(otherRoute,'Fixture has a second generated route');
 const auth=`select set_config('request.jwt.claim.sub','${owner}',true);set local role authenticated;`;
 await sql(`begin;insert into auth.users(id)values('${driver}');insert into public.profiles values('${driver}','driver');insert into public.vehicles(id,name)values('${vehicle}','Veículo fictício ciclo');
 update public.route_runs set status='draft',driver_id='${driver}',vehicle_id='${vehicle}',version=1 where id in('${order.route_id}','${otherRoute}');
 update public.weekly_order_items set trays=1 where order_id='${order.id}';
 insert into public.customers(id,name,address,weekday,position)values('${secondCustomer}','Cliente fictício crédito concorrente','Rua fictícia',4,2);
 insert into public.weekly_orders(id,customer_id,route_id,delivery_date,customer_name,customer_address)values('${secondOrder}','${secondCustomer}','${order.route_id}','${order.delivery_date}','Cliente fictício crédito concorrente','Rua fictícia');
 insert into public.weekly_order_items values('${secondOrder}','30000000-0000-0000-0000-000000000030',30,1,3300);
 insert into public.route_stops(id,route_id,order_id,kind,position,name)values('${secondStop}','${order.route_id}','${secondOrder}','customer',9000,'Cliente fictício crédito concorrente');
 ${auth}select public.record_stock_event(jsonb_build_object('kind','purchase','location','farm','eggs',300,'costCents',30000,'effectiveAt',clock_timestamp()),'${randomUUID()}');commit;`);
 const preparations=await Promise.allSettled([order.route_id,otherRoute].map(id=>sql(`begin;${auth}select public.confirm_route_load('${id}',1,'${randomUUID()}');commit;`)));
 assert.equal(preparations.filter(result=>result.status==='fulfilled').length,1,'Only one preparation can reserve the vehicle');
 assert.match(preparations.find(result=>result.status==='rejected').reason.stderr,/VEHICLE_BUSY/);
 const winner=[order.route_id,otherRoute][preparations.findIndex(result=>result.status==='fulfilled')];
 await sql(`begin;${auth}select public.reopen_preparation('${winner}',2,'Fixture reabertura','${randomUUID()}');commit;`);
 const prepVersion=await sql(`select version from public.route_runs where id='${order.route_id}'`);
 const doubleLoad=await Promise.allSettled([1,2].map(()=>sql(`begin;${auth}select public.confirm_route_load('${order.route_id}',${prepVersion},'${randomUUID()}');commit;`)));
 assert.equal(doubleLoad.filter(result=>result.status==='fulfilled').length,1,'Two load requests cannot load the same list twice');
 assert.match(doubleLoad.find(result=>result.status==='rejected').reason.stderr,/VERSION_CONFLICT/);
 assert.equal(await sql(`select eggs from public.stock_balances where route_id='${order.route_id}'`),'60','Confirmed load contains only sixty eggs');
 // Hold the real start transaction while an editor waits on its route lock.
 const startVersion=await sql(`select version from public.route_runs where id='${order.route_id}'`);
 held=spawn('podman',['exec','-i',container,'psql','-X','-At','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});
 let startOutput='',startErrors='';held.stdout.on('data',chunk=>startOutput+=chunk);held.stderr.on('data',chunk=>startErrors+=chunk);
 const started=new Promise((resolve,reject)=>{held.on('error',reject);held.on('exit',code=>code===0?resolve():reject(Error(startErrors)));});
 held.stdin.write(`begin;${auth}select public.start_route('${order.route_id}',${startVersion},100,'${randomUUID()}');\n\\echo REAL_ROUTE_STARTED\n`);
 await until(()=>startOutput.includes('REAL_ROUTE_STARTED'));
 const editor=sql(`set application_name='granja-real-editor-${owner}';begin;${auth}select public.save_weekly_order('${order.id}',1,'[{"productId":"30000000-0000-0000-0000-000000000030","trays":2}]',false,'${randomUUID()}');commit;`).then(value=>({value}),error=>({error}));
 try{await until(async()=>await sql(`select count(*) from pg_stat_activity where application_name='granja-real-editor-${owner}' and wait_event='transactionid'`)==='1');}
 finally{held.stdin.end('commit;\n');await started;held=null;}
 assert.match((await editor).error?.stderr??'',/ROUTE_LOCKED/,'Real start excludes an order edit');
 const stop=await sql(`select id from public.route_stops where order_id='${order.id}'`);
 const deliveries=await Promise.allSettled([1,2].map(()=>sql(`begin;${auth}select public.record_delivery('${stop}','delivered',null,'${randomUUID()}');commit;`)));
 for(const result of deliveries)if(result.status==='rejected')throw result.reason;
 assert.equal(await sql(`select count(*) from public.sales where stop_id='${stop}'`),'1','Concurrent delivery requests create one sale');
 assert.equal(await sql(`select eggs from public.stock_balances where route_id='${order.route_id}'`),'30','Concurrent delivery consumes thirty eggs once');
 // The payment account lock and the delivery account lock must serialize without
 // deadlocking or losing available credit, regardless of their winning order.
 const paymentRace=await Promise.allSettled([
  sql(`begin;${auth}select public.record_payment('${secondCustomer}',5000,clock_timestamp(),'pix','${randomUUID()}');commit;`),
  sql(`begin;${auth}select public.record_delivery('${secondStop}','delivered',null,'${randomUUID()}');commit;`),
 ]);
 for(const result of paymentRace)if(result.status==='rejected')throw result.reason;
 const account=JSON.parse(await sql(`begin;${auth}select public.get_customer_account('${secondCustomer}');commit;`).then(output=>output.split('\n').find(line=>line.startsWith('{'))));
 assert.equal(account.openCents,0);assert.equal(account.creditCents,1700,'Concurrent payment and delivery preserve credit');
 assert.equal(await sql(`select eggs from public.stock_balances where route_id='${order.route_id}'`),'0');
 console.log('Order concurrency: real preparation/start excludes editing; one vehicle reservation, one load, one concurrent delivery; payment and delivery preserve FIFO credit. Snapshot pattern remains consistent.');

}finally{
 if(held) held.stdin.end('rollback;\n');
 if(generation)await generation;
 await sql(`drop trigger if exists ${triggerName} on public.weekly_orders;drop function if exists public.${triggerName}();`);
 if(lifecycleStarted)await sql(`begin;delete from public.payment_allocations where customer_id in('${customer}','${secondCustomer}');delete from public.sales where customer_id in('${customer}','${secondCustomer}');delete from public.payments where customer_id in('${customer}','${secondCustomer}');delete from public.delivery_corrections where actor_id='${owner}';delete from public.expenses where actor_id='${owner}';delete from public.stock_events where actor_id='${owner}';delete from public.stock_balances where vehicle_id='${vehicle}';update public.stock_balances set eggs=${stockBefore.eggs},total_cost_cents=${stockBefore.total_cost_cents===null?'null':stockBefore.total_cost_cents} where balance_key='farm';commit;`);
 const routeIds=routes.map(id=>`'${id}'`).join(',');
 if(routeIds)await sql(`delete from public.route_stops where route_id in(${routeIds});delete from public.weekly_orders where route_id in(${routeIds});delete from public.route_runs where id in(${routeIds});`);
 await sql(`delete from public.customers where id in('${customer}','${secondCustomer}');delete from private.request_events where actor_id in('${owner}','${driver}');delete from auth.users where id in('${owner}','${driver}');delete from public.vehicles where id='${vehicle}';`);
}
