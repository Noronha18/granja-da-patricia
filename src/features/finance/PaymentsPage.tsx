import {timestampForBusinessDate} from '../../lib/businessDate';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSession } from '../../app/Session';
import { formatCents, parseBrlToCents } from './types';
import Receipts from './Receipts';
import {
  correctPayment, getReceiptDownload, isRequestUuid, loadCustomerBalances, loadCustomerAccount,
  listPaymentReceipts, recordPayment, recoverPaymentRequest, setOpeningBalance, uploadPaymentReceipt,
  type CustomerAccount, type CustomerBalance, type OpeningEntry, type PaymentEntry, type PaymentOperation,
  type PaymentReceipt, type SaleEntry,
} from './api';

const paymentIdKey = (actor: string) => `granja:${actor}:payment-request`;
const paymentOperationKey = (actor: string) => `granja:${actor}:payment-operation`;
const paymentCustomerKey = (actor: string) => `granja:${actor}:payment-customer`;
const receiptIdKey = (actor: string) => `granja:${actor}:receipt-request`;
const receiptOperationKey = (actor: string) => `granja:${actor}:receipt-operation`;
const receiptPaymentKey = (actor: string) => `granja:${actor}:receipt-payment`;
const receiptCustomerKey = (actor: string) => `granja:${actor}:receipt-customer`;
const operationNames: PaymentOperation[] = ['record_payment', 'set_opening_balance', 'correct_payment'];
const methods: Record<PaymentEntry['method'], string> = { pix: 'Pix', cash: 'Dinheiro', transfer: 'Transferência', other: 'Outro' };
const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Recife' }).format(new Date());
const pendingStorage = (actor: string) => ({
  paymentId: paymentIdKey(actor), paymentOperation: paymentOperationKey(actor), paymentCustomer: paymentCustomerKey(actor),
  receiptId: receiptIdKey(actor), receiptOperation: receiptOperationKey(actor), receiptPayment: receiptPaymentKey(actor), receiptCustomer: receiptCustomerKey(actor),
});
type PendingPayment = { requestId: string; operation: PaymentOperation; customerId: string };
type PendingReceipt = { requestId: string; operation: 'upload_receipt'; paymentId: string; customerId: string };
type CorrectionDraft = { reason: string; replacement: boolean; amount: string; method: PaymentEntry['method'] };

function validStoredPayment(actor: string): PendingPayment | null {
  if (!actor) return null;
  const keys = pendingStorage(actor);
  const requestId = sessionStorage.getItem(keys.paymentId) ?? '';
  const operation = sessionStorage.getItem(keys.paymentOperation) ?? '';
  const customerId = sessionStorage.getItem(keys.paymentCustomer) ?? '';
  return isRequestUuid(requestId) && operationNames.includes(operation as PaymentOperation) && isRequestUuid(customerId)
    ? { requestId, operation: operation as PaymentOperation, customerId }
    : requestId ? { requestId, operation: '' as PaymentOperation, customerId } : null;
}

function validStoredReceipt(actor: string): PendingReceipt | null {
  if (!actor) return null;
  const keys = pendingStorage(actor);
  const requestId = sessionStorage.getItem(keys.receiptId) ?? '';
  const operation = sessionStorage.getItem(keys.receiptOperation) ?? '';
  const paymentId = sessionStorage.getItem(keys.receiptPayment) ?? '';
  const customerId = sessionStorage.getItem(keys.receiptCustomer) ?? '';
  return isRequestUuid(requestId) && operation === 'upload_receipt' && isRequestUuid(paymentId) && isRequestUuid(customerId)
    ? { requestId, operation: 'upload_receipt', paymentId, customerId }
    : requestId ? { requestId, operation: 'upload_receipt', paymentId, customerId } : null;
}

function eventDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'America/Recife' }).format(new Date(value));
}

