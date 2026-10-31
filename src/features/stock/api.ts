import { supabase } from '../../lib/supabase';
import type { StockBalance, StockEvent, StockSnapshot } from '../finance/types';

export type StockEventInput = {
  kind: 'opening' | 'purchase' | 'loss' | 'adjustment';
  location: 'farm';
  eggs: number;
  effectiveAt: string;
  reason?: string;
  direction?: 'in' | 'out';
  costCents?: number;
};

export type StockEventResult = { eventId: string; eggs: number; costCents: number | null };
export type StockCostResult = { eventId: string };
export type StockRequestRecovery = { status: 'saved'; result: StockEventResult | StockCostResult } | { status: 'closed' };
export type StockOperation = 'record_stock_event' | 'set_remaining_stock_cost';

export async function loadStock(): Promise<StockSnapshot> {
  const [balanceResult, eventResult] = await Promise.all([
    supabase.from('stock_balances').select('balance_key,location,route_id,eggs,total_cost_cents').order('location').order('balance_key'),
    supabase.from('stock_events').select('id,kind,location,direction,eggs,cost_cents,effective_at,reason').order('effective_at', { ascending: false }).limit(20),
  ]);
  if (balanceResult.error) throw balanceResult.error;
  if (eventResult.error) throw eventResult.error;
  return {
    balances: (balanceResult.data ?? []) as StockBalance[],
    recentEvents: (eventResult.data ?? []) as StockEvent[],
  };
}

export async function recordStockEvent(event: StockEventInput, requestId: string): Promise<StockEventResult> {
  const { data, error } = await supabase.rpc('record_stock_event', { p_event: event, p_request_id: requestId }).retry(false);
  if (error) throw error;
  return data as StockEventResult;
}

export async function setRemainingStockCost(location: 'farm' | 'vehicle', costCents: number, reason: string, requestId: string): Promise<StockCostResult> {
  const { data, error } = await supabase.rpc('set_remaining_stock_cost', {
    p_location: location,
    p_total_cost_cents: costCents,
    p_reason: reason,
    p_request_id: requestId,
  }).retry(false);
  if (error) throw error;
  return data as StockCostResult;
}

export async function recoverStockRequest(requestId: string, operation: StockOperation): Promise<StockRequestRecovery> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) throw new Error('Identificador da tentativa inválido.');
  if (operation !== 'record_stock_event' && operation !== 'set_remaining_stock_cost') throw new Error('Operação de estoque inválida.');
  const { data, error } = await supabase.rpc('reconcile_stock_request', { p_request_id: requestId, p_operation: operation }).retry(false);
  if (error) throw error;
  return data as StockRequestRecovery;
}
