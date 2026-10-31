import {supabase} from '../../lib/supabase';
import {preparation,type RouteRun,type RouteOperation} from '../orders/api';
import type {Database} from '../../lib/database.types';
export {hasPending,recoverPreparation as recoverRouteOperation} from '../orders/api';
export type RouteResult={routeId:string;status:string;version:number};
export type DeliveryResult={stopId:string;status:'delivered'|'not_delivered';saleId:string|null};
type Args<K extends RouteOperation>=Database['public']['Functions'][K]['Args'];
function send<T,K extends RouteOperation>(operation:K,args:Omit<Args<K>,'p_request_id'>,actorId:string){
 return preparation<T>(operation,actorId,async id=>{
  // PostgREST arguments are generated per RPC; this generic preserves their names.
  const {data,error}=await supabase.rpc(operation,{...args,p_request_id:id} as Args<K>).retry(false);
  if(error)throw error;return data as T;
 });
}
const nullable=(value:string|null)=>value as string;
export function confirmRouteLoad(route:Pick<RouteRun,'id'|'version'>,actorId:string){return send<RouteResult,'confirm_route_load'>('confirm_route_load',{p_route_id:route.id,p_expected_version:route.version},actorId);}
export function reopenPreparation(route:Pick<RouteRun,'id'|'version'>,reason:string,actorId:string){return send<RouteResult,'reopen_preparation'>('reopen_preparation',{p_route_id:route.id,p_expected_version:route.version,p_reason:reason},actorId);}
export function cancelRoute(route:Pick<RouteRun,'id'|'version'>,reason:string,actorId:string){return send<RouteResult,'cancel_route'>('cancel_route',{p_route_id:route.id,p_expected_version:route.version,p_reason:reason},actorId);}
export function startRoute(route:{id:string;version:number},odometer:number,actorId:string){return send<RouteResult,'start_route'>('start_route',{p_route_id:route.id,p_expected_version:route.version,p_odometer:odometer},actorId);}
export function recordDelivery(stopId:string,result:'delivered'|'not_delivered',reason:string|null,actorId:string){return send<DeliveryResult,'record_delivery'>('record_delivery',{p_stop_id:stopId,p_result:result,p_reason:nullable(reason)},actorId);}
export function recordOperationalStop(stopId:string,actorId:string){return send<{stopId:string;status:'completed'},'record_operational_stop'>('record_operational_stop',{p_stop_id:stopId},actorId);}
export function submitRouteReturn(routeId:string,odometer:number,returnEggs:number,lossEggs:number,lossReason:string|null,actorId:string){return send<RouteResult,'submit_route_return'>('submit_route_return',{p_route_id:routeId,p_odometer:odometer,p_return_eggs:returnEggs,p_loss_eggs:lossEggs,p_loss_reason:nullable(lossReason)},actorId);}
export function reconcileRoute(route:Pick<RouteRun,'id'|'version'>,returnEggs:number,lossEggs:number,reason:string|null,actorId:string){return send<RouteResult,'reconcile_route'>('reconcile_route',{p_route_id:route.id,p_expected_version:route.version,p_return_eggs:returnEggs,p_loss_eggs:lossEggs,p_reason:nullable(reason)},actorId);}
export function correctSalePrice(saleId:string,prices:{productId:string;priceCents:number}[],reason:string,actorId:string){return send<{adjustmentId:string},'correct_sale_price'>('correct_sale_price',{p_sale_id:saleId,p_prices:prices,p_reason:reason},actorId);}
export function correctDeliveryRecord(stopId:string,result:'delivered'|'not_delivered',goodsLocation:'farm'|'vehicle',reason:string,actorId:string){return send<{correctionId:string},'correct_delivery_record'>('correct_delivery_record',{p_stop_id:stopId,p_actual_result:result,p_goods_location:goodsLocation,p_reason:reason},actorId);}
export function routeOperationError(error:unknown){
 const failure=error as {message?:string;code?:string};
 const messages:Record<string,string>={VERSION_CONFLICT:'Rota alterada em outra sessão. Atualize e confira os dados antes de salvar.',INSUFFICIENT_STOCK:'Estoque insuficiente. Confira os ovos disponíveis antes de preparar a carga.',VEHICLE_BUSY:'O veículo ainda está vinculado a outra rota ativa. Confira o retorno anterior.',LOAD_REQUIRED:'Confirme a carga antes de iniciar esta rota.',ASSIGNMENT_REQUIRED:'Atribua motorista e veículo antes de confirmar a carga.',REASON_REQUIRED:'Informe o motivo desta operação.',GOODS_LOCATION_REQUIRED:'Confirme onde estão todos os ovos antes de corrigir a entrega.',PHYSICAL_ADJUSTMENT_REQUIRED:'A correção exige conferência física específica. Rota encerrada aceita somente devolução integral conferida à granja; uma nova entrega exige uma nova operação.',STOCK_MISMATCH:'Sobras e perdas não correspondem aos ovos restantes no veículo. Confira as quantidades.',PENDING_DELIVERIES:'Resolva todas as entregas pendentes antes de enviar o retorno.',INVALID_ODOMETER:'Informe quilometragem válida, igual ou maior que a inicial.',ROUTE_LOCKED:'Esta operação não está disponível no estado atual da rota. Atualize para conferir.',STOP_ALREADY_RESOLVED:'Esta parada já foi registrada com outro resultado. A dona deve conferir e corrigir o registro.',SALE_ALREADY_CORRECTED:'Esta venda já foi corrigida. Consulte o lançamento atual.',REQUEST_CLOSED:'Tentativa encerrada sem salvar. Confira e tente novamente.',AMOUNT_OUT_OF_RANGE:'Quantidade ou valor acima do limite permitido.',FORBIDDEN:'Você não tem permissão para registrar esta operação.'};
 return messages[failure.message??'']??(failure.code==='22023'?'Confira os dados informados antes de salvar.':'Não foi possível confirmar o registro. Verifique o envio anterior e tente novamente.');
}
