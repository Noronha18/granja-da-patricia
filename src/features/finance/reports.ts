import { supabase } from '../../lib/supabase';
import type { Json } from '../../lib/database.types';

export type FinancialSummary = {
  salesCents: number; receivedCents: number; paidExpensesCents: number;
  cashChangeCents: number; receivablesCents: number; customerCreditCents: number;
  cogsCents: number | null; lossesCents: number | null; operatingExpensesCents: number;
  managementResultCents: number | null; costComplete: boolean; generatedAt: string; lateEntriesCount: number;
};
export type CustomerPosition = { customerId: string; name: string; openCents: number; creditCents: number };
export type CustomerPositions = { items: CustomerPosition[]; total: number; generatedAt: string; throughDate: string };
export type ManualExpense = { category: 'employee' | 'maintenance' | 'other'; description: string; amountCents: number; paidAt: string };
export type ExpenseEntry = { id: string; category: 'purchase' | 'fuel' | ManualExpense['category']; description: string; amount_cents: number; paid_at: string; created_at: string; reversal_of: string | null; stock_event_id: string | null };
export type ExpenseOperation = 'record_expense' | 'correct_expense';

function money(value: unknown) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error('AMOUNT_OUT_OF_RANGE');
  return value;
}

export async function loadFinancialSummary(from: string, to: string, asOf?: string): Promise<FinancialSummary> {
  const { data, error } = await supabase.rpc('financial_summary', { p_from: from, p_to: to, ...(asOf ? { p_as_of: asOf } : {}) }).retry(false);
  if (error) throw error;
  if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error('Resumo financeiro inválido.');
  for (const [key, value] of Object.entries(data)) if (key.endsWith('Cents') && value !== null) money(value);
  return data as unknown as FinancialSummary;
}

export async function loadCustomerPositions(to: string, asOf: string, search = '', offset = 0, limit = 50): Promise<CustomerPositions> {
  const { data, error } = await supabase.rpc('get_customer_positions', { p_to: to, p_as_of: asOf, p_search: search, p_offset: offset, p_limit: limit }).retry(false);
  if (error) throw error;
  if (!data || Array.isArray(data) || typeof data !== 'object' || !Array.isArray(data.items)) throw new Error('Pendências inválidas.');
  for (const item of data.items) {
    if (!item || Array.isArray(item) || typeof item !== 'object') throw new Error('Cliente inválido.');
    money(item.openCents); money(item.creditCents);
  }
  return data as unknown as CustomerPositions;
}

export async function loadExpenses(from: string, to: string, offset = 0, limit = 50, asOf = new Date().toISOString()) {
  // Postgres compares offsets explicitly; browser timezone never controls the interval.
  const end = new Date(`${to}T12:00:00Z`); end.setUTCDate(end.getUTCDate() + 1);
  const { data, error, count } = await supabase.from('expenses').select('id,category,description,amount_cents,paid_at,created_at,reversal_of,stock_event_id', { count: 'exact' })
    .lte('created_at', asOf).lte('paid_at', asOf).gte('paid_at', `${from}T00:00:00-03:00`).lt('paid_at', `${end.toISOString().slice(0, 10)}T00:00:00-03:00`)
    .order('paid_at', { ascending: false }).order('id').range(offset, offset + Math.min(limit, 100) - 1);
  if (error) throw error;
  for (const row of data ?? []) money(row.amount_cents);
  return { items: (data ?? []) as ExpenseEntry[], total: count ?? 0 };
}

export async function recordExpense(event: ManualExpense, requestId: string) {
  money(event.amountCents);
  const { data, error } = await supabase.rpc('record_expense', { p_event: event, p_request_id: requestId }).retry(false);
  if (error) throw error;
  return data as { expenseId: string };
}

export async function correctExpense(expenseId: string, replacement: ManualExpense | null, reason: string, requestId: string) {
  if (replacement) money(replacement.amountCents);
  const { data, error } = await supabase.rpc('correct_expense', { p_expense_id: expenseId, p_replacement: replacement as Json, p_reason: reason, p_request_id: requestId }).retry(false);
  if (error) throw error;
  return data as { reversalId: string; replacementId: string | null };
}

export async function reconcileExpenseRequest(requestId: string, operation: ExpenseOperation = 'record_expense') {
  const { data, error } = await supabase.rpc('reconcile_expense_request', { p_request_id: requestId, p_operation: operation }).retry(false);
  if (error) throw error;
  return data as { status: 'closed' } | { status: 'saved'; result: Record<string, Json> };
}
