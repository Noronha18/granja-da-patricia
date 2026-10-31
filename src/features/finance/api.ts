import { supabase } from '../../lib/supabase';
import type { Json } from '../../lib/database.types';

export type CustomerBalance = {
  customerId: string;
  name: string;
  active: boolean;
  openCents: number;
  creditCents: number;
};

export type PaymentEntry = {
  id: string;
  amountCents: number;
  receivedAt: string;
  createdAt: string;
  method: 'pix' | 'cash' | 'transfer' | 'other';
  reversalOf: string | null;
  replacementOf: string | null;
  reason: string | null;
};

export type SaleEntry = {
  id: string;
  amountCents: number;
  eggs: number;
  effectiveAt: string;
  createdAt: string;
  dueAt: string | null;
  reversalOf: string | null;
  replacementOf: string | null;
  remainingCents: number;
};

export type OpeningEntry = {
  id: string;
  signedCents: number;
  asOf: string;
  effectiveAt: string;
  createdAt: string;
  reason: string;
  reversalOf: string | null;
};

export type CustomerAccount = CustomerBalance & {
  payments: PaymentEntry[];
  sales: SaleEntry[];
  openings: OpeningEntry[];
};

export type PaymentOperation = 'record_payment' | 'set_opening_balance' | 'correct_payment';
export type PaymentRecovery = { status: 'saved'; result: Record<string, unknown> } | { status: 'closed' };
export type PaymentReceipt = { id: string; paymentId: string; path: string; mime: string; size: number; sha256: string; actorId: string; createdAt: string };

export class FinanceRequestError extends Error {
  constructor(message: string, readonly code?: string, readonly status?: number, readonly paymentPreserved?: boolean) {
    super(message);
    this.name = 'FinanceRequestError';
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isRequestUuid = (value: string) => uuidPattern.test(value);

function integerCents(value: unknown, label: string) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(`Saldo de ${label} inválido recebido do servidor.`);
  return value;
}

export async function loadCustomerBalances(): Promise<CustomerBalance[]> {
  const { data, error } = await supabase.rpc('get_customer_balances').retry(false);
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error('Resposta de saldos inválida.');
  return data.map((row: Json) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Cliente inválido recebido do servidor.');
    const value = row as Record<string, Json | undefined>;
    if (typeof value.customerId !== 'string' || typeof value.name !== 'string' || typeof value.active !== 'boolean') throw new Error('Cliente inválido recebido do servidor.');
    return {
      customerId: value.customerId,
      name: value.name,
      active: value.active,
      openCents: integerCents(value.openCents, 'aberto'),
      creditCents: integerCents(value.creditCents, 'crédito'),
    };
  });
}

export async function loadCustomerAccount(customerId: string, customerName = ''): Promise<CustomerAccount> {
  const { data, error } = await supabase.rpc('get_customer_account', { p_customer_id: customerId }).retry(false);
  if (error) throw error;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Conta do cliente inválida.');
  const value = data as Record<string, Json | undefined>;
  if (value.customerId !== customerId || !Array.isArray(value.payments) || !Array.isArray(value.sales) || !Array.isArray(value.openings)) throw new Error('Conta do cliente inválida.');
  return {
    customerId,
    name: customerName,
    active: true,
    openCents: integerCents(value.openCents, 'aberto'),
    creditCents: integerCents(value.creditCents, 'crédito'),
    payments: value.payments as unknown as PaymentEntry[],
    sales: value.sales as unknown as SaleEntry[],
    openings: value.openings as unknown as OpeningEntry[],
  };
}

export async function recordPayment(customerId: string, amountCents: number, receivedAt: string, method: PaymentEntry['method'], requestId: string) {
  const { data, error } = await supabase.rpc('record_payment', {
    p_customer_id: customerId, p_amount_cents: amountCents, p_received_at: receivedAt, p_method: method, p_request_id: requestId,
  }).retry(false);
  if (error) throw error;
  return data as { paymentId: string; openCents: number; creditCents: number };
}

export async function setOpeningBalance(customerId: string, signedCents: number, asOf: string, reason: string, requestId: string) {
  const { data, error } = await supabase.rpc('set_opening_balance', {
    p_customer_id: customerId, p_signed_cents: signedCents, p_as_of: asOf, p_reason: reason, p_request_id: requestId,
  }).retry(false);
  if (error) throw error;
  return data as { eventId: string };
}

export async function correctPayment(paymentId: string, replacement: { amountCents: number; method: PaymentEntry['method'] } | null, reason: string, requestId: string) {
  const { data, error } = await supabase.rpc('correct_payment', {
    p_payment_id: paymentId, p_replacement: replacement as unknown as Json, p_reason: reason, p_request_id: requestId,
  }).retry(false);
  if (error) throw error;
  return data as { reversalId: string; replacementId: string | null };
}

export async function recoverPaymentRequest(requestId: string, operation: PaymentOperation): Promise<PaymentRecovery> {
  if (!isRequestUuid(requestId) || !['record_payment', 'set_opening_balance', 'correct_payment'].includes(operation)) throw new Error('Tentativa de pagamento inválida.');
  const { data, error } = await supabase.rpc('reconcile_payment_request', { p_request_id: requestId, p_operation: operation }).retry(false);
  if (error) throw error;
  return data as unknown as PaymentRecovery;
}

async function bearerToken() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session?.access_token) throw new FinanceRequestError('Sessão expirada. Entre novamente.', 'UNAUTHENTICATED', 401);
  return data.session.access_token;
}

async function receiptRequest<T>(path: string, init: RequestInit): Promise<T> {
  const token = await bearerToken();
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers } });
  } catch {
    throw new FinanceRequestError('Não foi possível confirmar a comunicação com o serviço de comprovantes.');
  }
  let body: unknown;
  try { body = await response.json(); }
  catch { throw new FinanceRequestError('Resposta inválida do serviço de comprovantes.', undefined, response.status); }
  if (!response.ok) {
    const error = body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : 'RECEIPT_SERVICE_UNAVAILABLE';
    const preserved = Boolean(body && typeof body === 'object' && 'paymentPreserved' in body && (body as { paymentPreserved: unknown }).paymentPreserved);
    throw new FinanceRequestError(error, error, response.status, preserved);
  }
  return body as T;
}

export async function listPaymentReceipts(paymentId: string) {
  const result = await receiptRequest<{ receipts: PaymentReceipt[] }>(`/api/payments/${paymentId}/receipts`, { method: 'GET' });
  return result.receipts;
}

export async function uploadPaymentReceipt(paymentId: string, file: File, requestId: string) {
  if (!isRequestUuid(paymentId) || !isRequestUuid(requestId)) throw new Error('Identificador de comprovante inválido.');
  return receiptRequest<{ receiptId: string }>(`/api/payments/${paymentId}/receipt`, {
    method: 'POST',
    headers: { 'Content-Type': file.type, 'X-Request-Id': requestId },
    body: file,
  });
}

export async function getReceiptDownload(receiptId: string) {
  if (!isRequestUuid(receiptId)) throw new Error('Identificador de comprovante inválido.');
  return receiptRequest<{ url: string; expiresIn: number }>(`/api/receipts/${receiptId}/download`, { method: 'GET' });
}
