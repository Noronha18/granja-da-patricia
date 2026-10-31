import { supabase } from '../../lib/supabase';
import type { FuelEvent } from './consumption';

export type FuelInput = { vehicleId: string; occurredAt: string; odometerKm: number; litres: number; totalCents: number; fuelType: string; fullTank: boolean; note?: string };
export type FuelHistoryEvent = FuelEvent & { vehicleId: string; vehicleName: string; note: string };
export type FuelResult = { fuelId: string; expenseId: string };
export async function loadFuel(): Promise<{ events: FuelHistoryEvent[]; vehicles: { id: string; name: string }[] }> {
  const [history, vehicles] = await Promise.all([supabase.rpc('get_fuel_history'), supabase.rpc('get_fuel_vehicles')]);
  if (history.error) throw history.error;
  if (vehicles.error) throw vehicles.error;
  return { events: history.data as FuelHistoryEvent[], vehicles: vehicles.data as { id: string; name: string }[] };
}
export async function recordFuel(event: FuelInput, requestId: string): Promise<FuelResult> {
  const { data, error } = await supabase.rpc('record_fuel', { p_event: event, p_request_id: requestId }).retry(false);
  if (error) throw error;
  return data as FuelResult;
}
export async function correctFuel(fuelId: string, replacement: FuelInput | null, reason: string, requestId: string) {
  const { data, error } = await supabase.rpc('correct_fuel', { p_fuel_id: fuelId, p_replacement: replacement, p_reason: reason, p_request_id: requestId }).retry(false);
  if (error) throw error;
  return data as { reversalId: string; replacementId: string | null; expenseId: string | null };
}
export async function recoverFuelRequest(requestId: string, operation: 'record_fuel' | 'correct_fuel' = 'record_fuel') {
  const { data, error } = await supabase.rpc('reconcile_fuel_request', { p_request_id: requestId, p_operation: operation }).retry(false);
  if (error) throw error;
  return data as { status: 'closed' } | { status: 'saved'; result: FuelResult };
}
