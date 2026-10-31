import {useEffect,useState} from 'react';
import {today} from '../orders/api';
import {formatCents} from '../finance/types';
import {loadFinancialSummary,type FinancialSummary} from '../finance/reports';
import {loadDashboardSummary,type DashboardSummary} from './api';
import './dashboard.css';
export function monthRange(month:string){
 if(!/^\d{4}-\d{2}$/.test(month))throw Error('Mês inválido');
 const [year,value]=month.split('-').map(Number);
 if(value<1||value>12)throw Error('Mês inválido');
 return {from:`${month}-01`,to:`${month}-${new Date(Date.UTC(year,value,0)).getUTCDate()}`};
}
const hour=(value:string)=>new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Recife',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date(value));
export default function DashboardPage(){
 const [day,setDay]=useState(today),[month,setMonth]=useState(()=>today().slice(0,7)),[tick,setTick]=useState(0);
 const [data,setData]=useState<{key:string;route:DashboardSummary;money:FinancialSummary;updatedAt:string}|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 const range=monthRange(month),key=`${day}:${month}`;
 useEffect(()=>{
  let active=true;let running=false;
  async function refresh(){if(running)return;running=true;setLoading(true);try{const [route,money]=await Promise.all([loadDashboardSummary(day),loadFinancialSummary(range.from,range.to)]);if(active){setData({key,route,money,updatedAt:new Date().toISOString()});setError('');}}catch{if(active)setError('Não foi possível atualizar. Tente novamente com internet.');}finally{running=false;if(active)setLoading(false);}}
  void refresh();const timer=window.setInterval(()=>{if(!document.hidden)void refresh();},30000);
  return()=>{active=false;window.clearInterval(timer);};
 },[key,tick]);
 const shown=data?.key===key?data:null;
 return <section className="dashboard-page"><div className="page-heading"><div><h1>Visão geral</h1><p>Acompanhe as entregas de hoje e o dinheiro do mês.</p></div><button className="secondary" disabled={loading} onClick={()=>setTick(value=>value+1)}>Atualizar visão geral</button></div>
 {error&&<p role="alert">{error}{shown&&` Exibindo dados de ${hour(shown.updatedAt)}.`}</p>}
 <div className="dashboard-filters"><label>Dia da operação<input type="date" value={day} onChange={event=>{if(event.target.value)setDay(event.target.value);}}/></label><label>Mês financeiro<input type="month" value={month} onChange={event=>{if(event.target.value)setMonth(event.target.value);}}/></label></div>
 {!shown?<p role="status">Carregando visão geral…</p>:<><section className="dashboard-today" aria-labelledby="today-heading"><div className="page-heading"><h2 id="today-heading">Hoje · {new Date(`${day}T12:00:00-03:00`).toLocaleDateString('pt-BR')}</h2><p>Atualizado às {hour(shown.updatedAt)}</p></div>
 {!shown.route.route?<div className="dashboard-empty"><p>Nenhuma rota para este dia.</p><a href="/pedidos">Preparar semana</a><details><summary>Vai iniciar a operação?</summary><ol><li><a href="/configuracoes">Confira veículo, produtos e preços nas configurações.</a></li><li><a href="/clientes">Cadastre ou importe os clientes e seus pedidos padrão.</a></li><li><a href="/pedidos">Prepare a semana e confira pedidos e rotas.</a></li></ol></details></div>:<><h3>{shown.route.route.name}</h3><p className="route-status">{shown.route.route.status==='awaiting_reconciliation'?'Aguardando conferência':shown.route.route.status==='closed'?'Rota encerrada':shown.route.route.status==='in_progress'?'Em andamento':shown.route.route.status==='ready'?'Pronta para sair':shown.route.route.status==='cancelled'?'Cancelada':'Em preparação'}</p>
 {shown.route.total>0?<><p className="delivery-total"><strong>{shown.route.delivered} de {shown.route.total}</strong> entregas realizadas</p><progress aria-label="Entregas realizadas" value={shown.route.delivered} max={shown.route.total}/><p>{shown.route.pending} pendentes · {shown.route.notDelivered} não entregues</p></>:<p>{shown.route.operationalCompleted} de {shown.route.operationalTotal} paradas operacionais concluídas. Esta rota não gera vendas.</p>}
 <a href={`/entregas?dia=${day}`}>Ver rota deste dia</a>
 {shown.route.route.nextStop&&<div className="dashboard-next-stop"><p>Próxima parada prevista</p><h3>{shown.route.route.nextStop.name}</h3></div>}
 {shown.route.route.lastConfirmedAt&&<p>Última confirmação recebida às {hour(shown.route.route.lastConfirmedAt)}. Sem rastreamento GPS.</p>}</>}
 </section>
 <section className={`dashboard-attention ${shown.route.notDelivered||shown.route.pendingReconciliations||shown.money.receivablesCents?'has-attention':''}`} aria-labelledby="attention-heading"><h2 id="attention-heading">Precisa de atenção</h2><ul>
 {shown.route.notDelivered>0&&<li><a href={`/entregas?dia=${day}&estado=not_delivered`}>{shown.route.notDelivered} entregas não realizadas</a></li>}
 {shown.route.pendingReconciliations>0&&<li><a href="/conferencias">{shown.route.pendingReconciliations} retornos aguardando conferência</a></li>}
 {shown.money.receivablesCents>0&&<li><a href={`/financeiro?aba=clientes&ate=${range.to}`}>Valores a receber até {new Date(`${range.to}T12:00:00-03:00`).toLocaleDateString('pt-BR')}: {formatCents(shown.money.receivablesCents)}</a></li>}
 {!shown.route.notDelivered&&!shown.route.pendingReconciliations&&!shown.money.receivablesCents&&<li>Nenhuma pendência identificada nos registros consultados.</li>}</ul></section>
 <section className="dashboard-money" aria-labelledby="money-heading"><div className="page-heading"><h2 id="money-heading">Dinheiro do mês</h2><a href="/financeiro">Ver financeiro</a></div><dl className="money-totals"><div><dt>Recebido</dt><dd data-testid="month-received">{formatCents(shown.money.receivedCents)}</dd></div><div><dt>Despesas pagas</dt><dd data-testid="month-expenses">{formatCents(shown.money.paidExpensesCents)}</dd></div><div><dt>Saldo do período</dt><dd data-testid="month-cash">{formatCents(shown.money.cashChangeCents)}</dd></div></dl><p>Recebimentos menos despesas pagas. Não representa saldo bancário nem lucro.</p></section>
 <section className="dashboard-stock"><h2>Estoque disponível</h2><p><strong>{shown.route.farmEggs} ovos</strong> na granja · <strong>{shown.route.vehicleEggs} ovos</strong> no veículo</p><a href="/estoque">Conferir estoque</a></section></>}
 </section>;
}
