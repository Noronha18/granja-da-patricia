import { supabase } from '../../lib/supabase';

export type DashboardSummary = {
  route: { id: string; status: string; serviceDate: string; name: string; lastConfirmedAt: string | null; nextStop: { name: string; kind: string; status: string } | null } | null;
  delivered: number; pending: number; notDelivered: number; total: number;
  farmEggs: number; vehicleEggs: number; operationalCompleted: number; operationalTotal: number; pendingReconciliations: number;
};

export async function loadDashboardSummary(date: string): Promise<DashboardSummary> {
  const { data, error } = await supabase.rpc('dashboard_summary', { p_date: date }).retry(false);
  if (error) throw error;
  if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error('Resumo do dia inválido.');
  for (const key of ['delivered', 'pending', 'notDelivered', 'total', 'farmEggs', 'vehicleEggs', 'operationalCompleted', 'operationalTotal', 'pendingReconciliations']) {
    const value = data[key];
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Resumo do dia inválido.');
  }
  return data as unknown as DashboardSummary;
}
