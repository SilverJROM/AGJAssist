import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const APP_ORIGIN = process.env.FENCE_ORIGIN || 'http://localhost:3210';
const VALIDATION_DIR = path.join(process.cwd(), 'xmachines/projcore-run-2026-09-25/validation');

const MACHINES = [
  { name: 'd1-quartz', state: 'on', gpuTemp: 65, powerWatts: 180, uptime: '9d 4h', freshness: 'fresh', provenance: 'fixture' },
  { name: 'd1-basalt', state: 'on', gpuTemp: 58, powerWatts: 95, uptime: '3d 1h', freshness: 'fresh', provenance: 'fixture' },
  { name: 'd1-slate', state: 'down', offline: true, freshness: 'stale', provenance: 'fixture' },
  { name: 'd1-onyx', state: 'down', offline: true, freshness: 'stale', provenance: 'fixture' },
  { name: 'd1-cinder', state: 'on', gpuTemp: 47, powerWatts: 31, uptime: '22m', freshness: 'fresh', provenance: 'fixture' },
];

type Shell = 'desktop' | 'telegram';
type Role = 'owner' | 'viewer';

function userFor(role: Role) {
  return {
    id: role === 'owner' ? 1 : 2,
    name: role,
    username: role,
    displayName: role === 'owner' ? 'Owner D1' : 'Viewer D1',
    role,
  };
}

async function stubApp(page: import('@playwright/test').Page, shell: Shell, role: Role) {
  const user = userFor(role);
  await page.route(/telegram-web-app\.js/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.route(/cdn\.jsdelivr\.net\/npm\/xterm/, (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.addInitScript(([shellName, sessionUser]) => {
    (window as unknown as { __D1_ERRORS: string[] }).__D1_ERRORS = [];
    window.addEventListener('error', (event) => {
      (window as unknown as { __D1_ERRORS: string[] }).__D1_ERRORS.push(String(event.message || event.error || 'error'));
    });
    window.addEventListener('unhandledrejection', (event) => {
      (window as unknown as { __D1_ERRORS: string[] }).__D1_ERRORS.push(String(event.reason || 'unhandled rejection'));
    });
    if (shellName === 'telegram') {
      (window as unknown as { Telegram: unknown }).Telegram = {
        WebApp: {
          initData: 'd1-navigation',
          ready() {},
          expand() {},
          disableVerticalSwipes() {},
          themeParams: {},
          onEvent() {},
          offEvent() {},
          BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
          HapticFeedback: { selectionChanged() {} },
        },
      };
    }
    localStorage.setItem('agj_token', `d1-${(sessionUser as { role: string }).role}-token`);
    localStorage.setItem('agj_user', JSON.stringify(sessionUser));
  }, [shell, user]);

  await page.route(/\/api\/auth\/me(?:\?.*)?$/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ...user, display_name: user.displayName, totp_enabled: false }),
  }));
  await page.route(/\/api\/projects(?:\?.*)?$/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ projects: [{ id: 1, display_name: 'D1 project' }] }),
  }));
  await page.route(/\/api\/personal-tasks(?:\?.*)?$/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ tasks: [{ id: 1, title: 'D1 task' }] }),
  }));
  await page.route(/\/api\/reminders(?:\?.*)?$/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ reminders: [{ id: 1, title: 'D1 reminder' }] }),
  }));
  await page.route(/\/api\/notes(?:\?.*)?$/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ notes: [{ id: 1, title: 'D1 note' }] }),
  }));
  await page.route(/\/api\/xmachines\/telemetry(?:\?.*)?$/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ machines: MACHINES }),
  }));
  await page.route(/\/api\/xmachines\/machines\/([^/?]+)(?:\?.*)?$/, (route) => {
    const name = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop() || '');
    const machine = MACHINES.find((row) => row.name === name) || MACHINES[0];
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ machine, cost: { costPhp: '0.00', kwh: '0.00', isPlaceholder: true, caveat: 'fixture' } }),
    });
  });
}

async function openApp(page: import('@playwright/test').Page, shell: Shell, role: Role, hash = '#/') {
  await page.setViewportSize(shell === 'telegram' ? { width: 390, height: 844 } : { width: 1280, height: 900 });
  await stubApp(page, shell, role);
  await page.goto(`${APP_ORIGIN}/index.html${hash}`, { waitUntil: 'domcontentloaded' });
}