function paymentError(error: unknown) {
  const failure = error as { code?: string; message?: string };
  const text = `${failure?.message ?? ''} ${failure?.code ?? ''}`;
  if (text.includes('OPENING_LOCKED')) return 'O histórico já tem vendas ou recebimentos. O saldo inicial não pode ser alterado.';
  if (text.includes('INSUFFICIENT') || text.includes('INVALID_INPUT')) return 'Confira o valor, a data e os campos obrigatórios.';
  if (text.includes('PAYMENT_ALREADY_CORRECTED')) return 'Este pagamento já foi corrigido. Atualize o histórico.';
  if (text.includes('PAYMENT_NOT_FOUND') || text.includes('CUSTOMER_NOT_FOUND')) return 'O registro não está disponível. Atualize a conta do cliente.';
  if (text.includes('FORBIDDEN') || failure?.code === '42501') return 'Seu perfil não pode consultar ou alterar pagamentos.';
  if (failure?.code === 'PT409') return 'A conta mudou em outra sessão. Atualize os dados e confira antes de continuar.';
  return 'Não foi possível concluir a operação. Confira os dados e tente novamente.';
}

function visiblePayments(account: CustomerAccount) {
  return [...account.payments].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

function paymentCanBeCorrected(payment: PaymentEntry, payments: PaymentEntry[]) {
  return payment.reversalOf === null && !payments.some(candidate => candidate.reversalOf === payment.id);
}

function paymentLabel(payment: PaymentEntry) {
  if (payment.reversalOf) return `Correção do recebimento · ${formatCents(payment.amountCents)}`;
  return `Recebimento de ${formatCents(payment.amountCents)}`;
}

function saleLabel(sale: SaleEntry) {
  const date = eventDate(sale.effectiveAt);
  if (sale.reversalOf) return `Estorno de venda · ${date}`;
  if (sale.replacementOf) return `Venda substituta · ${date}`;
  if (sale.remainingCents > 0 && sale.dueAt && new Date(sale.dueAt) < new Date()) return `Venda · ${formatCents(sale.amountCents)} · Atrasado · ${date}`;
  return `Venda · ${formatCents(sale.amountCents)} · ${sale.remainingCents > 0 ? 'Pendente' : 'Quitada'} · ${date}`;
}

function openingLabel(opening: OpeningEntry) {
  if (opening.reversalOf) return `Correção de saldo inicial · ${eventDate(opening.asOf)}`;
  const kind = opening.signedCents < 0 ? 'Crédito inicial' : opening.signedCents > 0 ? 'Dívida inicial' : 'Saldo inicial zerado';
  return `${kind} ${formatCents(Math.abs(opening.signedCents))} · data-base ${eventDate(`${opening.asOf}T12:00:00-03:00`)}`;
}

export default function PaymentsPage() {
  const { role, userId } = useSession();
  const actorId = userId ?? '';
  const keys = pendingStorage(actorId);
  const [customers, setCustomers] = useState<CustomerBalance[]>([]);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [account, setAccount] = useState<CustomerAccount | null>(null);
  const [receiptRows, setReceiptRows] = useState<Record<string, PaymentReceipt[]>>({});
  const [downloadLinks, setDownloadLinks] = useState<Record<string, { url: string; expiresIn: number }>>({});
  const [receiptFiles, setReceiptFiles] = useState<Record<string, File | null>>({});
  const [pendingPayment, setPendingPayment] = useState<PendingPayment | null>(() => validStoredPayment(actorId));
  const [pendingReceipt, setPendingReceipt] = useState<PendingReceipt | null>(() => validStoredReceipt(actorId));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [accountStale,setAccountStale]=useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [openingKind, setOpeningKind] = useState<'debt' | 'credit'>('debt');
  const [openingAmount, setOpeningAmount] = useState('');
  const [openingDate, setOpeningDate] = useState(localToday);
  const [openingReason, setOpeningReason] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(localToday);
  const [paymentMethod, setPaymentMethod] = useState<PaymentEntry['method']>('pix');
  const [correctionId, setCorrectionId] = useState('');
  const [corrections, setCorrections] = useState<Record<string, CorrectionDraft>>({});

  async function refreshList() {
    const balances = await loadCustomerBalances();
    setCustomers(balances);
  }

  async function refreshAccount(customerId: string) {
    const customer = customers.find(row => row.customerId === customerId);
    const data = await loadCustomerAccount(customerId, customer?.name ?? account?.name ?? '');
    setAccount(data);
    const receiptPayments = data.payments.filter(payment => payment.reversalOf === null);
    const results = await Promise.allSettled(receiptPayments.map(payment => listPaymentReceipts(payment.id)));
    const receiptMap: Record<string, PaymentReceipt[]> = {};
    results.forEach((result, index) => { if (result.status === 'fulfilled') receiptMap[receiptPayments[index].id] = result.value; });
    setReceiptRows(receiptMap);
    await refreshList();
    setAccountStale(false);
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    (async () => {
      try {
        const balances = await loadCustomerBalances();
        if (!active) return;
        setCustomers(balances);
        const storedPayment = validStoredPayment(actorId);
        const storedReceipt = validStoredReceipt(actorId);
        setPendingPayment(storedPayment);
        setPendingReceipt(storedReceipt);
        const requestedCustomer = new URLSearchParams(location.search).get('cliente');
        const resumeCustomer = storedPayment?.customerId ?? storedReceipt?.customerId ?? (requestedCustomer && isRequestUuid(requestedCustomer) ? requestedCustomer : undefined);
        if (resumeCustomer && balances.some(customer => customer.customerId === resumeCustomer)) {
          setSelectedId(resumeCustomer);
          const customerName = balances.find(customer => customer.customerId === resumeCustomer)?.name ?? '';
          const data = await loadCustomerAccount(resumeCustomer, customerName);
          if (active) {
            setAccount(data);
            const receiptPayments = data.payments.filter(payment => payment.reversalOf === null);
            const result = await Promise.allSettled(receiptPayments.map(payment => listPaymentReceipts(payment.id)));
            if (active) setReceiptRows(Object.fromEntries(result.flatMap((value, index) => value.status === 'fulfilled' ? [[receiptPayments[index].id, value.value]] : [])));
          }
        }
      } catch { if (active) setError('Não foi possível carregar as contas dos clientes. Tente atualizar.'); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [actorId]);

  const filteredCustomers = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR');
    return term ? customers.filter(customer => customer.name.toLocaleLowerCase('pt-BR').includes(term)) : customers;
  }, [customers, search]);

  const selectedCustomer = customers.find(customer => customer.customerId === selectedId) ?? null;
  const payments = account ? visiblePayments(account) : [];
  const history = account ? [
    ...account.sales.map(sale => ({ type: 'sale' as const, id: sale.id, date: sale.effectiveAt, content: saleLabel(sale) })),
    ...account.openings.map(opening => ({ type: 'opening' as const, id: opening.id, date: opening.createdAt, content: openingLabel(opening) })),
  ].sort((a, b) => b.date.localeCompare(a.date)) : [];
  const pendingStateInvalid = Boolean(pendingPayment && (!isRequestUuid(pendingPayment.requestId) || !operationNames.includes(pendingPayment.operation) || !isRequestUuid(pendingPayment.customerId)));
  const pendingReceiptInvalid = Boolean(pendingReceipt && (!isRequestUuid(pendingReceipt.requestId) || pendingReceipt.operation !== 'upload_receipt' || !isRequestUuid(pendingReceipt.paymentId) || !isRequestUuid(pendingReceipt.customerId)));
  const mutationsBlocked = busy || accountStale || Boolean(pendingPayment || pendingReceipt);
  const openingAvailable = Boolean(account && !account.payments.length && !account.sales.length);

  function persistPaymentRequest(requestId: string, operation: PaymentOperation, customerId: string) {
    sessionStorage.setItem(keys.paymentId, requestId);
    sessionStorage.setItem(keys.paymentOperation, operation);
    sessionStorage.setItem(keys.paymentCustomer, customerId);
    setPendingPayment({ requestId, operation, customerId });
  }

  function clearPaymentRequest() {
    sessionStorage.removeItem(keys.paymentId); sessionStorage.removeItem(keys.paymentOperation); sessionStorage.removeItem(keys.paymentCustomer);
    setPendingPayment(null);
  }

  function persistReceiptRequest(requestId: string, paymentId: string, customerId: string) {
    sessionStorage.setItem(keys.receiptId, requestId); sessionStorage.setItem(keys.receiptOperation, 'upload_receipt');
    sessionStorage.setItem(keys.receiptPayment, paymentId); sessionStorage.setItem(keys.receiptCustomer, customerId);
    setPendingReceipt({ requestId, operation: 'upload_receipt', paymentId, customerId });
  }

  function clearReceiptRequest() {
    sessionStorage.removeItem(keys.receiptId); sessionStorage.removeItem(keys.receiptOperation);
    sessionStorage.removeItem(keys.receiptPayment); sessionStorage.removeItem(keys.receiptCustomer);
    setPendingReceipt(null);
  }

  async function openCustomer(customer: CustomerBalance) {
    if (pendingPayment || pendingReceipt) { setError('Verifique o envio anterior antes de trocar de cliente.'); return; }
    setSelectedId(customer.customerId); setAccount(null); setReceiptRows({}); setDownloadLinks({}); setError(''); setMessage(''); setLoading(true);
    try {
      const result = await loadCustomerAccount(customer.customerId, customer.name);
      setAccount(result);
      const receiptPayments = result.payments.filter(payment => payment.reversalOf === null);
      const rows = await Promise.allSettled(receiptPayments.map(payment => listPaymentReceipts(payment.id)));
      setReceiptRows(Object.fromEntries(rows.flatMap((value, index) => value.status === 'fulfilled' ? [[receiptPayments[index].id, value.value]] : [])));
    } catch { setError('Não foi possível carregar a conta ou seus comprovantes. Tente atualizar.'); }
    finally { setLoading(false); }
  }

  function confirmPaymentOperation(operation:PaymentOperation){
    clearPaymentRequest();setAccountStale(true);
    if(operation==='record_payment')setPaymentAmount('');
    if(operation==='set_opening_balance'){setOpeningAmount('');setOpeningReason('');}
    if(operation==='correct_payment')setCorrectionId('');
    setMessage(operation==='record_payment'?'Pagamento registrado.':operation==='set_opening_balance'?'Saldo de abertura registrado.':'Pagamento corrigido.');
  }
  async function refreshConfirmedAccount(customerId:string){
    try{await refreshAccount(customerId);}catch{setError('Registro confirmado, mas não foi possível atualizar a conta. Use Atualizar contas antes de outro lançamento.');}
  }
  async function verifyPaymentRequest() {
    if(!pendingPayment||pendingStateInvalid){setError('Os dados locais da tentativa estão incompletos. Solicite ajuda à dona para conferir o registro.');return;}
    setBusy(true);setError('');setMessage('');
    try{
      const result=await recoverPaymentRequest(pendingPayment.requestId,pendingPayment.operation);
      const {operation,customerId}=pendingPayment;setSelectedId(customerId);
      if(result.status==='saved'){confirmPaymentOperation(operation);await refreshConfirmedAccount(customerId);}
      else{clearPaymentRequest();setMessage('Tentativa anterior encerrada sem salvar. Confira a conta e registre novamente.');}
    }catch{setError('Não foi possível verificar o envio anterior. A tentativa continua preservada.');}
    finally{setBusy(false);}
  }
  async function submitMutation(operation:PaymentOperation,send:(requestId:string)=>Promise<unknown>){
    if(!selectedId||accountStale||pendingPayment||pendingReceipt){setError('Atualize a conta e verifique a tentativa anterior antes de registrar outra operação.');return;}
    const requestId=crypto.randomUUID();persistPaymentRequest(requestId,operation,selectedId);setBusy(true);setError('');setMessage('');
    try{await send(requestId);confirmPaymentOperation(operation);await refreshConfirmedAccount(selectedId);}
    catch(reason){const code=(reason as {code?:string})?.code;if(code&&/^[0-9A-Z]{5}$/.test(code))clearPaymentRequest();setError(code&&/^[0-9A-Z]{5}$/.test(code)?paymentError(reason):'Não foi possível confirmar o envio. A tentativa foi preservada; verifique o resultado antes de continuar.');}
    finally{setBusy(false);}
  }

  async function submitOpening(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    try {
      if (!account || !openingAvailable) throw new Error('Saldo inicial só pode ser informado antes de vendas e recebimentos.');
      const amount = parseBrlToCents(openingAmount);
      if (amount <= 0) throw new Error('Informe um saldo inicial maior que zero.');
      if (!openingReason.trim()) throw new Error('Informe o motivo do saldo inicial.');
      const signed = openingKind === 'debt' ? amount : -amount;
      await submitMutation('set_opening_balance', id => setOpeningBalance(account.customerId, signed, openingDate, openingReason.trim(), id));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Confira os dados do saldo inicial.'); }
  }

  async function submitPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    try {
      if (!account) throw new Error('Selecione um cliente.');
      const amount = parseBrlToCents(paymentAmount);
      if (amount <= 0) throw new Error('Informe um valor recebido maior que zero.');
      const receivedAt = timestampForBusinessDate(paymentDate);
      await submitMutation('record_payment', id => recordPayment(account.customerId, amount, receivedAt, paymentMethod, id));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Confira os dados do pagamento.'); }
  }

  function correctionFor(paymentId: string): CorrectionDraft {
    return corrections[paymentId] ?? { reason: '', replacement: false, amount: '', method: 'pix' };
  }

  function changeCorrection(paymentId: string, partial: Partial<CorrectionDraft>) {
    setCorrections(value => ({ ...value, [paymentId]: { ...correctionFor(paymentId), ...partial } }));
  }

  async function submitCorrection(event: FormEvent<HTMLFormElement>, payment: PaymentEntry) {
    event.preventDefault(); setError('');
    try {
      const draft = correctionFor(payment.id);
      if (!draft.reason.trim()) throw new Error('Informe o motivo da correção.');
      const replacement = draft.replacement ? { amountCents: parseBrlToCents(draft.amount), method: draft.method } : null;
      if (replacement && replacement.amountCents <= 0) throw new Error('O recebimento substituto deve ser maior que zero.');
      await submitMutation('correct_payment', id => correctPayment(payment.id, replacement, draft.reason.trim(), id));
      setCorrections(value => { const copy = { ...value }; delete copy[payment.id]; return copy; });
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Confira os dados da correção.'); }
  }

  async function attachReceipt(payment: PaymentEntry) {
    const file = receiptFiles[payment.id];
    if (!file || !account) { setError('Selecione um arquivo para anexar.'); return; }
    if (!['image/jpeg', 'image/png', 'application/pdf'].includes(file.type) || file.size < 1 || file.size > 5_000_000) {
      setError('Selecione um arquivo JPEG, PNG ou PDF de até 5 MB. O comprovante não altera o pagamento.'); return;
    }
    if (pendingPayment || (pendingReceipt && pendingReceipt.paymentId !== payment.id)) { setError('Verifique a tentativa anterior antes de anexar outro comprovante.'); return; }
    const requestId = pendingReceipt?.requestId ?? crypto.randomUUID();
    if (!pendingReceipt) persistReceiptRequest(requestId, payment.id, account.customerId);
    setBusy(true); setError(''); setMessage('');
    let uploaded = false;
    try {
      await uploadPaymentReceipt(payment.id, file, requestId);
      uploaded = true;
      clearReceiptRequest(); setReceiptFiles(value => ({ ...value, [payment.id]: null }));
      setReceiptRows(value => ({ ...value, [payment.id]: [] }));
      setMessage('Comprovante anexado ao pagamento.');
      try {
        const receipts = await listPaymentReceipts(payment.id);
        setReceiptRows(value => ({ ...value, [payment.id]: receipts }));
      } catch { setError('Comprovante anexado. Não foi possível atualizar a lista; atualize a conta.'); }
    } catch (reason) {
      const failure = reason as { code?: string; status?: number; paymentPreserved?: boolean };
      if (uploaded) {
        setError('Comprovante anexado, mas a tela não conseguiu atualizar. Atualize a conta.');
        return;
      }
      if (failure.status && failure.status < 500) clearReceiptRequest();
      const preserved = failure.paymentPreserved || failure.status === undefined || failure.status >= 500;
      setError(preserved
        ? 'O comprovante não foi confirmado. O pagamento continua registrado; selecione o mesmo arquivo para tentar anexá-lo novamente.'
        : paymentError(reason));
    } finally { setBusy(false); }
  }

  async function prepareDownload(receiptId: string) {
    setBusy(true); setError('');
    try { const link = await getReceiptDownload(receiptId); setDownloadLinks(value => ({ ...value, [receiptId]: link })); }
    catch { setError('Não foi possível preparar o download. Atualize e tente novamente.'); }
    finally { setBusy(false); }
  }

  async function refreshPage() {
    if (pendingPayment || pendingReceipt) { setError('Verifique a tentativa anterior antes de atualizar a conta.'); return; }
    setBusy(true); setError('');
    try { await refreshList(); if (selectedId) await refreshAccount(selectedId); }
    catch { setError('Não foi possível atualizar as contas. Tente novamente.'); }
    finally { setBusy(false); }
  }

  if (role !== 'owner') return <section><h1>Acesso não permitido</h1><p>Seu perfil não pode consultar pagamentos e comprovantes.</p></section>;

  return <section className="payments-page">
    <div className="page-heading"><div><h1>Financeiro</h1><p>Contas de clientes, pagamentos e saldos de abertura.</p></div>
      <button className="secondary" onClick={refreshPage} disabled={busy || loading}>Atualizar contas</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {pendingPayment && <div className="payments-pending"><p>Um lançamento ainda precisa ser confirmado. Nenhuma outra operação pode começar até verificar o resultado.</p>{pendingStateInvalid && <p role="alert">Os dados locais da tentativa estão incompletos. Solicite ajuda à dona para conferir o registro.</p>}<button disabled={busy || pendingStateInvalid} onClick={verifyPaymentRequest}>{busy ? 'Verificando…' : 'Verificar envio anterior'}</button></div>}
    {pendingReceipt && <div className="payments-pending"><p>Um comprovante ainda precisa ser confirmado. O pagamento permanece registrado; selecione novamente o mesmo arquivo para tentar anexá-lo com a mesma solicitação.</p>{pendingReceiptInvalid && <p role="alert">Os dados locais do anexo estão incompletos. Não inicie outro envio até conferir o pagamento.</p>}</div>}
    {loading ? <p role="status">Carregando contas…</p> : <div className="payments-layout">
      <aside className="payments-customer-list" aria-label="Contas de clientes">
        <label>Buscar cliente<input type="search" value={search} onChange={event => setSearch(event.target.value)} disabled={busy || Boolean(pendingPayment || pendingReceipt)} /></label>
        <p>{customers.length} clientes</p>
        {!filteredCustomers.length ? <p>Nenhum cliente encontrado com esse nome.</p> : <ul>{filteredCustomers.map(customer => <li key={customer.customerId}>
          <button type="button" aria-label={`Selecionar ${customer.name}`} className={selectedId === customer.customerId ? 'payments-customer selected' : 'payments-customer'} onClick={() => openCustomer(customer)} disabled={busy || Boolean(pendingPayment || pendingReceipt)} aria-pressed={selectedId === customer.customerId}>
            <strong>{customer.name}</strong><span>Em aberto {formatCents(customer.openCents)}</span><span>Crédito {formatCents(customer.creditCents)}</span>
          </button>
        </li>)}</ul>}
      </aside>
      <div className="payments-account">
        {!account ? <div className="payments-empty"><h2>Selecione um cliente</h2><p>Pesquise pelo nome para consultar dívida, crédito e histórico.</p></div> : <>
          <header className="payments-account-heading"><div><h2>{account.name}</h2><p>{selectedCustomer?.active ? 'Cliente ativo' : 'Cadastro inativo'}</p></div></header>
          <dl className="payments-balances"><div><dt>Saldo em aberto</dt><dd data-testid="open-balance">{formatCents(account.openCents)}</dd><small>Vendas e dívidas de abertura ainda não quitadas</small></div><div><dt>Crédito do cliente</dt><dd data-testid="customer-credit">{formatCents(account.creditCents)}</dd><small>Adiantamentos e pagamentos acima do saldo em aberto</small></div></dl>

          {openingAvailable && <details className="opening-balance-section">
            <summary><strong>Informar saldo inicial</strong><span>Dívida ou crédito anterior ao sistema; não altera o caixa do período.</span></summary>
            <form onSubmit={submitOpening}>
              <label>Tipo de saldo de abertura<select aria-label="Tipo de saldo de abertura" disabled={mutationsBlocked} value={openingKind} onChange={event => setOpeningKind(event.target.value as 'debt' | 'credit')}><option value="debt">Dívida do cliente</option><option value="credit">Crédito do cliente</option></select></label>
              <label>Valor de abertura (R$)<input disabled={mutationsBlocked} inputMode="decimal" value={openingAmount} onChange={event => setOpeningAmount(event.target.value)} required /></label>
              <label>Data-base do saldo<input disabled={mutationsBlocked} type="date" value={openingDate} onChange={event => setOpeningDate(event.target.value)} required /></label>
              <label>Motivo da abertura<textarea disabled={mutationsBlocked} value={openingReason} onChange={event => setOpeningReason(event.target.value)} maxLength={1000} required /></label>
              <p className="payment-help">Esse saldo não cria venda, recebimento ou entrada de caixa. Não inclua dados pessoais no motivo.</p>
              <button disabled={mutationsBlocked}>Registrar saldo inicial</button>
            </form>
          </details>}
          {!openingAvailable && <p className="payment-help">Saldo inicial bloqueado: há vendas ou recebimentos no histórico.</p>}

          <section className="payment-entry-section" aria-labelledby="payment-entry-heading">
            <h2 id="payment-entry-heading">Registrar pagamento</h2>
            <p>O pagamento pode quitar parte ou todo o saldo em aberto. O excedente vira crédito.</p>
            <form onSubmit={submitPayment}>
              <div className="field-pair">
                <label>Valor recebido (R$)<input disabled={mutationsBlocked} inputMode="decimal" value={paymentAmount} onChange={event => setPaymentAmount(event.target.value)} required /></label>
                <label>Data do recebimento<input disabled={mutationsBlocked} type="date" value={paymentDate} onChange={event => setPaymentDate(event.target.value)} required /></label>
              </div>
              <label>Forma de pagamento<select aria-label="Forma de pagamento" disabled={mutationsBlocked} value={paymentMethod} onChange={event => setPaymentMethod(event.target.value as PaymentEntry['method'])}>{Object.entries(methods).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <p className="payment-preview" aria-live="polite">{paymentAmount.trim() ? (() => { try { const net = account.openCents - account.creditCents - parseBrlToCents(paymentAmount); return `Estimativa após o recebimento: ${formatCents(Math.max(net, 0))} em aberto · ${formatCents(Math.max(-net, 0))} de crédito.`; } catch { return 'Confira o valor para ver a estimativa do saldo.'; } })() : 'Informe o valor para estimar o saldo após o recebimento.'}</p>
              <button disabled={mutationsBlocked}>Registrar pagamento</button>
            </form>
          </section>

          <section className="payments-history" aria-labelledby="payments-history-heading">
            <h2 id="payments-history-heading">Histórico da conta</h2>
            {!payments.length && !history.length && <p>Nenhum movimento financeiro registrado.</p>}
            {history.length > 0 && <ul className="account-ledger">{history.map(entry => <li key={`${entry.type}:${entry.id}`}>{entry.content}</li>)}</ul>}
            {payments.length > 0 && <ul className="payment-ledger">{payments.map(payment => {
              const canCorrect = paymentCanBeCorrected(payment, account.payments);
              const draft = correctionFor(payment.id);
              const receiptList = receiptRows[payment.id] ?? [];
              const ownsPendingReceipt = pendingReceipt?.paymentId === payment.id;
              const file = receiptFiles[payment.id] ?? null;
              const receiptBlocked = Boolean(pendingPayment || (pendingReceipt && !ownsPendingReceipt));
              return <li key={payment.id}>
                <article className="payment-record">
                  <div className="payment-record-heading"><div><h3>{paymentLabel(payment)}</h3><p>{methods[payment.method]} · {eventDate(payment.receivedAt)}{payment.replacementOf ? ' · Recebimento substituto' : ''}</p></div>{payment.reversalOf && <span>Corrigido</span>}</div>
                  {payment.reason && <p>Motivo da correção: {payment.reason}</p>}
                  <Receipts receipts={receiptList} links={downloadLinks} busy={busy} onPrepare={prepareDownload} />
                  {payment.reversalOf === null && <div className="receipt-upload">
                    <label>Comprovante opcional<input type="file" accept="image/jpeg,image/png,application/pdf" disabled={busy || receiptBlocked} onChange={event => setReceiptFiles(value => ({ ...value, [payment.id]: event.target.files?.[0] ?? null }))} /></label>
                    <p className="payment-help">JPEG, PNG ou PDF, até 5 MB. Anexar não registra nem altera o pagamento.</p>
                    <button type="button" className="secondary" disabled={busy || receiptBlocked || !file || (ownsPendingReceipt && pendingReceiptInvalid)} onClick={() => attachReceipt(payment)}>{ownsPendingReceipt ? 'Tentar anexar novamente' : 'Anexar comprovante'}</button>
                    {ownsPendingReceipt && !file && <small>Selecione novamente o mesmo arquivo para repetir esta tentativa.</small>}
                  </div>}
                  {canCorrect && <div className="payment-correction">
                    {correctionId === payment.id ? <form onSubmit={event => submitCorrection(event, payment)}>
                      <h4>Corrigir pagamento</h4>
                      <label>Motivo da correção<textarea disabled={mutationsBlocked} value={draft.reason} onChange={event => changeCorrection(payment.id, { reason: event.target.value })} maxLength={1000} required /></label>
                      <label className="checkbox"><input disabled={mutationsBlocked} type="checkbox" checked={draft.replacement} onChange={event => changeCorrection(payment.id, { replacement: event.target.checked })} />Criar recebimento substituto</label>
                      {draft.replacement && <div className="field-pair"><label>Valor substituto (R$)<input disabled={mutationsBlocked} inputMode="decimal" value={draft.amount} onChange={event => changeCorrection(payment.id, { amount: event.target.value })} required /></label><label>Forma de pagamento substituta<select aria-label="Forma de pagamento substituta" disabled={mutationsBlocked} value={draft.method} onChange={event => changeCorrection(payment.id, { method: event.target.value as PaymentEntry['method'] })}>{Object.entries(methods).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>}
                      <p className="payment-help">A correção mantém o lançamento original no histórico e não representa devolução real de dinheiro.</p>
                      <div className="payment-actions"><button disabled={mutationsBlocked}>Salvar correção</button><button type="button" className="secondary" disabled={busy} onClick={() => setCorrectionId('')}>Cancelar</button></div>
                    </form> : <button type="button" aria-label={`Corrigir pagamento de ${formatCents(payment.amountCents)}`} className="secondary" disabled={busy || Boolean(pendingPayment || pendingReceipt)} onClick={() => setCorrectionId(payment.id)}>Corrigir pagamento</button>}
                  </div>}
                </article>
              </li>;
            })}</ul>}
          </section>
        </>}
      </div>
    </div>}
  </section>;
}
