import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

export interface Account {
  name: string;
  email: string;
  password: string;
}

/** A user of its own for every test, so tests do not depend on each other or on their order. */
export const newAccount = (): Account => {
  const id = randomUUID().slice(0, 8);
  return { name: `E2E ${id}`, email: `e2e-${id}@example.com`, password: `e2e-password-${id}` };
};

export async function register(page: Page, account: Account = newAccount()): Promise<Account> {
  await page.goto('/register');
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password').fill(account.password);
  await page.getByLabel('Name').fill(account.name);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible();
  return account;
}

/** Fails on axe violations a user would hit hard; minor and moderate ones are not gated. */
export async function expectAccessible(page: Page, screen: string): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).analyze();
  const blocking = violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map(
      (v) =>
        `${v.impact} ${v.id}: ${v.help} — ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
    );
  expect(blocking, `axe on the ${screen} screen`).toEqual([]);
}
