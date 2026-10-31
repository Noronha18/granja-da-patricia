export type StockLocation = 'farm' | 'vehicle';

export type StockBalance = {
  balance_key: string;
  location: StockLocation;
  route_id: string | null;
  eggs: number;
  total_cost_cents: number | null;
};

export type StockEvent = {
  id: string;
  kind: 'opening' | 'purchase' | 'loss' | 'adjustment' | 'load' | 'return' | 'sale' | 'cost_regularization';
  location: StockLocation;
  direction: 'in' | 'out' | 'cost';
  eggs: number;
  cost_cents: number | null;
  effective_at: string;
  reason: string | null;
};

export type StockSnapshot = {
  balances: StockBalance[];
  recentEvents: StockEvent[];
};

export function formatCents(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

export function parseBrlToCents(value: string) {
  const normalized = value.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new Error('Informe o valor em reais usando vírgula, por exemplo 300,00.');
  }
  const [whole, fraction = ''] = normalized.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents > 9_007_199_254_740_991) {
    throw new Error('Valor fora da faixa permitida.');
  }
  return cents;
}

export function parseEggCount(value: string) {
  if (!/^\d+$/.test(value.trim())) throw new Error('Informe a quantidade em ovos como número inteiro.');
  const eggs = Number(value);
  if (!Number.isSafeInteger(eggs) || eggs < 1 || eggs > 2_147_483_647) {
    throw new Error('A quantidade deve ser um inteiro positivo dentro do limite permitido.');
  }
  return eggs;
}
