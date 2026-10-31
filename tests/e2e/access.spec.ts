import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
const url = process.env.VITE_SUPABASE_URL!;
const admin = createClient(url, process.env.TEST_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const password = 'Ficticio-apenas-teste-2026!';
const accounts: Record<string, string> = {};
test.beforeAll(async () => {
  for (const role of ['owner', 'driver', 'none']) {
    const email = `e2e-${role}-${Date.now()}@example.test`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) throw error ?? Error('Missing test user');
    accounts[role] = email;
    accounts[`${role}Id`] = data.user.id;
  }
});
test.afterAll(async () => {
  for (const role of ['owner', 'driver', 'none']) if (accounts[`${role}Id`]) await admin.auth.admin.deleteUser(accounts[`${role}Id`]);
});
async function login(page: import('@playwright/test').Page, role: string) {
  if (role !== 'none') {
    const { error } = await admin.from('profiles').upsert({ id: accounts[`${role}Id`], role });
    if (error) throw error;
  }
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(accounts[role]);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
}
test('financeiro sem sessão redireciona ao login', async ({ page }) => {
  await page.goto('/financeiro');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
});
test('login real da dona e logout', async ({ page }) => {
  await login(page, 'owner');
  await expect(page.getByRole('link', { name: 'Financeiro', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Financeiro', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Financeiro', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sair' }).click();
  await expect(page).toHaveURL(/\/login$/);
});
test('motorista não acessa financeiro', async ({ page }) => {
  await login(page, 'driver');
  await expect(page.getByRole('heading', { name: 'Minha rota' })).toBeVisible();
  await page.goto('/financeiro');
  await expect(page.getByRole('heading', { name: 'Acesso não permitido' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Financeiro', exact: true })).toHaveCount(0);
});
test('usuário sem perfil não entra', async ({ page }) => {
  await login(page, 'none');
  await expect(page.getByRole('alert')).toContainText('Acesso não autorizado');
  await expect(page.getByRole('link', { name: 'Financeiro', exact: true })).toHaveCount(0);
});
test('sessão revogada avisa e não carrega dados protegidos', async ({ page }) => {
  await login(page, 'owner');
  await expect(page.getByRole('link', { name: 'Financeiro', exact: true })).toBeVisible();
  // Revoke the real refresh token. Expire its local access cache; no login is mocked.
  const session = await page.evaluate(() => JSON.parse(localStorage.getItem('sb-127-auth-token')!));
  await admin.auth.admin.signOut(session.access_token, 'global');
  await page.evaluate(() => { const key = 'sb-127-auth-token'; const session = JSON.parse(localStorage.getItem(key)!); session.expires_at = 1; localStorage.setItem(key, JSON.stringify(session)); });
  let protectedReads = 0;
  page.on('request', request => { if (request.url().includes('/rest/v1/')) protectedReads++; });
  await page.goto('/financeiro');
  await expect(page.getByRole('alert')).toContainText('Sessão expirada');
  await expect(page).toHaveURL(/\/login$/);
  expect(protectedReads).toBe(0);
});

test('sair, entrar novamente e perder sessão mantém aviso', async ({ page, context }) => {
  await login(page, 'owner');
  await expect(page.getByRole('link', { name: 'Financeiro', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sair' }).click();
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await page.getByLabel('E-mail').fill(accounts.owner);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Financeiro', exact: true })).toBeVisible();
  const other = await context.newPage();
  await other.goto('/');
  // Real logout in another tab exercises Supabase's auth broadcast without mocking login.
  await other.getByRole('button', { name: 'Sair' }).click();
  await expect(page.getByRole('alert')).toContainText('Sessão expirada');
  await other.close();
});
