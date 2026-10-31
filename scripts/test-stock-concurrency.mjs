import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);
const container='supabase_db_granja-da-patricia';
const actor=randomUUID(),driver=randomUUID(),vehicle=randomUUID(),routes=[randomUUID(),randomUUID()];
async function sql(statement){return(await execute('podman',['exec',container,'psql','-X','-At','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',statement])).stdout.trim();}
const quotedRoutes=routes.map(id=>`'${id}'`).join(',');
const role=`select set_config('request.jwt.claim.sub','${actor}',true);`;
let before;
try{
 before=JSON.parse(await sql("select row_to_json(b) from public.stock_balances b where balance_key='farm'"));
 assert.equal(before.eggs,0,'Stock concurrency requires an empty isolated test farm');
 assert.equal(await sql('select count(*) from public.stock_balances where eggs>0'),'0','No operational load may be present');
 await sql(`begin;insert into auth.users(id)values('${actor}'),('${driver}');insert into public.profiles values('${actor}','owner'),('${driver}','driver');insert into public.vehicles(id,name)values('${vehicle}','Veículo fictício concorrência');insert into public.route_runs(id,template_id,service_date,driver_id,vehicle_id)values('${routes[0]}','50000000-0000-0000-0000-000000000002','2390-01-02','${driver}','${vehicle}'),('${routes[1]}','50000000-0000-0000-0000-000000000003','2390-01-03','${driver}','${vehicle}');${role}select public.record_stock_event(jsonb_build_object('kind','purchase','location','farm','eggs',400,'costCents',4000,'effectiveAt',clock_timestamp()),'${randomUUID()}');commit;`);
 // Two connections compete for the same vehicle. Exactly one load may commit.
 const loads=await Promise.allSettled(routes.map(route=>sql(`begin;${role}select private.transfer_stock('${route}','load',300,'${randomUUID()}');commit;`)));
 assert.equal(loads.filter(result=>result.status==='fulfilled').length,1,'Exactly one concurrent vehicle load commits');
 const failure=loads.find(result=>result.status==='rejected');assert.match(failure.reason.stderr,/VEHICLE_ALREADY_LOADED/);
 const winner=routes[loads.findIndex(result=>result.status==='fulfilled')];
 assert.equal(await sql("select eggs from public.stock_balances where balance_key='farm'"),'100');
 assert.equal(await sql(`select eggs from public.stock_balances where route_id='${winner}'`),'300');
 // A purchase and transfer contend for farm stock without reversing lock order.
 const simultaneous=await Promise.allSettled([
  sql(`begin;${role}select public.record_stock_event(jsonb_build_object('kind','purchase','location','farm','eggs',100,'costCents',2000,'effectiveAt',clock_timestamp()),'${randomUUID()}');commit;`),
  sql(`begin;${role}select private.transfer_stock('${winner}','load',100,'${randomUUID()}');commit;`),
 ]);
 for(const outcome of simultaneous)if(outcome.status==='rejected')throw outcome.reason;
 assert.equal(await sql("select eggs from public.stock_balances where balance_key='farm'"),'100');
 assert.equal(await sql(`select eggs from public.stock_balances where route_id='${winner}'`),'400');
 assert.equal(await sql('select sum(total_cost_cents) from public.stock_balances'),'6000','Transfers preserve total purchase cost under contention');
 console.log('Stock concurrency: two loads share one vehicle; purchase and load preserve eggs and cost without deadlock.');
}finally{
 if(before){
  await sql(`begin;delete from public.expenses where actor_id='${actor}';delete from public.stock_events where actor_id='${actor}';delete from public.stock_balances where route_id in(${quotedRoutes});delete from public.route_runs where id in(${quotedRoutes});delete from public.vehicles where id='${vehicle}';delete from private.request_events where actor_id in('${actor}','${driver}');delete from auth.users where id in('${actor}','${driver}');update public.stock_balances set eggs=${before.eggs},total_cost_cents=${before.total_cost_cents===null?'null':before.total_cost_cents} where balance_key='farm';commit;`);
 }
}
