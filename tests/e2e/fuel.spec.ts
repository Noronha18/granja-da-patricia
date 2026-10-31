import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
const admin = createClient(process.env.VITE_SUPABASE_URL!, process.env.TEST_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const email = `fuel-${Date.now()}@example.test`, password = 'Fuel-ficticio-2026!';
let userId = ''; const vehicleId = crypto.randomUUID();
test.beforeAll(async () => {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error; userId = data.user!.id;
  for (const result of [await admin.from('profiles').insert({ id: userId, role: 'owner' }), await admin.from('vehicles').insert({ id: vehicleId, name: 'Combustível fictício E2E' })]) if (result.error) throw result.error;
});
test.afterAll(async () => {
  if (!userId) return;
  // Only test-authored fixtures, in one transaction; self references disappear together.
  execFileSync('podman', ['exec', 'supabase_db_granja-da-patricia', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', `begin; delete from public.expenses where actor_id='${userId}'; delete from public.fuel_events where actor_id='${userId}'; delete from private.request_events where actor_id='${userId}'; delete from public.vehicles where id='${vehicleId}'; commit;`], { stdio: 'ignore' });
  const result = await admin.auth.admin.deleteUser(userId); if (result.error) throw result.error;
});
test('abastecimento recupera resposta perdida sem duplicar despesa', async ({ page }) => {
  await page.goto('/combustivel'); await page.getByLabel('E-mail').fill(email); await page.getByLabel('Senha', { exact: true }).fill(password); await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.getByRole('link', { name: 'Combustível', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Combustível', exact: true })).toBeVisible();
  await page.getByLabel('Veículo', { exact: true }).selectOption(vehicleId);
  await expect(page.getByText('Aguardando histórico: dois tanques cheios com intervalo válido.')).toBeVisible();
  await page.getByLabel('Data e hora').fill('2026-09-01T12:00');
  await page.getByLabel('Hodômetro (km)').fill('1000'); await page.getByLabel('Litros', { exact: true }).fill('20.123');
  await page.getByLabel('Valor pago (R$)').fill('120,00'); await page.getByLabel('Tanque cheio').check();
  await page.route('**/rest/v1/rpc/record_fuel', async route => { await route.fetch(); await route.abort('failed'); });
  await page.getByRole('button', { name: 'Registrar abastecimento', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('ainda não confirmado');
  await expect(page.getByRole('button', { name: 'Registrar abastecimento', exact: true })).toBeDisabled();
  await page.unroute('**/rest/v1/rpc/record_fuel'); await page.reload();
  await page.getByRole('button', { name: 'Conferir tentativa', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Abastecimento confirmado');
  const fuel = await admin.from('fuel_events').select('id,litres').eq('actor_id', userId); expect(fuel.error).toBeNull(); expect(fuel.data).toHaveLength(1); expect(fuel.data![0].litres).toBe(20.123);
  const expenses = await admin.from('expenses').select('amount_cents').eq('actor_id', userId); expect(expenses.data).toEqual([{ amount_cents: 12000 }]);
  for (const width of [390, 1440]) { await page.setViewportSize({ width, height: 1000 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
});


test('abastecimento recuperado limpa formulário mesmo se o histórico falha',async({page})=>{
 await page.goto('/login');await page.getByLabel('E-mail').fill(email);await page.getByLabel('Senha',{exact:true}).fill(password);await page.getByRole('button',{name:'Entrar',exact:true}).click();await expect(page.getByRole('heading',{name:'Visão geral',exact:true})).toBeVisible();
 await page.goto('/combustivel');await page.getByLabel('Veículo',{exact:true}).selectOption(vehicleId);
 await page.getByLabel('Data e hora').fill('2026-09-02T12:00');await page.getByLabel('Hodômetro (km)').fill('1100');await page.getByLabel('Litros',{exact:true}).fill('10,5');await page.getByLabel('Valor pago (R$)').fill('60,00');
 const before=await admin.from('fuel_events').select('id').eq('actor_id',userId);
 await page.route('**/rest/v1/rpc/record_fuel',async route=>{await route.fetch();await route.abort('failed');});
 await page.getByRole('button',{name:'Registrar abastecimento',exact:true}).click();await expect(page.getByRole('status')).toContainText('ainda não confirmado');await page.unroute('**/rest/v1/rpc/record_fuel');
 await page.route('**/rest/v1/rpc/get_fuel_history',route=>route.abort('failed'));
 await page.getByRole('button',{name:'Conferir tentativa',exact:true}).click();
 await expect(page.getByLabel('Hodômetro (km)')).toHaveValue('');await expect(page.getByRole('status')).toContainText('Abastecimento confirmado');
 const after=await admin.from('fuel_events').select('id').eq('actor_id',userId);expect(after.data!.length).toBe(before.data!.length+1);
 await expect(page.getByRole('button',{name:'Conferir tentativa',exact:true})).toHaveCount(0);
});
