import { test, expect } from '@playwright/test';

test('owner power audit view renders', async ({ page }) => {
  await page.goto('/#/xmachines/audit');
  await expect(page.locator('[data-testid="xmachines-power-audit"]')).toBeVisible();
  await expect(page.locator('[data-testid="xmachines-audit-row"]')).toHaveCount({ min: 0 });
});
