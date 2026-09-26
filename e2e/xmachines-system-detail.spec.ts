import { expect, test } from '@playwright/test';

const OWNER = {
  id: 1,
  name: 'owner',
  username: 'owner',
  displayName: 'Owner D5',
  role: 'owner',
};

const MACHINE_PAYLOAD = {
  mode: 'fake',
  armed: false,
  machine: {
    name: 'gpu',
    state: 'up',
    roleHint: 'compute',
    cpuTemp: 61,
    uptime: '3d 4h 5m',
    powerSession: { duration: 5400, provenance: 'xmac-log' },
    sampledOnHours: { hours: 76.08, label: 'estimated' },
    busy: { busyCheckOutput: 'python3 train.py (pid 4242)', leaseNames: ['render-lease', 'sweep-lease'] },
    fanRpm: [1180, 1420],
  },
  gpuRows: [],
};

test.describe('D5 system detail', () => {
  test('renders CPU, fans, OS uptime, power-session, on-hours, busy, leases and protected role', async ({ page }) => {
    await page.addInitScript((sessionUser) => {
      localStorage.setItem('agj_token', 'd5-owner-token');
      localStorage.setItem('agj_user', JSON.stringify(sessionUser));
    }, OWNER);
    await page.route(/telegram-web-app\.js/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
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
    await expect(page.locator('[data-testid="xmachines-machine-detail"]').getByText('3d 4h 5m')).toBeVisible();
    await expect(page.locator('[data-testid="xmachines-machine-detail"]').getByText('61°C')).toBeVisible();
    await expect(page.locator('[data-testid="xmachines-machine-detail"]').getByText('1180, 1420')).toBeVisible();
    await expect(page.locator('[data-testid="xmachines-machine-detail"]').getByText('5400s')).toBeVisible();
    await expect(page.locator('[data-testid="xmachines-machine-detail"]').getByText('xmac-log')).toBeVisible();
    await expect(page.locator('[data-testid="xmachines-machine-detail"]').getByText('76.08 h')).toBeVisible();
    await expect(page.locator('[data-testid="xmachines-machine-detail"]').getByText('estimated')).toBeVisible();
    await expect(page.locator('[data-testid="xmachines-machine-detail"]').getByText('python3 train.py (pid 4242)')).toBeVisible();
    await expect(page.locator('[data-testid="xmachines-machine-detail"]').getByText('render-lease, sweep-lease')).toBeVisible();
    await expect(page.locator('[data-testid="xmachines-machine-detail"]').getByText('compute')).toBeVisible();
  });
});
