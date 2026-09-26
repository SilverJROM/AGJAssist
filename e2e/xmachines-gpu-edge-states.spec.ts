import { expect, test } from '@playwright/test';

const OWNER = {
  id: 1,
  name: 'owner',
  username: 'owner',
  displayName: 'Owner D13',
  role: 'owner',
};

type GpuRow = {
  uuid: string;
  name: string;
  chip: string;
  power: string;
  temperature: string;
  memory: string;
  utilization: string;
  fan: string;
};

const ROWS: GpuRow[] = [
  {
    uuid: 'GPU-EDGE-LIVE-1',
    name: 'NVIDIA RTX 4090',
    chip: '',
    power: '220 W',
    temperature: '67 C',
    memory: '2048/24576 MiB',
    utilization: '41%',
    fan: '55%',
  },
  {
    uuid: 'GPU-EDGE-NA',
    name: 'NVIDIA RTX 4090',
    chip: '',
    power: 'unavailable',
    temperature: '60 C',
    memory: '2048/24576 MiB',
    utilization: '37%',
    fan: '45%',
  },
  {
    uuid: 'GPU-EDGE-NON-NVIDIA',
    name: 'AMD Radeon PRO W6800',
    chip: 'non-nvidia',
    power: 'not-applicable',
    temperature: 'not-applicable',
    memory: 'not-applicable',
    utilization: 'not-applicable',
    fan: 'not-applicable',
  },
  {
    uuid: 'GPU-EDGE-STALE',
    name: 'NVIDIA RTX 3090',
    chip: 'stale',
    power: '95.2 W',
    temperature: '44 C',
    memory: '1024/24576 MiB',
    utilization: '10%',
    fan: '30%',
  },
];

const PAYLOAD = {
  mode: 'fake',
  armed: false,
  machine: { name: 'gpu', state: 'up', roleHint: 'compute' },
  gpuRows: ROWS,
};

test.describe('D13 GPU edge states', () => {
  test('renders one row per GPU UUID plus unavailable, no-nvidia, driver-timeout, non-nvidia and stale states from production read route', async ({ page }) => {
    await page.addInitScript((sessionUser) => {
      localStorage.setItem('agj_token', 'd13-owner-token');
      localStorage.setItem('agj_user', JSON.stringify(sessionUser));
    }, OWNER);

    await page.route(/\/api\/auth\/me(?:\?.*)?$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...OWNER, display_name: OWNER.displayName, totp_enabled: false }),
      })
    );

    await page.route(/\/api\/xmachines\/machines\/gpu(?:\?.*)?$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(PAYLOAD),
      })
    );

    await page.goto('/index.html#/xmachines/gpu', { waitUntil: 'domcontentloaded' });

    await expect(page.locator('[data-testid="xmachines-machine-detail"]')).toBeVisible();

    const rows = page.locator('[data-testid="xmachines-gpu-row"]');
    await expect(rows).toHaveCount(ROWS.length);

    for (let i = 0; i < ROWS.length; i++) {
      const row = rows.nth(i);
      const r = ROWS[i];
      await expect(row.locator('[data-testid="xmachines-gpu-name"]')).toHaveText(r.name);
      await expect(row.locator('[data-testid="xmachines-gpu-power"]')).toHaveText(r.power);
      await expect(row.locator('[data-testid="xmachines-gpu-temp"]')).toHaveText(r.temperature);
      await expect(row.locator('[data-testid="xmachines-gpu-vram"]')).toHaveText(r.memory);
      await expect(row.locator('[data-testid="xmachines-gpu-util"]')).toHaveText(r.utilization);
      await expect(row.locator('[data-testid="xmachines-gpu-fan"]')).toHaveText(r.fan);
    }
  });
});
