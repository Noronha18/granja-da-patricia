import { useEffect, useState, type FormEvent } from 'react';
import { calculateTotals } from '../orders/totals';
import { listCustomers, loadCustomer, loadProducts, recoverCustomerRequest, saveCustomer, saveProduct, type Customer, type CustomerDetails, type CustomerWrite, type Product } from './api';
const currency = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const days = ['', '', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira'];
const pendingKey = 'granja:customer-request';
type Draft = {id:string;version:number;name:string;address:string;phone:string;notes:string;reviewPending:boolean;sourceDetails:CustomerDetails['source_details'];active:boolean;weekday:string;position:string;quantities:Record<string,string>;prices:Record<string,string>};
const newDraft = ():Draft => ({id:crypto.randomUUID(),version:0,name:'',address:'',phone:'',notes:'',reviewPending:false,sourceDetails:{},active:true,weekday:'',position:'',quantities:{},prices:{}});
const decimal = (cents:number) => (cents/100).toFixed(2).replace('.',',');
function cents(value:string) {
 if(!/^\d+([,.]\d{1,2})?$/.test(value.trim())) throw Error('Informe o preço em reais, por exemplo 30,00.');
 const [whole,fraction='']=value.trim().replace(',','.').split('.');const result=Number(whole)*100+Number(fraction.padEnd(2,'0'));
 if(!Number.isSafeInteger(result)||result>2147483647) throw Error('Preço fora da faixa permitida.');return result;
}
function integer(value:string,label:string,allowZero=false) {
 if(!/^\d+$/.test(value)||Number(value)>(2147483647)||Number(value)<(allowZero?0:1)) throw Error(`${label}: informe um número inteiro válido.`);return Number(value);
}
function fromCustomer(customer:CustomerDetails):Draft {
 return {id:customer.id,version:customer.version,name:customer.name,address:customer.address,phone:customer.phone??'',notes:customer.notes,reviewPending:customer.review_pending,sourceDetails:customer.source_details,active:customer.active,weekday:customer.weekday===null?'':String(customer.weekday),position:String(customer.position),quantities:Object.fromEntries(customer.items.map(item=>[item.product_id,String(item.trays)])),prices:Object.fromEntries(customer.prices.map(price=>[price.product_id,decimal(price.price_cents)]))};
}
function write(draft:Draft,products:Product[]):CustomerWrite {
 const items=products.filter(p=>draft.quantities[p.id] && draft.quantities[p.id]!=='0').map(p=>({productId:p.id,trays:integer(draft.quantities[p.id],'Bandejas')}));
 const prices=products.filter(p=>draft.prices[p.id]?.trim()).map(p=>({productId:p.id,priceCents:cents(draft.prices[p.id])}));
 calculateTotals(items.map(item=>{const product=products.find(p=>p.id===item.productId)!;return {...item,eggsPerTray:product.eggs_per_tray,priceCents:prices.find(p=>p.productId===item.productId)?.priceCents??product.default_price_cents};}));
 const weekday=!draft.weekday&&draft.reviewPending&&!draft.active?null:integer(draft.weekday,'Dia da rota');
 if(weekday===null&&items.length)throw Error('Defina o dia antes de incluir pedido padrão.');
 return {id:draft.id,version:draft.version,details:{name:draft.name.trim(),address:draft.address.trim(),phone:draft.phone.trim()||null,notes:draft.notes,reviewPending:draft.reviewPending,active:draft.active,weekday,position:integer(draft.position,'Posição na rota')},items,prices};
}
function SourceDetails({value}:{value:CustomerDetails['source_details']}) {
 if(!value||typeof value!=='object'||Array.isArray(value)||!value.row)return null;
 const cells=value.cells&&typeof value.cells==='object'&&!Array.isArray(value.cells)?value.cells:{};
 const labels:Record<string,string>={B:'Marca da coluna B',C:'Marca da coluna C',D:'Nome na planilha',E:'Rua',F:'Número',G:'Complemento',H:'Bairro',I:'Cidade',J:'Telefone original',K:'Observação original',L:'INT (30 ovos)',M:'MEIA (15 ovos)',N:'Dia na planilha',O:'CEP'};
 return <details className="customer-source"><summary>Dados preservados da planilha</summary><p>Linha original: {String(value.row)}</p>{Object.entries(cells).filter(([,v])=>v!==null&&v!=='').map(([key,v])=><p key={key}>{labels[key]??`Coluna ${key}`}: {String(v)}</p>)}{Array.isArray(value.reviewReasons)&&value.reviewReasons.length>0&&<ul>{value.reviewReasons.map((reason,i)=><li key={i}>{String(reason)}</li>)}</ul>}</details>;
}
function orderSummary(customer:Customer,products:Product[]) {
 const items=products.flatMap(product=>{const item=customer.items.find(item=>item.product_id===product.id);return item?[{...item,eggs:product.eggs_per_tray}]:[];});
 if(!items.length) return 'Sem pedido padrão.';
 return `${items.map(item=>`${item.trays} ${item.trays===1?'bandeja':'bandejas'} de ${item.eggs}`).join(' + ')} · ${items.reduce((total,item)=>total+item.trays*item.eggs,0)} ovos`;
}
export default function CustomersPage() {
 const [products,setProducts]=useState<Product[]>([]);const [rows,setRows]=useState<Customer[]>([]);const [count,setCount]=useState(0);const [search,setSearch]=useState('');const [weekday,setWeekday]=useState('');const [activity,setActivity]=useState('');const [page,setPage]=useState(0);
 const [draft,setDraft]=useState<Draft|null>(null);const [error,setError]=useState('');const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);const [loading,setLoading]=useState(true);const [conflict,setConflict]=useState(false);const [catalog,setCatalog]=useState(false);
 const [attempt,setAttempt]=useState<{signature:string;id:string}|null>(null);
 async function refresh(){const result=await listCustomers(search,page,weekday,activity);setRows(result.rows);setCount(result.count);}
 async function resolvePending() {
  const requestId=sessionStorage.getItem(pendingKey);if(!requestId) return false;
  const result=await recoverCustomerRequest(requestId);
  if(result.status==='saved') {
   const customer=await loadCustomer(result.result.id);setDraft(fromCustomer(customer));setConflict(false);
   sessionStorage.removeItem(pendingKey);setAttempt(null);setMessage('Cadastro recuperado do envio anterior. Confira antes de continuar.');return true;
  }
  sessionStorage.removeItem(pendingKey);setAttempt(null);setMessage('Tentativa anterior encerrada sem salvar. Você pode conferir os dados e salvar novamente.');return false;
 }
 async function verifyPending() {
  setBusy(true);setError('');setMessage('');
  try {await resolvePending();}catch {setError('Não foi possível verificar o envio anterior. A tentativa foi preservada. Tente novamente.');}
  finally {setBusy(false);}
 }
 async function open(id?:string) {
  setBusy(true);setError('');setMessage('');
  try {if(await resolvePending()) return;setConflict(false);setDraft(id?fromCustomer(await loadCustomer(id)):newDraft());}
  catch {setError('Não foi possível verificar ou abrir o cadastro. Seu rascunho foi mantido. Tente novamente.');}
  finally {setBusy(false);}
 }
 useEffect(()=>{let active=true;setLoading(true);Promise.all([loadProducts(),listCustomers(search,page,weekday,activity)]).then(([products,result])=>{if(active){setProducts(products);setRows(result.rows);setCount(result.count);}}).catch(()=>{if(active)setError('Não foi possível carregar os cadastros. Recarregue a página.');}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[search,page,weekday,activity]);
 useEffect(()=>{if(!sessionStorage.getItem(pendingKey)) return;setBusy(true);resolvePending().catch(()=>setError('Não foi possível verificar o envio anterior. Tente novamente.')).finally(()=>setBusy(false));},[]);
 function change<K extends keyof Draft>(key:K,value:Draft[K]){setDraft(current=>current?{...current,[key]:value}:null);setMessage('');}
 async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();if(!draft)return;setError('');setMessage('');setBusy(true);
 try {
  const value=write(draft,products);const signature=JSON.stringify(value);
  if(sessionStorage.getItem(pendingKey)&&attempt?.signature!==signature&&await resolvePending()) return;
  const requestId=attempt?.signature===signature?attempt.id:crypto.randomUUID();
  setAttempt({signature,id:requestId});sessionStorage.setItem(pendingKey,requestId);
  const result=await saveCustomer(value,requestId);
  sessionStorage.removeItem(pendingKey);setAttempt(null);setDraft(current=>current?{...current,version:result.version}:null);setConflict(false);setMessage('Cliente salvo.');
  try {await refresh();}catch {setError('Cliente salvo, mas não foi possível atualizar a lista. Use Atualizar lista para tentar novamente.');}
 }
 catch(reason){const code=(reason as {code?:string}).code;if(code&&/^[0-9A-Z]{5}$/.test(code)){sessionStorage.removeItem(pendingKey);setAttempt(null);}if(code==='PT409'){setConflict(true);setError('Cadastro alterado em outra sessão. Seu rascunho foi mantido. Recarregue o cadastro antes de salvar.');}else if(code==='55000'){sessionStorage.removeItem(pendingKey);setAttempt(null);setError('Tentativa encerrada sem salvar. Confira os dados e salve novamente.');}else if(code==='22023'){setError('Confira os dados. Se este envio já foi concluído, recarregue o cadastro antes de alterar.');}else if(reason instanceof Error){setError(reason.message);}else{setError('Não foi possível confirmar o envio. Seu rascunho foi mantido; tente salvar novamente.');}}
 finally{setBusy(false);}}
 async function productSubmit(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=event.currentTarget;const data=new FormData(form);setBusy(true);setError('');try{await saveProduct({name:String(data.get('productName')).trim(),eggs_per_tray:integer(String(data.get('eggs')),'Ovos por bandeja'),default_price_cents:cents(String(data.get('price')))});setProducts(await loadProducts());setMessage('Produto salvo.');form.reset();setCatalog(false);}catch(reason){setError((reason as {code?:string}).code==='23505'?'Já existe um produto com esse tamanho de bandeja.':reason instanceof Error?reason.message:'Não foi possível salvar o produto. Confira os dados.');}finally{setBusy(false);}}
 let totals='Selecione bandejas para calcular o pedido.';
 if(draft){try{const items=products.filter(p=>draft.quantities[p.id]&&draft.quantities[p.id]!=='0').map(p=>({productId:p.id,eggsPerTray:p.eggs_per_tray,trays:integer(draft.quantities[p.id],'Bandejas'),priceCents:draft.prices[p.id]?.trim()?cents(draft.prices[p.id]):p.default_price_cents}));const result=calculateTotals(items);totals=`${result.eggs} ovos · ${currency.format(result.totalCents/100)}`;}catch{totals='Confira as quantidades e os preços para calcular o total.';}}
 return <section className="customers-page"><div className="page-heading"><div><h1>Clientes e pedidos padrão</h1><a href="/importar-clientes">Importar clientes (CSV)</a><p>Cadastre a entrega semanal e o preço combinado de cada cliente.</p></div><button onClick={()=>open()} disabled={busy}>Novo cliente</button></div>
 {error&&<p role="alert">{error}</p>}{sessionStorage.getItem(pendingKey)&&<button className="secondary" disabled={busy} onClick={verifyPending}>Verificar envio anterior</button>}{message&&<p role="status">{message}</p>}{loading&&<p role="status">Carregando cadastros…</p>}
 <div className="customers-layout"><div className="customer-list"><label>Buscar cliente<input disabled={busy} type="search" value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}} /></label><div className="field-pair customer-filters"><label>Dia<select disabled={busy} aria-label="Filtrar por dia" value={weekday} onChange={e=>{setWeekday(e.target.value);setPage(0);}}><option value="">Todos os dias</option>{[2,3,4,5].map(day=><option key={day} value={day}>{days[day]}</option>)}</select></label><label>Atividade<select disabled={busy} aria-label="Filtrar por atividade" value={activity} onChange={e=>{setActivity(e.target.value);setPage(0);}}><option value="">Todos os clientes</option><option value="active">Ativos</option><option value="inactive">Inativos</option><option value="review">Em conferência</option></select></label></div><p>{count} clientes cadastrados</p><button className="secondary" disabled={busy||loading} onClick={async()=>{setLoading(true);setError('');try{await refresh();}catch{setError('Não foi possível atualizar a lista. Tente novamente.');}finally{setLoading(false);}}}>Atualizar lista</button>
 {!loading&&!rows.length&&<p>Nenhum cliente encontrado. Use “Novo cliente” para cadastrar.</p>}
 <ul>{rows.map(customer=><li key={customer.id}><div><strong>{customer.name}</strong><p>{customer.weekday===null?'Dia a conferir':days[customer.weekday]} · posição {customer.position} · {customer.active?'Ativo':'Inativo'}</p><p>{customer.address}</p>{customer.review_pending&&<p className="customer-review">Em conferência</p>}{customer.notes&&<p className="customer-notes">{customer.notes}</p>}<p>{orderSummary(customer,products)}</p></div><button className="secondary" onClick={()=>open(customer.id)} disabled={busy} aria-label={`Editar ${customer.name}`}>Editar</button></li>)}</ul>
 <div className="pagination"><button className="secondary" disabled={page===0||busy} onClick={()=>setPage(page-1)}>Anterior</button><span>Página {page+1} de {Math.max(1,Math.ceil(count/50))}</span><button className="secondary" disabled={(page+1)*50>=count||busy} onClick={()=>setPage(page+1)}>Próxima</button></div></div>
 {draft&&<form className="customer-editor" onSubmit={submit}><h2>{draft.version?'Editar cliente':'Novo cliente'}</h2><p>Alterações valem para as próximas semanas geradas. Pedidos já gerados mantêm os dados anteriores.</p>
 <label>Nome do cliente<input disabled={busy} value={draft.name} onChange={e=>change('name',e.target.value)} required maxLength={160} autoComplete="name" /></label>
 <label>Endereço<textarea disabled={busy} aria-label="Endereço" value={draft.address} onChange={e=>change('address',e.target.value)} required maxLength={500} autoComplete="street-address" /></label>
 <label>Telefone<input disabled={busy} value={draft.phone} onChange={e=>change('phone',e.target.value)} type="tel" maxLength={40} autoComplete="tel" /></label>
 <label>Observações do cadastro<textarea disabled={busy} aria-label="Observações do cadastro" value={draft.notes} onChange={e=>change('notes',e.target.value)} maxLength={10000} /></label><p>Observações visíveis somente na administração.</p>
 <SourceDetails value={draft.sourceDetails} />
 {draft.reviewPending&&<p className="customer-review">Cadastro em conferência. Confira os dados antes de ativar ou incluir nas entregas.</p>}
 {(draft.reviewPending||(draft.sourceDetails&&typeof draft.sourceDetails==='object'&&!Array.isArray(draft.sourceDetails)&&draft.sourceDetails.row))&&<label className="checkbox"><input disabled={busy} type="checkbox" checked={!draft.reviewPending} onChange={e=>{const reviewed=e.target.checked;setDraft(current=>current?{...current,reviewPending:!reviewed,active:reviewed?current.active:false}:null);setMessage('');}} />Cadastro conferido</label>}
 <div className="field-pair"><label>Dia da rota<select disabled={busy} aria-label="Dia da rota" value={draft.weekday} onChange={e=>change('weekday',e.target.value)} required={!draft.reviewPending||draft.active}><option value="">Selecione o dia</option>{[2,3,4,5].map(day=><option key={day} value={day}>{days[day]}</option>)}</select></label><label>Posição na rota<input disabled={busy} inputMode="numeric" pattern="[0-9]+" value={draft.position} onChange={e=>change('position',e.target.value)} required /></label></div>
 <label className="checkbox"><input disabled={busy||draft.reviewPending} type="checkbox" checked={draft.active} onChange={e=>change('active',e.target.checked)} />Cliente ativo</label>
 <fieldset><legend>Pedido padrão</legend><p>Deixe bandejas em branco para não incluir. Preço combinado em branco usa o preço padrão.</p>{products.map(product=><div className="product-fields" key={product.id}><h3>{product.name}</h3><p>{product.eggs_per_tray} ovos por bandeja · padrão {currency.format(product.default_price_cents/100)}</p><div className="field-pair"><label>Bandejas — {product.name}<input disabled={busy} inputMode="numeric" pattern="[0-9]*" value={draft.quantities[product.id]??''} onChange={e=>change('quantities',{...draft.quantities,[product.id]:e.target.value})} /></label><label>Preço combinado — {product.name} (R$)<input disabled={busy} inputMode="decimal" placeholder={decimal(product.default_price_cents)} value={draft.prices[product.id]??''} onChange={e=>change('prices',{...draft.prices,[product.id]:e.target.value})} /></label></div></div>)}</fieldset>
 <p className="order-total" aria-live="polite">{totals}</p><button type="submit" disabled={busy||conflict||loading}>{busy?'Salvando…':'Salvar cliente'}</button>{conflict&&<button type="button" className="secondary" onClick={()=>open(draft.id)} disabled={busy}>Recarregar cadastro</button>}<button type="button" className="secondary" onClick={()=>setDraft(null)} disabled={busy}>Fechar edição</button></form>}
 </div><section className="catalog"><div className="page-heading"><div><h2>Catálogo</h2><p>Um produto por tamanho de bandeja. Valores em reais.</p></div><button className="secondary" onClick={()=>setCatalog(!catalog)} disabled={busy}>{catalog?'Fechar cadastro de produto':'Cadastrar produto'}</button></div><ul>{products.map(product=><li key={product.id}><strong>{product.name}</strong><span>{product.eggs_per_tray} ovos · {currency.format(product.default_price_cents/100)}</span></li>)}</ul>
 {catalog&&<form onSubmit={productSubmit} className="product-editor"><label>Nome do produto<input disabled={busy} name="productName" required maxLength={160} /></label><div className="field-pair"><label>Ovos por bandeja<input disabled={busy} name="eggs" inputMode="numeric" pattern="[0-9]+" required /></label><label>Preço padrão (R$)<input disabled={busy} name="price" inputMode="decimal" placeholder="33,00" required /></label></div><button disabled={busy}>Salvar produto</button></form>}</section></section>;
}
