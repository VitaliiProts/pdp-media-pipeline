import { expect, test } from '@playwright/test';
import { expectAccessible, register } from '../support/app';
import { PHOTO } from '../support/media';

test('a photo is uploaded, processed into its sizes and deleted', async ({ page }) => {
  await register(page);
  await expect(page.getByText('Your files will live here')).toBeVisible();
  await expectAccessible(page, 'empty library');

  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Upload files' });
  await expectAccessible(page, 'upload');
  await dialog.locator('input[type=file]').setInputFiles(PHOTO);

  const tile = page.getByRole('link', { name: /photo\.png/ });
  await expect(tile).toBeVisible();
  await expectAccessible(page, 'library');

  await tile.click();
  await expect(page.getByRole('heading', { level: 1, name: 'photo.png' })).toBeVisible();
  // Every size the upload asked for, once the worker is done.
  for (const size of ['Thumbnail', 'Medium', 'Large'])
    await expect(page.getByText(new RegExp(`^${size} · \\d+ px$`))).toBeVisible({
      timeout: 60_000,
    });
  await expectAccessible(page, 'file');

  await page.getByRole('button', { name: 'Delete photo.png' }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete photo.png?' });
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('File deleted.')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible();
  await expect(page.getByText('Your files will live here')).toBeVisible();
});
