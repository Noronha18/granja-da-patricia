import {timestampForBusinessDate} from '../../lib/businessDate';
import { useEffect, useState, type FormEvent } from 'react';
import { useSession } from '../../app/Session';
import { formatCents, parseBrlToCents, parseEggCount, type StockBalance, type StockEvent, type StockSnapshot } from '../finance/types';
import { loadStock, recoverStockRequest, recordStockEvent, setRemainingStockCost, type StockEventInput, type StockOperation } from './api';

const pendingKey = (actorId: string) => `granja:${actorId}:stock-request`;
const pendingOperationKey = (actorId: string) => `granja:${actorId}:stock-request-operation`;
const validRequestId = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Recife' }).format(new Date());
const eventNames: Record<StockEvent['kind'], string> = {
  opening: 'Abertura', purchase: 'Compra', loss: 'Perda', adjustment: 'Ajuste',
  load: 'Carga', return: 'Retorno', sale: 'Entrega', cost_regularization: 'Custo regularizado',
};

function integerField(value: string, label: string) {
  try { return parseEggCount(value); }
  catch { throw new Error(`Confira ${label.toLowerCase()}: informe ovos inteiros e positivos.`); }
}

function friendlyError(error: unknown) {
  const failure = error as { code?: string; message?: string };
  const text = `${failure?.message ?? ''} ${failure?.code ?? ''}`;
  if (text.includes('INSUFFICIENT_STOCK')) return 'A quantidade é maior que o estoque disponível na granja.';
  if (text.includes('BACKDATED_STOCK')) return 'A data é anterior a outro movimento. Registre a correção com a data atual e um motivo.';
  if (text.includes('OPENING_LOCKED')) return 'A abertura já foi usada. Registre uma entrada ou ajuste atual com motivo.';
  if (text.includes('PURCHASE_COST_REQUIRED')) return 'Informe o custo total pago pela compra.';
  if (text.includes('REASON_REQUIRED')) return 'Informe o motivo para esta perda ou ajuste.';
  if (text.includes('COST_ALREADY_KNOWN_OR_EMPTY')) return 'Este saldo está vazio ou já tem custo atribuído. Atualize a tela.';
  if (text.includes('AMOUNT_OUT_OF_RANGE')) return 'A quantidade ou o valor excede o limite permitido.';
  if (text.includes('REQUEST_CLOSED') || failure?.code === '55000') return 'A tentativa anterior foi encerrada sem salvar. Confira os dados e registre novamente.';
  if (text.includes('FORBIDDEN') || failure?.code === '42501') return 'Seu perfil não pode alterar o estoque.';
  if (failure?.code === 'PT409') return 'O estoque mudou em outra sessão. Atualize os saldos e confira antes de tentar novamente.';
  return 'Não foi possível salvar o movimento. Confira os dados e tente novamente.';
}

function balanceFor(balances: StockBalance[], location: 'farm' | 'vehicle') {
  return balances.filter(balance => balance.location === location);
}

function totalEggs(balances: StockBalance[]) {
  return balances.reduce((total, balance) => total + balance.eggs, 0);
}

function costSummary(balances: StockBalance[]) {
  if (!balances.length || balances.every(balance => balance.eggs === 0)) return 'Sem custo atribuído a saldo disponível';
  if (balances.some(balance => balance.eggs > 0 && balance.total_cost_cents === null)) return 'Custo desconhecido para parte ou todo este saldo';
  const cents = balances.reduce((total, balance) => total + (balance.total_cost_cents ?? 0), 0);
  return `Custo atribuído: ${formatCents(cents)}`;
}

function recentLabel(event: StockEvent) {
  const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'America/Recife' }).format(new Date(event.effective_at));
  const direction = event.direction === 'in' ? 'entrada' : event.direction === 'out' ? 'saída' : 'custo';
  const quantity = event.eggs > 0 ? ` · ${event.eggs} ovos` : '';
  return `${eventNames[event.kind]} · ${direction}${quantity} · ${date}`;
}

