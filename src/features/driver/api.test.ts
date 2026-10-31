import {beforeEach,expect,it,vi} from 'vitest';
vi.mock('../../lib/supabase',()=>({supabase:{}}));
import {pendingDriverAction,runDriverAction} from './api';
const actor='00000000-0000-4000-8000-000000000001',routeId='00000000-0000-4000-8000-000000000002',stopId='00000000-0000-4000-8000-000000000003';
beforeEach(()=>{const values=new Map<string,string>();vi.stubGlobal('sessionStorage',{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)});});
it('preserva somente identidade da ação durante resposta incerta',async()=>{
 await expect(runDriverAction(actor,{operation:'record_delivery',routeId,stopId},async()=>{sessionStorage.setItem(`granja:${actor}:record_delivery-request`,'00000000-0000-4000-8000-000000000004');throw Error('timeout');})).rejects.toThrow('timeout');
 expect(pendingDriverAction(actor)).toEqual({operation:'record_delivery',routeId,stopId});
});
it('bloqueia nova intenção enquanto existe envio anterior sem confirmação',async()=>{
 sessionStorage.setItem(`granja:${actor}:record_delivery-request`,'00000000-0000-4000-8000-000000000004');let sent=false;
 await expect(runDriverAction(actor,{operation:'submit_route_return',routeId},async()=>{sent=true;})).rejects.toThrow('PENDING_REQUEST');expect(sent).toBe(false);
});
it('rejeita operação administrativa antes de enviar',async()=>{
 let sent=false;await expect(runDriverAction(actor,{operation:'cancel_route',routeId},async()=>{sent=true;})).rejects.toThrow('INVALID_INTENT');expect(sent).toBe(false);
});
it('não aceita metadados corrompidos como confirmação',()=>{sessionStorage.setItem(`granja:${actor}:driver-action`,JSON.stringify({operation:'record_delivery',routeId:'not-a-uuid'}));expect(()=>pendingDriverAction(actor)).toThrow('INVALID_INTENT');});
