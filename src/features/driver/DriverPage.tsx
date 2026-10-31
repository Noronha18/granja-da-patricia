import {useEffect,useRef,useState,type FormEvent} from 'react';
import {useSession} from '../../app/Session';
import {today,statuses} from '../orders/api';
import {startRoute,recordDelivery,recordOperationalStop,submitRouteReturn,routeOperationError,hasPending} from '../routes/operations';
import {loadAssignedRoute,recoverDriverActions,runDriverAction,driverOperations,type AssignedRoute} from './api';
import StopPage from './StopPage';
import './driver.css';
export default function DriverPage(){
 const {userId}=useSession(),actor=userId??'';
 const initial=new URLSearchParams(location.search).get('dia');
 const [date,setDate]=useState(initial&&/^\d{4}-\d{2}-\d{2}$/.test(initial)?initial:today());
 const [route,setRoute]=useState<AssignedRoute|null>(null),[selected,setSelected]=useState<string|null>(null),[list,setList]=useState(false),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [odometer,setOdometer]=useState(''),[returned,setReturned]=useState(''),[loss,setLoss]=useState(''),[reason,setReason]=useState('');
 const [stale,setStale]=useState(false);const listTitle=useRef<HTMLHeadingElement>(null),wasList=useRef(false);
 useEffect(()=>{if(list)listTitle.current?.focus();else if(wasList.current)document.getElementById('current-stop-heading')?.focus();wasList.current=list;},[list]);
 const pending=driverOperations.some(operation=>hasPending(operation,actor));
 async function refresh(){setRoute(await loadAssignedRoute(date));setStale(false);}
 async function refreshConfirmed(){try{await refresh();}catch{setStale(true);setError('Registro confirmado, mas não foi possível atualizar a rota. Verifique e atualize antes de continuar.');}}
 async function recover(){setBusy(true);setError('');try{const saved=await recoverDriverActions(actor);setMessage(saved?'Registro anterior confirmado. Confira a rota atual.':'Tentativa anterior verificada. Confira a rota antes de registrar novamente.');if(saved){setSelected(null);setReason('');setReturned('');setLoss('');setOdometer('');}await refreshConfirmed();}catch{setError('Não foi possível verificar o envio anterior. A tentativa foi preservada. Reconecte e atualize.');}finally{setBusy(false);setLoading(false);}}
 useEffect(()=>{let active=true;setLoading(true);setRoute(null);setError('');setMessage('');setSelected(null);setList(false);setOdometer('');setReturned('');setLoss('');setReason('');(async()=>{try{await recoverDriverActions(actor);const value=await loadAssignedRoute(date);if(active){setRoute(value);setStale(false);}}catch{if(active)setError('Não foi possível consultar a rota ou verificar o envio anterior. Reconecte e atualize.');}finally{if(active)setLoading(false);}})();return()=>{active=false;};},[date,actor]);
 async function act(operation:typeof driverOperations[number],send:()=>Promise<unknown>,stopId?:string){
  if(!route||busy||pending||stale)return;
  setBusy(true);setError('');setMessage('');
  try{
   await runDriverAction(actor,{operation,routeId:route.id,...(stopId?{stopId}:{})},send);
   setMessage('Registro confirmado.');setSelected(null);setList(false);setReason('');
   if(operation==='start_route'||operation==='submit_route_return')setOdometer('');
   if(operation==='submit_route_return'){setReturned('');setLoss('');}
   await refreshConfirmed();
  }catch(error){setError(routeOperationError(error));}finally{setBusy(false);}
 }

 const stop=route?.stops.find(stop=>stop.id===selected)??route?.stops.find(stop=>stop.status==='pending');
 const resolved=route?.stops.every(stop=>stop.status!=='pending');const locked=busy||pending||stale;
 function sendReturn(event:FormEvent){event.preventDefault();if(route)void act('submit_route_return',()=>submitRouteReturn(route.id,Number(odometer),Number(returned),Number(loss),reason||null,actor));}
 return <section className="driver-page"><h1>Minha rota</h1><p className="driver-online">Esta operação precisa de internet.</p><details className="driver-tools" open={stale||pending||!!error||undefined}><summary>Dia e atualização da rota</summary><div className="week-toolbar"><label>Dia da rota<input type="date" aria-label="Dia da rota" value={date} disabled={locked} onChange={event=>{setDate(event.target.value);history.replaceState(null,'',`/entregas?dia=${event.target.value}`);}}/></label><button className="secondary" disabled={busy} onClick={recover}>Verificar e atualizar rota</button></div>{route&&<><p>Carga: {route.loadEggs} ovos · No veículo: {route.vehicleEggs} ovos</p>{route.lastConfirmedAt&&<p>Último registro: {new Date(route.lastConfirmedAt).toLocaleString('pt-BR')}</p>}</>}{route?.initialOdometerKm!==null&&route?.initialOdometerKm!==undefined&&<p>Quilometragem inicial: {route.initialOdometerKm} km</p>}</details>
 {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}{pending&&<p role="alert">Envio ainda não confirmado. Verifique antes de registrar outra ação. Não feche este navegador.</p>}{loading?<p role="status">Carregando rota…</p>:!route?<p>Nenhuma rota atribuída para este dia.</p>:<>
 <p className="driver-route-status">{statuses[route.status]}</p>
 {route.status==='draft'&&route.stops.some(stop=>stop.kind==='customer')&&<p>Aguarde a dona confirmar a carga para iniciar.</p>}

 {(route.status==='ready'||route.status==='draft'&&!route.stops.some(stop=>stop.kind==='customer'))&&<form onSubmit={event=>{event.preventDefault();void act('start_route',()=>startRoute(route,Number(odometer),actor));}}><label>Quilometragem inicial do painel<input required type="number" inputMode="numeric" min="0" max="2147483647" step="1" value={odometer} onChange={event=>setOdometer(event.target.value)}/></label><button disabled={locked}>{busy?'Registrando…':'Iniciar rota'}</button></form>} {['draft','ready'].includes(route.status)&&<details className="driver-preview"><summary>Ver paradas previstas ({route.stops.length})</summary><ol className="driver-list">{route.stops.map(item=><li key={item.id}><h3>{item.customerName}</h3><p>{item.address||'Endereço pendente'}</p>{item.items.map((product,index)=><p key={index}>{product.trays} {product.trays===1?'bandeja':'bandejas'} de {product.eggsPerTray}</p>)}</li>)}</ol></details>}
 {route.status==='in_progress'&&<><p className="driver-progress">{route.stops.filter(stop=>stop.status!=='pending').length} de {route.stops.length} paradas resolvidas</p>
 {list?<><h2 ref={listTitle} tabIndex={-1}>Lista da rota</h2><ol className="driver-list">{route.stops.map(stop=><li key={stop.id}><button className="secondary" disabled={locked} onClick={()=>{setSelected(stop.id);setList(false);}}>{stop.position}. {stop.customerName} — {stop.status==='pending'?'Pendente':stop.status==='delivered'?'Entregue':stop.status==='not_delivered'?'Não entregue':'Concluída'}</button></li>)}</ol></>:stop&&<StopPage key={stop.id} stop={stop} busy={locked} onList={()=>setList(true)} onRecord={async(result,reason)=>{await act(result==='completed'?'record_operational_stop':'record_delivery',()=>result==='completed'?recordOperationalStop(stop.id,actor):recordDelivery(stop.id,result,reason,actor),stop.id);}}/>}
 {resolved&&<form className="driver-return" onSubmit={sendReturn}><h2>Finalizar percurso</h2><p>Declare todos os ovos restantes. O estoque da granja só muda após conferência da dona.</p><label>Quilometragem final do painel<input required type="number" inputMode="numeric" step="1" min={route.initialOdometerKm??0} max="2147483647" value={odometer} onChange={event=>setOdometer(event.target.value)}/></label><label>Ovos que voltaram<input required type="number" inputMode="numeric" min="0" max="2147483647" step="1" value={returned} onChange={event=>setReturned(event.target.value)}/></label><label>Ovos perdidos<input required type="number" inputMode="numeric" min="0" max="2147483647" step="1" value={loss} onChange={event=>setLoss(event.target.value)}/></label><label>Motivo das perdas<textarea required={Number(loss)>0} maxLength={1000} value={reason} onChange={event=>setReason(event.target.value)}/></label><p>Diferença a conferir: {route.vehicleEggs-Number(returned)-Number(loss)} ovos</p><button disabled={locked||route.vehicleEggs!==Number(returned)+Number(loss)}>{busy?'Registrando…':'Enviar para conferência'}</button></form>}</>}
 {route.status==='awaiting_reconciliation'&&<><p>Percurso finalizado; aguardando conferência da dona.</p><p>Retorno declarado: {route.declaredReturnEggs} ovos. Perdas declaradas: {route.declaredLossEggs} ovos.</p></>}
 {route.status==='closed'&&<p>Rota encerrada após conferência da dona.</p>}{route.status==='cancelled'&&<p>Rota cancelada pela dona.</p>}
 </>}
 </section>;
}
