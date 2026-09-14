import { expect, test } from '@playwright/test';

test('the app responds and sends visitors to sign in', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page).toHaveTitle('Sign in | Unbuilt OS');
});
