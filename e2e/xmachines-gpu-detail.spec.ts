import { expect, test } from '@playwright/test';

// Production GET /api/xmachines/machines/:name shape. Display strings are
// fixture literals; the detail renderer copies gpuRows fields and does not format them.
const GPU_NAME = 'NVIDIA GeForce RTX 3090';
const GPU_UTIL = '41%';
const GPU_VRAM = '2048/24576 MiB';
const GPU_TEMP = '67 C';
const GPU_POWER = '220 W';
const GPU_FAN = '55%';

const OWNER = {
  id: 1,
  name: 'owner',
  username: 'owner',
  displayName: 'Owner D4',
  role: 'owner',
};

const MACHINE_PAYLOAD = {
  mode: 'fake',
  armed: false,
  machine: { name: 'gpu', state: 'up', roleHint: 'compute' },
  gpuRows: [{
    uuid: 'GPU-D4-FIXTURE',
    name: GPU_NAME,
    chip: '',
    power: GPU_POWER,
    temperature: GPU_TEMP,
    memory: GPU_VRAM,
    utilization: GPU_UTIL,
    fan: GPU_FAN,
  }],
};

test.describe('D4 GPU detail', () => {
  test('renders per-machine GPU rows from production read route', async ({ page }) => {
    await page.addInitScript((sessionUser) => {
      localStorage.setItem('agj_token', 'd4-owner-token');
      localStorage.setItem('agj_user', JSON.stringify(sessionUser));
    }, OWNER);
    await page.route(/telegram-web-app\.js/, (route) => route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: '',
    }));
    await page.route(/cdn\.jsdelivr\.net\/npm\/xterm/, (route) => route.fulfill({
      status: 200,
      contentType: 'text/css',
      body: '',
    }));
    await page.route(/\/api\/auth\/me(?:\?.*)?$/, (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...OWNER, display_name: OWNER.displayName, totp_enabled: false }),
    }));
    await page.route(/\/api\/xmachines\/machines\/gpu(?:\?.*)?$/, (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MACHINE_PAYLOAD),
    }));

    await page.goto('/index.html#/xmachines/gpu', { waitUntil: 'domcontentloaded' });

    await expect(page.locator('[data-testid="xmachines-machine-detail"]')).toBeVisible();
    const rows = page.locator('[data-testid="xmachines-gpu-row"]');
    await expect(rows).toHaveCount(1);
    const first = rows.first();
    await expect(first.locator('[data-testid="xmachines-gpu-name"]')).toHaveText(GPU_NAME);
    await expect(first.locator('[data-testid="xmachines-gpu-util"]')).toHaveText(GPU_UTIL);
    await expect(first.locator('[data-testid="xmachines-gpu-vram"]')).toHaveText(GPU_VRAM);
    await expect(first.locator('[data-testid="xmachines-gpu-temp"]')).toHaveText(GPU_TEMP);
    await expect(first.locator('[data-testid="xmachines-gpu-power"]')).toHaveText(GPU_POWER);
    await expect(first.locator('[data-testid="xmachines-gpu-fan"]')).toHaveText(GPU_FAN);
  });
});
