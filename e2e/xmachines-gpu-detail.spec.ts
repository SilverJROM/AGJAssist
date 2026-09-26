import { expect, test } from '@playwright/test';

const CANONICAL_HOST = 'agjasst.silverjrom.app';

test.describe('D4 GPU detail', () => {
  test('renders per-machine GPU rows from production read route', async ({ page }) => {
    await page.goto(`https://agjasst.silverjrom.app/#/xmachines/gpu`);
    await expect(page.locator('[data-testid="xmachines-machine-detail"]')).toBeVisible();
    const rows = page.locator('[data-testid="xmachines-gpu-row"]');
    await expect(rows).toHaveCountGreaterThan(0);
    const first = rows.first();
    await expect(first.locator('[data-testid="xmachines-gpu-name"]')).toBeTruthy();
    await expect(first.locator('[data-testid="xmachines-gpu-util"]')).toBeTruthy();
    await expect(first.locator('[data-testid="xmachines-gpu-vram"]')).toBeTruthy();
    await expect(first.locator('[data-testid="xmachines-gpu-temp"]')).toBeTruthy();
    await expect(first.locator('[data-testid="xmachines-gpu-power"]')).toBeTruthy();
    await expect(first.locator('[data-testid="xmachines-gpu-fan"]')).toBeTruthy();
  });
});
