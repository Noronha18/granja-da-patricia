import {loadDriverRoute,type DriverRoute,type DriverStop} from '../routes/api';
import {hasPending,recoverRouteOperation} from '../routes/operations';
import type {RouteOperation} from '../orders/api';
export type AssignedRoute=Exclude<DriverRoute,{available:false}>;
export type AssignedStop=DriverStop;
export async function loadAssignedRoute(date:string):Promise<AssignedRoute|null>{const route=await loadDriverRoute(date);return 'available' in route?null:route;}
export const driverOperations:RouteOperation[]=['start_route','record_delivery','record_operational_stop','submit_route_return'];
const key=(actor:string)=>`granja:${actor}:driver-action`;
type Intent={operation:RouteOperation;routeId:string;stopId?:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function pendingDriverAction(actor:string){const value=sessionStorage.getItem(key(actor));if(!value)return null;try{const intent=JSON.parse(value) as Intent;if(!driverOperations.includes(intent.operation)||!uuid.test(intent.routeId)||(intent.stopId!==undefined&&!uuid.test(intent.stopId)))throw Error('INVALID_INTENT');return intent;}catch{throw Error('INVALID_INTENT');}}
export async function runDriverAction<T>(actor:string,intent:Intent,send:()=>Promise<T>){
 pendingDriverAction(actor);
 if(driverOperations.some(operation=>hasPending(operation,actor)))throw Error('PENDING_REQUEST');
 if(!driverOperations.includes(intent.operation)||!uuid.test(intent.routeId)||(intent.stopId!==undefined&&!uuid.test(intent.stopId)))throw Error('INVALID_INTENT');
 sessionStorage.setItem(key(actor),JSON.stringify(intent));
 try{return await send();}finally{if(!hasPending(intent.operation,actor))sessionStorage.removeItem(key(actor));}
}
export async function recoverDriverActions(actor:string){let saved=false;for(const operation of driverOperations){const result=await recoverRouteOperation(operation,actor);if(result?.status==='saved')saved=true;}sessionStorage.removeItem(key(actor));return saved;}
