import { expect, test } from '@playwright/test';
import { expectAccessible, register } from '../support/app';
import { VIDEO } from '../support/media';

const STEPS = [
  'Extract the sound',
  'Separate the voice and recognise the speech',
  'Time every word',
  'Translate',
  'Voice the translation',
  'Mix it over the background',
];

test('a video is uploaded for a translation that goes through every step', async ({ page }) => {
  await register(page);

  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Upload files' });
  await dialog.getByRole('radio', { name: /^Translate/ }).check();
  await dialog.getByLabel('Translate into').selectOption({ label: 'Ukrainian' });
  await dialog.locator('input[type=file]').setInputFiles(VIDEO);
  await expect(dialog.getByRole('heading', { name: 'Translate 1 video' })).toBeVisible();
  await expectAccessible(page, 'translation confirmation');
  await dialog.getByRole('button', { name: 'Upload and translate' }).click();

  await page.getByRole('link', { name: /clip\.mp4/ }).click();
  await page.getByRole('link', { name: /follow the progress/ }).click();
  const steps = page.getByRole('list', { name: 'Steps' });
  await expect(steps.getByRole('listitem')).toHaveText(STEPS.map((step) => new RegExp(step)));
  await expectAccessible(page, 'translation progress');

  // Fake providers: recognition, translation, voices and separation without a key or a model.
  await expect(page.getByRole('radio', { name: /Translation · Ukrainian/ })).toBeVisible({
    timeout: 90_000,
  });
  await expect(page.getByRole('heading', { name: 'Transcript' })).toBeVisible();
  await expectAccessible(page, 'translation');
});