async function writeEvidence(page: import('@playwright/test').Page, label: string) {
  fs.mkdirSync(VALIDATION_DIR, { recursive: true });
  await page.screenshot({ path: path.join(VALIDATION_DIR, `${label}.png`), fullPage: true });
  const snapshot = await page.evaluate(() => {
    const visibleText = (element: Element | null) => {
      if (!element) return null;
      const node = element as HTMLElement;
      const style = getComputedStyle(node);
      return {
        text: node.textContent?.replace(/\s+/g, ' ').trim() || '',
        ariaLabel: element.getAttribute('aria-label'),
        role: element.getAttribute('role'),
        href: element.getAttribute('href'),
        display: style.display,
        visibility: style.visibility,
        rect: node.getBoundingClientRect().toJSON(),
      };
    };
    return {
      hash: location.hash,
      title: document.title,
      bodyText: document.body.textContent?.replace(/\s+/g, ' ').trim().slice(0, 1000),
      xmachinesNav: visibleText(document.querySelector('[data-testid="xmachines-nav-link"]')),
      dashboardCards: [...document.querySelectorAll('.project-card')].map(visibleText),
      telegramTiles: [...document.querySelectorAll('.tg-dash-card')].map(visibleText),
      fleetOverview: visibleText(document.querySelector('[data-testid="xmachines-fleet-overview"]')),
      machineDetail: visibleText(document.querySelector('[data-testid="xmachines-machine-detail"]')),
      ownerRequired: visibleText(document.querySelector('.empty-state')),
      errors: (window as unknown as { __D1_ERRORS?: string[] }).__D1_ERRORS || [],
    };
  });
  fs.writeFileSync(path.join(VALIDATION_DIR, `${label}-dom.txt`), JSON.stringify(snapshot, null, 2));
}

test('A1a owner sees an xmachines link in the desktop Header', async ({ page }) => {
  await openApp(page, 'desktop', 'owner', '#/');
  await writeEvidence(page, 'D1-A1a-owner-desktop-header');
  const link = page.locator('[data-testid="xmachines-nav-link"]');
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', '#/xmachines');
  await expect(link).toContainText('xMachines');
});

test('A1b owner sees an xMachines card on the desktop Dashboard', async ({ page }) => {
  await openApp(page, 'desktop', 'owner', '#/');
  await page.waitForTimeout(750);
  await writeEvidence(page, 'D1-A1b-owner-desktop-dashboard');
  const card = page.locator('.project-card').filter({ hasText: /xMachines/ });
  await expect(card).toBeVisible();
  await expect(card).toContainText('Machine telemetry and control');
});

test('A1c owner sees a Telegram xMachines tile with the discovered machine count', async ({ page }) => {
  await openApp(page, 'telegram', 'owner', '#/');
  await page.waitForTimeout(750);
  await writeEvidence(page, 'D1-A1c-owner-telegram-tile');
  const tile = page.locator('.tg-dash-card').filter({ hasText: /xMachines/ });
  await expect(tile).toBeVisible();
  await expect(tile.locator('.tg-dash-count')).toHaveText(String(MACHINES.length));
});

test('A1d Telegram KNOWN_EXACT accepts /xmachines on a fresh deep link', async ({ page }) => {
  await openApp(page, 'telegram', 'owner', '#/xmachines');
  await expect(page.locator('[data-testid="xmachines-fleet-overview"]')).toBeVisible();
  await writeEvidence(page, 'D1-A1d-owner-telegram-deeplink');
  await expect(page.locator('[data-testid="xmachines-fleet-card"]')).toHaveCount(MACHINES.length);
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/xmachines');
});

test('A1e fresh #/xmachines load renders the xmachines section instead of landing', async ({ page }) => {
  await openApp(page, 'desktop', 'owner', '#/xmachines');
  await expect(page.locator('[data-testid="xmachines-fleet-overview"]')).toBeVisible();
  await writeEvidence(page, 'D1-A1e-owner-desktop-deeplink');
  await expect(page.locator('[data-testid="xmachines-fleet-card"]')).toHaveCount(MACHINES.length);
  await expect(page.locator('main')).not.toContainText('Dashboard');
});

test('A2a non-owner does not see the desktop xmachines navigation entry', async ({ page }) => {
  await openApp(page, 'desktop', 'viewer', '#/');
  await page.waitForTimeout(750);
  await writeEvidence(page, 'D1-A2a-viewer-desktop-hidden');
  await expect(page.locator('[data-testid="xmachines-nav-link"]')).toHaveCount(0);
  await expect(page.locator('.project-card').filter({ hasText: /xMachines/ })).toHaveCount(0);
});

test('A2b non-owner Telegram prefix deep link does not render the xmachines section', async ({ page }) => {
  await openApp(page, 'telegram', 'viewer', '#/xmachines/d1-quartz');
  await writeEvidence(page, 'D1-A2b-viewer-telegram-prefix-deeplink');
  await expect(page.locator('[data-testid="xmachines-fleet-overview"], [data-testid="xmachines-machine-detail"], .xmachines-view')).toHaveCount(0);
  await expect(page.locator('.empty-state')).toContainText(/Owner role required|Page not found/);
});
