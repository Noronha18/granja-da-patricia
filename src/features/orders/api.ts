import {supabase} from '../../lib/supabase';
import type {Database,Json} from '../../lib/database.types';
export type OrderRow=Database['public']['Tables']['weekly_orders']['Row'];
export type WeeklyItem=Database['public']['Tables']['weekly_order_items']['Row'];
export type WeeklyOrder=OrderRow&{items:WeeklyItem[]};
export type RouteRun=Database['public']['Tables']['route_runs']['Row'];
export type RouteOperation='confirm_route_load'|'reopen_preparation'|'cancel_route'|'start_route'|'record_delivery'|'record_operational_stop'|'submit_route_return'|'reconcile_route'|'correct_sale_price'|'correct_delivery_record';
export type Operation=RouteOperation|'generate_week'|'save_weekly_order'|'save_route_run'|'commit_customer_import'|'save_operational_settings';
const routeOperations:readonly Operation[]=['confirm_route_load','reopen_preparation','cancel_route','start_route','record_delivery','record_operational_stop','submit_route_return','reconcile_route','correct_sale_price','correct_delivery_record'];
const key=(operation:Operation,actorId:string)=>`granja:${actorId}:${operation}-request`;
export const hasPending=(operation:Operation,actorId:string)=>Boolean(sessionStorage.getItem(key(operation,actorId)));
export function today(){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Recife'}).format(new Date());}
export function weekStart(date:string){const value=new Date(`${date}T12:00:00Z`);value.setUTCDate(value.getUTCDate()-((value.getUTCDay()+6)%7));return value.toISOString().slice(0,10);}
export const statuses:Record<string,string>={draft:'Em preparação',ready:'Pronta',in_progress:'Em andamento',awaiting_reconciliation:'Aguardando conferência',closed:'Encerrada',cancelled:'Cancelada'};
export async function recoverPreparation(operation:Operation,actorId:string){
 const requestId=sessionStorage.getItem(key(operation,actorId));if(!requestId)return null;
 const {data,error}=await supabase.rpc(routeOperations.includes(operation)?'reconcile_route_request':operation==='commit_customer_import'||operation==='save_operational_settings'?'reconcile_configuration_request':'reconcile_preparation_request',{p_request_id:requestId,p_operation:operation}).retry(false);if(error)throw error;
 sessionStorage.removeItem(key(operation,actorId));return data as {status:'closed'}|{status:'saved';result:Json};
}
export async function preparation<T>(operation:Operation,actorId:string,send:(id:string)=>Promise<T>){
 const recovered=await recoverPreparation(operation,actorId);if(recovered?.status==='saved')return {data:recovered.result as T,recovered:true};
 const requestId=crypto.randomUUID();sessionStorage.setItem(key(operation,actorId),requestId);
 try{const data=await send(requestId);sessionStorage.removeItem(key(operation,actorId));return {data,recovered:false};}
 catch(error){const code=(error as {code?:string}).code;if(code&&/^[0-9A-Z]{5}$/.test(code))sessionStorage.removeItem(key(operation,actorId));throw error;}
}
export async function loadWeek(week:string){
 const end=new Date(`${week}T12:00:00Z`);end.setUTCDate(end.getUTCDate()+4);
 const routes=await supabase.from('route_runs').select('*').gte('service_date',week).lte('service_date',end.toISOString().slice(0,10)).order('service_date');if(routes.error)throw routes.error;
 const orders:WeeklyOrder[]=[];
 if(routes.data.length)for(let start=0;;start+=200){const result=await supabase.from('weekly_orders').select('*').in('route_id',routes.data.map(route=>route.id)).order('delivery_date').order('customer_name').order('id').range(start,start+199);if(result.error)throw result.error;orders.push(...result.data.map(order=>({...order,items:[]})));if(result.data.length<200)break;}
 for(let chunk=0;chunk<orders.length;chunk+=50){const selected=orders.slice(chunk,chunk+50);for(let start=0;;start+=200){const result=await supabase.from('weekly_order_items').select('*').in('order_id',selected.map(order=>order.id)).order('order_id').order('product_id').range(start,start+199);if(result.error)throw result.error;for(const item of result.data)selected.find(order=>order.id===item.order_id)!.items.push(item);if(result.data.length<200)break;}}
 return {routes:routes.data,orders};
}
export function generateWeek(week:string,actorId:string){return preparation('generate_week',actorId,async id=>{const {data,error}=await supabase.rpc('generate_week',{p_week_start:week,p_request_id:id}).retry(false);if(error)throw error;return data as {createdOrders:number;createdRoutes:number};});}
export function saveWeeklyOrder(order:WeeklyOrder,items:{productId:string;trays:number}[],suspended:boolean,actorId:string){return preparation('save_weekly_order',actorId,async id=>{const {data,error}=await supabase.rpc('save_weekly_order',{p_order_id:order.id,p_expected_version:order.version,p_items:items,p_suspended:suspended,p_request_id:id}).retry(false);if(error)throw error;return data as {id:string;version:number;status:string};});}
// Generated RPC types omit PostgreSQL argument nullability; null means assignment pending.
export function saveRoute(route:RouteRun,driver:string,vehicle:string,stops:string[],actorId:string){return preparation('save_route_run',actorId,async id=>{const {data,error}=await supabase.rpc('save_route_run',{p_route_id:route.id,p_expected_version:route.version,p_driver_id:driver||(null as unknown as string),p_vehicle_id:vehicle||(null as unknown as string),p_stop_ids:stops,p_request_id:id}).retry(false);if(error)throw error;return data as {id:string;version:number;status:string};});}
export function preparationError(error:unknown){const failure=error as {code?:string;message?:string};if(failure.message==='VERSION_CONFLICT')return 'Alterado em outra sessão. Seu preenchimento foi mantido. Recarregue antes de salvar.';if(failure.message==='ROUTE_LOCKED')return 'Rota bloqueada para edição. A carga precisa ser reaberta antes de alterar pedidos.';if(failure.message==='REQUEST_CLOSED')return 'Tentativa encerrada sem salvar. Confira os dados e tente novamente.';if(failure.code==='22023')return 'Confira os dados: use quantidades inteiras e semana começando na segunda-feira.';return 'Não foi possível confirmar o envio. Seu preenchimento foi mantido. Verifique e tente novamente.';}