export default function StockPage() {
  const { role, userId } = useSession();
  const actorId = userId ?? '';
  const key = pendingKey(actorId);
  const operationKey = pendingOperationKey(actorId);
  const [snapshot, setSnapshot] = useState<StockSnapshot>({ balances: [], recentEvents: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pendingId, setPendingId] = useState(() => actorId ? sessionStorage.getItem(key) ?? '' : '');
  const [pendingOperation, setPendingOperation] = useState<StockOperation | ''>(() => {
    const operation = actorId ? sessionStorage.getItem(operationKey) : null;
    return operation === 'record_stock_event' || operation === 'set_remaining_stock_cost' ? operation : '';
  });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [entryKind, setEntryKind] = useState<'opening' | 'purchase'>('opening');
  const [entryEggs, setEntryEggs] = useState('');
  const [entryCost, setEntryCost] = useState('');
  const [entryDate, setEntryDate] = useState(localToday);
  const [lossEggs, setLossEggs] = useState('');
  const [lossReason, setLossReason] = useState('');
  const [lossDate, setLossDate] = useState(localToday);
  const [adjustDirection, setAdjustDirection] = useState<'in' | 'out'>('in');
  const [adjustEggs, setAdjustEggs] = useState('');
  const [adjustCost, setAdjustCost] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [adjustDate, setAdjustDate] = useState(localToday);
  const [regularizeLocation, setRegularizeLocation] = useState<'farm' | 'vehicle'>('farm');
  const [regularizeCost, setRegularizeCost] = useState('');
  const [regularizeReason, setRegularizeReason] = useState('');

  async function refresh() {
    const result = await loadStock();
    setSnapshot(result);
  }

  useEffect(() => {
    if (actorId) {
      setPendingId(sessionStorage.getItem(key) ?? '');
      const operation = sessionStorage.getItem(operationKey);
      setPendingOperation(operation === 'record_stock_event' || operation === 'set_remaining_stock_cost' ? operation : '');
    }
  }, [actorId, key, operationKey]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadStock().then(data => { if (active) setSnapshot(data); })
      .catch(() => { if (active) setError('Não foi possível carregar o estoque. Tente atualizar.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  function clearPending() {
    sessionStorage.removeItem(key);
    sessionStorage.removeItem(operationKey);
    setPendingId('');
    setPendingOperation('');
  }

  async function resolvePending() {
    const requestId = sessionStorage.getItem(key);
    const operation = sessionStorage.getItem(operationKey);
    if (!requestId || !validRequestId(requestId) || (operation !== 'record_stock_event' && operation !== 'set_remaining_stock_cost')) {
      setPendingId(requestId ?? '');
      setPendingOperation('');
      throw new Error('A tentativa preservada está incompleta e precisa de suporte para ser conferida.');
    }
    const result = await recoverStockRequest(requestId, operation);
    clearPending();
    if (result.status === 'saved') {
      setMessage('Movimento registrado. O saldo foi atualizado.');
      try { await refresh(); }
      catch { setError('Movimento registrado, mas não foi possível atualizar os saldos. Use Atualizar estoque.'); }
    } else {
      setMessage('Tentativa anterior encerrada sem salvar. Confira os dados e registre novamente.');
    }
  }

  async function retryPending() {
    setBusy(true); setError(''); setMessage('');
    try { await resolvePending(); }
    catch { setError('Não foi possível confirmar o envio anterior. A tentativa foi preservada; tente verificar novamente.'); }
    finally { setBusy(false); }
  }

  async function submitEvent(event: FormEvent<HTMLFormElement>, makeEvent: () => StockEventInput) {
    event.preventDefault(); setError(''); setMessage('');
    if (pendingId || sessionStorage.getItem(key)) {
      setPendingId(sessionStorage.getItem(key) ?? pendingId);
      setError('Confirme o resultado da tentativa anterior antes de registrar outro movimento.');
      return;
    }
    let payload: StockEventInput;
    try { payload = makeEvent(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Confira os dados informados.'); return; }
    const requestId = crypto.randomUUID();
    sessionStorage.setItem(key, requestId);
    sessionStorage.setItem(operationKey, 'record_stock_event');
    setPendingId(requestId); setPendingOperation('record_stock_event'); setBusy(true);
    try {
      await recordStockEvent(payload, requestId);
      clearPending();
      setMessage('Movimento registrado.');
      try { await refresh(); }
      catch { setError('Movimento registrado, mas não foi possível atualizar os saldos. Use Atualizar estoque.'); }
      if (payload.kind === 'opening' || payload.kind === 'purchase') { setEntryEggs(''); setEntryCost(''); }
      if (payload.kind === 'loss') { setLossEggs(''); setLossReason(''); }
      if (payload.kind === 'adjustment') { setAdjustEggs(''); setAdjustCost(''); setAdjustReason(''); }
    } catch (reason) {
      const code = (reason as { code?: string })?.code;
      if (code && /^[0-9A-Z]{5}$/.test(code)) clearPending();
      setError(code && /^[0-9A-Z]{5}$/.test(code)
        ? friendlyError(reason)
        : 'Não foi possível confirmar o envio. A tentativa foi preservada; verifique o resultado antes de continuar.');
    } finally { setBusy(false); }
  }

  async function submitCost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setMessage('');
    if (pendingId || sessionStorage.getItem(key)) {
      setPendingId(sessionStorage.getItem(key) ?? pendingId);
      setError('Confirme o resultado da tentativa anterior antes de registrar outro movimento.');
      return;
    }
    let cents: number;
    const allowedLocations = (['farm', 'vehicle'] as const).filter(location =>
      snapshot.balances.some(balance => balance.location === location && balance.eggs > 0 && balance.total_cost_cents === null));
    const location = allowedLocations.includes(regularizeLocation) ? regularizeLocation : allowedLocations[0];
    try {
      if (!location) throw new Error('Atualize o estoque para conferir onde há custo desconhecido.');
      cents = parseBrlToCents(regularizeCost);
      if (!regularizeReason.trim()) throw new Error('Informe o motivo da regularização.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Confira os dados informados.'); return; }
    const requestId = crypto.randomUUID();
    sessionStorage.setItem(key, requestId); sessionStorage.setItem(operationKey, 'set_remaining_stock_cost');
    setPendingId(requestId); setPendingOperation('set_remaining_stock_cost'); setBusy(true);
    try {
      await setRemainingStockCost(location, cents, regularizeReason.trim(), requestId);
      clearPending(); setRegularizeCost(''); setRegularizeReason('');
      setMessage('Custo do saldo restante registrado. Movimentos anteriores não foram alterados.');
      try { await refresh(); }
      catch { setError('Custo registrado, mas não foi possível atualizar os saldos. Use Atualizar estoque.'); }
    } catch (reason) {
      const code = (reason as { code?: string })?.code;
      if (code && /^[0-9A-Z]{5}$/.test(code)) clearPending();
      setError(code && /^[0-9A-Z]{5}$/.test(code)
        ? friendlyError(reason)
        : 'Não foi possível confirmar o envio. A tentativa foi preservada; verifique o resultado antes de continuar.');
    } finally { setBusy(false); }
  }

  const farm = balanceFor(snapshot.balances, 'farm');
  const vehicle = balanceFor(snapshot.balances, 'vehicle');
  const unknownCostLocations = (['farm', 'vehicle'] as const).filter(location =>
    snapshot.balances.some(balance => balance.location === location && balance.eggs > 0 && balance.total_cost_cents === null));
  const selectedRegularizeLocation = unknownCostLocations.includes(regularizeLocation) ? regularizeLocation : unknownCostLocations[0];
  const pending = Boolean(pendingId || (actorId && sessionStorage.getItem(key)));
  const pendingCanBeVerified = validRequestId(pendingId) && (pendingOperation === 'record_stock_event' || pendingOperation === 'set_remaining_stock_cost');
  const disabled = busy || pending;

  if (role !== 'owner') return <section><h1>Acesso não permitido</h1><p>Seu perfil não pode consultar o estoque.</p></section>;

  return <section className="stock-page">
    <div className="page-heading"><div><h1>Estoque</h1><p>Confira os ovos disponíveis na granja e os que estão no veículo.</p></div>
      <button className="secondary" disabled={busy || loading} onClick={async () => { setBusy(true); setError(''); try { await refresh(); } catch { setError('Não foi possível atualizar o estoque. Tente novamente.'); } finally { setBusy(false); } }}>Atualizar estoque</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {pending && <div className="stock-pending"><p>Um envio ainda precisa ser confirmado. Nenhum movimento novo pode ser iniciado até verificar o resultado.</p>{!pendingCanBeVerified && <p role="alert">Os dados locais da tentativa estão incompletos. Nenhum novo movimento será iniciado; solicite ajuda da dona para conferir o registro.</p>}<button disabled={busy || !pendingCanBeVerified} onClick={retryPending}>{busy ? 'Verificando…' : 'Verificar envio anterior'}</button></div>}
    {loading ? <p role="status">Carregando saldos…</p> : <dl className="stock-balances">
      <div><dt>Ovos disponíveis na granja</dt><dd data-testid="farm-eggs">{totalEggs(farm)} ovos</dd><small>{costSummary(farm)}</small></div>
      <div><dt>Ovos no veículo</dt><dd>{totalEggs(vehicle)} ovos</dd><small>{costSummary(vehicle)}</small></div>
    </dl>}

    <div className="stock-actions">
      <section className="stock-action" aria-labelledby="stock-entry-title">
        <h2 id="stock-entry-title">Registrar entrada na granja</h2>
        <p>A abertura informa o saldo inicial. Compra também registra a saída paga no financeiro.</p>
        <form onSubmit={event => submitEvent(event, () => {
          const costCents = entryCost.trim() ? parseBrlToCents(entryCost) : undefined;
          if (entryKind === 'purchase' && costCents === undefined) throw new Error('Informe o custo total pago pela compra.');
          return { kind: entryKind, location: 'farm', eggs: integerField(entryEggs, 'quantidade'), effectiveAt: timestampForBusinessDate(entryDate), ...(costCents === undefined ? {} : { costCents }) };
        })}>
          <label>Tipo de entrada<select disabled={disabled} value={entryKind} onChange={event => setEntryKind(event.target.value as 'opening' | 'purchase')}><option value="opening">Saldo de abertura</option><option value="purchase">Compra paga</option></select></label>
          <label>Quantidade em ovos<input disabled={disabled} value={entryEggs} onChange={event => setEntryEggs(event.target.value)} inputMode="numeric" pattern="[0-9]+" required /></label>
          <label>Custo total (R$)<input disabled={disabled} value={entryCost} onChange={event => setEntryCost(event.target.value)} inputMode="decimal" placeholder={entryKind === 'purchase' ? '300,00' : 'Se conhecido'} required={entryKind === 'purchase'} /></label>
          <p className="stock-help">Na abertura, deixe o custo em branco se ele não for conhecido. Custo desconhecido não vira zero.</p>
          <label>Data do movimento<input disabled={disabled} type="date" value={entryDate} onChange={event => setEntryDate(event.target.value)} required /></label>
          <button disabled={disabled}>Registrar entrada</button>
        </form>
      </section>

      <section className="stock-action" aria-labelledby="stock-loss-title">
        <h2 id="stock-loss-title">Registrar perda na granja</h2>
        <p>Informe a quantidade e o motivo. Perdas no veículo são conferidas no retorno da rota.</p>
        <form onSubmit={event => submitEvent(event, () => ({ kind: 'loss', location: 'farm', eggs: integerField(lossEggs, 'quantidade perdida'), effectiveAt: timestampForBusinessDate(lossDate), reason: lossReason.trim() }))}>
          <label>Quantidade perdida em ovos<input disabled={disabled} value={lossEggs} onChange={event => setLossEggs(event.target.value)} inputMode="numeric" pattern="[0-9]+" required /></label>
          <label>Motivo da perda<textarea disabled={disabled} value={lossReason} onChange={event => setLossReason(event.target.value)} maxLength={1000} required /></label>
          <p className="stock-help">Não inclua nomes, telefones ou outros dados pessoais no motivo.</p>
          <label>Data do movimento<input disabled={disabled} type="date" value={lossDate} onChange={event => setLossDate(event.target.value)} required /></label>
          <button disabled={disabled}>Registrar perda</button>
        </form>
      </section>

      <section className="stock-action" aria-labelledby="stock-adjust-title">
        <details className="stock-adjust-details">
          <summary><h2 id="stock-adjust-title">Ajustar saldo da granja</h2><span>Disponível após conferência física</span></summary>
          <p>Use somente após conferir fisicamente a diferença. O ajuste exige motivo.</p>
        <form onSubmit={event => submitEvent(event, () => {
          const costCents = adjustDirection === 'in' && adjustCost.trim() ? parseBrlToCents(adjustCost) : undefined;
          return { kind: 'adjustment', location: 'farm', direction: adjustDirection, eggs: integerField(adjustEggs, 'quantidade'), effectiveAt: timestampForBusinessDate(adjustDate), reason: adjustReason.trim(), ...(costCents === undefined ? {} : { costCents }) };
        })}>
          <label>Tipo de ajuste<select disabled={disabled} value={adjustDirection} onChange={event => setAdjustDirection(event.target.value as 'in' | 'out')}><option value="in">Aumentar saldo</option><option value="out">Diminuir saldo</option></select></label>
          <label>Quantidade no ajuste em ovos<input disabled={disabled} value={adjustEggs} onChange={event => setAdjustEggs(event.target.value)} inputMode="numeric" pattern="[0-9]+" required /></label>
          {adjustDirection === 'in' && <label>Custo total do ajuste (R$), se conhecido<input disabled={disabled} value={adjustCost} onChange={event => setAdjustCost(event.target.value)} inputMode="decimal" /></label>}
          <label>Motivo do ajuste<textarea disabled={disabled} value={adjustReason} onChange={event => setAdjustReason(event.target.value)} maxLength={1000} required /></label>
          <p className="stock-help">Não inclua nomes, telefones ou outros dados pessoais no motivo.</p>
          <label>Data do movimento<input disabled={disabled} type="date" value={adjustDate} onChange={event => setAdjustDate(event.target.value)} required /></label>
          <button disabled={disabled}>Registrar ajuste</button>
        </form>
        </details>
      </section>

      {unknownCostLocations.length > 0 && <section className="stock-action" aria-labelledby="stock-cost-title">
        <h2 id="stock-cost-title">Regularizar custo do saldo restante</h2>
        <p>O custo passa a valer para os próximos movimentos. Vendas e perdas anteriores continuam sem custo conhecido.</p>
        <form onSubmit={submitCost}>
          <label>Local do saldo<select disabled={disabled} value={selectedRegularizeLocation} onChange={event => setRegularizeLocation(event.target.value as 'farm' | 'vehicle')}>
            {unknownCostLocations.map(location => <option key={location} value={location}>{location === 'farm' ? 'Granja' : 'Veículo'}</option>)}
          </select></label>
          <label>Custo total do saldo restante (R$)<input disabled={disabled} value={regularizeCost} onChange={event => setRegularizeCost(event.target.value)} inputMode="decimal" placeholder="Informe o valor" required /></label>
          <label>Motivo da regularização<textarea disabled={disabled} value={regularizeReason} onChange={event => setRegularizeReason(event.target.value)} maxLength={1000} required /></label>
          <p className="stock-help">Não inclua nomes, telefones ou outros dados pessoais no motivo.</p>
          <button disabled={disabled}>Registrar custo restante</button>
        </form>
      </section>}
    </div>

    <section className="stock-history" aria-labelledby="stock-history-title">
      <div className="page-heading"><div><h2 id="stock-history-title">Movimentos recentes</h2><p>As entradas, perdas e correções aparecem na data efetiva registrada.</p></div></div>
      {snapshot.recentEvents.length === 0 ? <p>Nenhum movimento de estoque registrado.</p> : <ul>{snapshot.recentEvents.map(event => <li key={event.id}>{recentLabel(event)}</li>)}</ul>}
    </section>
  </section>;
}
