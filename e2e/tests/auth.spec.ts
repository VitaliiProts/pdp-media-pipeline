import { expect, test } from '@playwright/test';
import { expectAccessible, newAccount, register } from '../support/app';

test('a visitor registers, signs out and signs back in', async ({ page }) => {
  const account = newAccount();

  await page.goto('/library');
  await expect(page).toHaveURL(/\/login\?next=%2Flibrary$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
  await expectAccessible(page, 'sign-in');

  await register(page, account);
  await page.getByRole('button', { name: `Account: ${account.email}` }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();

  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password').fill('not the password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toHaveText('Wrong email or password.');

  await page.getByLabel('Password').fill(account.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible();

  // The session is a cookie, so it outlives a reload.
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible();
});
