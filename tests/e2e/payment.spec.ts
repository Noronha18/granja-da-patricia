import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';

const admin = createClient(process.env.VITE_SUPABASE_URL!, process.env.TEST_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const email = `payments-${Date.now()}@example.test`;
const password = 'Pagamento-ficticio-2026!';
const customerName = `Cliente fictício de pagamentos ${Date.now()}`;
let userId = '';
let customerId = '';
const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082', 'hex');

test.beforeAll(async () => {
  const user = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (user.error || !user.data.user) throw user.error ?? Error('No test user');
  userId = user.data.user.id;
  const profile = await admin.from('profiles').insert({ id: userId, role: 'owner' });
  if (profile.error) throw profile.error;
  const customer = await admin.from('customers').insert({
    name: customerName, address: 'Endereço fictício', phone: null, weekday: 2, position: 1,
  }).select('id').single();
  if (customer.error) throw customer.error;
  customerId = customer.data.id;
});

test.afterAll(async () => {
  const failures: unknown[] = [];
  if (customerId) {
    const receipts = await admin.from('payment_receipts').select('id,object_path').eq('actor_id', userId);
    if (!receipts.error && receipts.data.length) {
      const paths = receipts.data.map(row => row.object_path);
      const objects = await admin.storage.from('payment-receipts').remove(paths);
      if (objects.error) failures.push(objects.error);
      const rows = await admin.from('payment_receipts').delete().in('id', receipts.data.map(row => row.id));
      if (rows.error) failures.push(rows.error);
    }
    const allocations = await admin.from('payment_allocations').delete().eq('customer_id', customerId);
    if (allocations.error) failures.push(allocations.error);
    const replacements = await admin.from('payments').delete().eq('customer_id', customerId).not('reversal_of', 'is', null);
    if (replacements.error) failures.push(replacements.error);
    const corrected = await admin.from('payments').delete().eq('customer_id', customerId).not('replacement_of', 'is', null);
    if (corrected.error) failures.push(corrected.error);
    const payments = await admin.from('payments').delete().eq('customer_id', customerId);
    if (payments.error) failures.push(payments.error);
    const openingReversals = await admin.from('customer_openings').delete().eq('customer_id', customerId).not('reversal_of', 'is', null);
    if (openingReversals.error) failures.push(openingReversals.error);
    const openings = await admin.from('customer_openings').delete().eq('customer_id', customerId);
    if (openings.error) failures.push(openings.error);
    const sales = await admin.from('sales').delete().eq('customer_id', customerId);
    if (sales.error) failures.push(sales.error);
    const customer = await admin.from('customers').delete().eq('id', customerId);
    if (customer.error) failures.push(customer.error);
  }
  if (userId) {
    if (!/^[0-9a-f-]{36}$/i.test(userId)) throw Error('Invalid fixture user id');
    try {
      execFileSync('podman', ['exec', 'supabase_db_granja-da-patricia', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', `delete from private.request_events where actor_id='${userId}'`], { stdio: 'ignore' });
    } catch (error) { failures.push(error); }
    const user = await admin.auth.admin.deleteUser(userId);
    if (user.error) failures.push(user.error);
  }
  if (failures.length) throw new AggregateError(failures, 'Payment fixture cleanup failed');
});

test('saldo inicial, recebimento incerto, comprovante e correção permanecem conferíveis', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/financeiro');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('button',{name:'Mais',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Mais',exact:true}).click();
  await page.getByRole('link', { name: 'Financeiro', exact: true }).click();
  await page.getByRole('link',{name:'Registrar pagamento',exact:true}).click();
  await expect(page.getByLabel('Buscar cliente', { exact: true })).toBeVisible();

  await page.getByLabel('Buscar cliente', { exact: true }).fill(customerName);
  await page.getByRole('button', { name: `Selecionar ${customerName}`, exact: true }).click();
  await expect(page.getByTestId('open-balance')).toContainText('0,00');
  await expect(page.getByTestId('customer-credit')).toContainText('0,00');

  const asOf = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Recife' }).format(new Date());
  await page.locator('.opening-balance-section summary').click();
  await expect(page.locator('.opening-balance-section')).toHaveAttribute('open', '');
  await page.getByLabel('Tipo de saldo de abertura', { exact: true }).selectOption('debt');
  await page.getByLabel('Valor de abertura (R$)', { exact: true }).fill('100,00');
  await page.getByLabel('Data-base do saldo', { exact: true }).fill(asOf);
  await page.getByLabel('Motivo da abertura', { exact: true }).fill('Saldo de teste antes do sistema');
  await page.getByRole('button', { name: 'Registrar saldo inicial', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Saldo de abertura registrado');
  await expect(page.getByTestId('open-balance')).toContainText('100,00');

  await page.getByLabel('Valor recebido (R$)', { exact: true }).fill('40,00');
  await page.getByLabel('Data do recebimento', { exact: true }).fill(asOf);
  await page.getByLabel('Forma de pagamento', { exact: true }).selectOption('pix');
  await page.route('**/rest/v1/rpc/record_payment', async route => { await route.fetch(); await route.abort('failed'); });
  await page.getByRole('button', { name: 'Registrar pagamento', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('confirmar');
  await expect(page.getByRole('button', { name: 'Registrar pagamento', exact: true })).toBeDisabled();
  await page.unroute('**/rest/v1/rpc/record_payment');
  await page.reload();
  await page.getByRole('button', { name: 'Verificar envio anterior', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Pagamento registrado');
  await expect(page.getByTestId('open-balance')).toContainText('60,00');

  await page.getByLabel('Comprovante opcional', { exact: true }).setInputFiles({ name: 'comprovante-teste.png', mimeType: 'image/png', buffer: png });
  await page.getByRole('button', { name: 'Anexar comprovante', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Comprovante anexado');
  await page.getByRole('button', { name: 'Preparar download', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Baixar comprovante', exact: true })).toBeVisible();

  await page.getByLabel('Valor recebido (R$)', { exact: true }).fill('80,00');
  await page.getByLabel('Data do recebimento', { exact: true }).fill(asOf);
  await page.getByLabel('Forma de pagamento', { exact: true }).selectOption('cash');
  await page.getByRole('button', { name: 'Registrar pagamento', exact: true }).click();
  await expect(page.getByTestId('open-balance')).toContainText('0,00');
  await expect(page.getByTestId('customer-credit')).toContainText('20,00');

  await page.getByRole('button', { name: /Corrigir pagamento de .*80,00/ }).click();
  await page.getByLabel('Motivo da correção', { exact: true }).last().fill('Valor digitado incorretamente');
  await page.getByLabel('Criar recebimento substituto', { exact: true }).check();
  await page.getByLabel('Valor substituto (R$)', { exact: true }).fill('70,00');
  await page.getByLabel('Forma de pagamento substituta', { exact: true }).selectOption('transfer');
  await page.getByRole('button', { name: 'Salvar correção', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Pagamento corrigido');
  await expect(page.getByTestId('open-balance')).toContainText('0,00');
  await expect(page.getByTestId('customer-credit')).toContainText('10,00');

  for (const width of [360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.screenshot({ path: '/tmp/granja-payments-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: '/tmp/granja-payments-desktop.png', fullPage: true });
});


test('pagamento salvo permanece confirmado se a consulta posterior falha',async({page})=>{
 await page.goto('/login');await page.getByLabel('E-mail').fill(email);await page.getByLabel('Senha',{exact:true}).fill(password);await page.getByRole('button',{name:'Entrar',exact:true}).click();await expect(page.getByRole('heading',{name:'Visão geral',exact:true})).toBeVisible();
 await page.goto('/pagamentos');await page.getByLabel('Buscar cliente',{exact:true}).fill(customerName);await page.getByRole('button',{name:`Selecionar ${customerName}`,exact:true}).click();await expect(page.getByTestId('open-balance')).toBeVisible();
 const before=await admin.from('payments').select('id').eq('actor_id',userId);
 await page.getByLabel('Valor recebido (R$)',{exact:true}).fill('10,00');
 await page.route('**/rest/v1/rpc/get_customer_account',route=>route.abort('failed'));
 await page.getByRole('button',{name:'Registrar pagamento',exact:true}).click();
 await expect(page.getByLabel('Valor recebido (R$)',{exact:true})).toHaveValue('');
 await expect(page.getByRole('status')).toContainText('Pagamento registrado');
 await expect(page.getByRole('alert')).toContainText('atualizar');
 const after=await admin.from('payments').select('id').eq('actor_id',userId);expect(after.data!.length).toBe(before.data!.length+1);
 await expect(page.getByRole('button',{name:'Verificar envio anterior',exact:true})).toHaveCount(0);
});
