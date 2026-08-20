import { expect, test } from '@playwright/test';

const APP_ORIGIN = process.env.AGJ_TERMINAL_BASE_URL || 'http://localhost:3210';
const TERMINAL_PATH = `${APP_ORIGIN}/index.html#/terminals`;

const NOW = Math.floor(Date.now() / 1000);
const NORTH = { name: 'NORTH', target: 'NORTH:0.0', activity: NOW, busy: true };
const OTHER = { name: 'OTHER', target: 'OTHER:0.0', activity: NOW - 3600, busy: false };

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { Telegram: unknown }).Telegram = {
      WebApp: {
        initData: 'terminal-ux-groups',
        ready() {}, expand() {}, disableVerticalSwipes() {},
        themeParams: {},
        BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
        HapticFeedback: { selectionChanged() {} },
      },
    };
    localStorage.setItem('agj_token', 'terminal-ux-groups-token');
    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'groups', username: 'e2e', role: 'owner' }));
  });

  await page.route(/\/api\/auth\/me(?:\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 1, username: 'e2e', display_name: 'e2e', role: 'owner', totp_enabled: false }) });
  });
  await page.route(/\/api\/safety\/patterns(?:\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ patterns: [] }) });
  });
  await page.route(/\/api\/tmux\/sessions(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sessions: [
          { session_name: OTHER.name, panes: [{ target: OTHER.target, window: '0', pane: '0', command: 'bash', activity: OTHER.activity, busy: OTHER.busy }] },
          { session_name: NORTH.name, panes: [{ target: NORTH.target, window: '0', pane: '0', command: 'claude', activity: NORTH.activity, busy: NORTH.busy }] },
        ],
      }),
    });
  });
  await page.route(/\/api\/tmux\/panes\/[^/]+\/output(?:\?.*)?$/, async (route) => {
    const target = decodeURIComponent(new URL(route.request().url()).pathname.split('/panes/')[1].split('/')[0]);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ output: `● hello from ${target}\n▌ Type a message`, target, lines: 25 }) });
  });
});

async function openTerminalList(page: import('@playwright/test').Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(TERMINAL_PATH, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-testid="terminal-session-list"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-testid="terminal-session-row"]')).toHaveCount(2);
}

async function createGroup(page: import('@playwright/test').Page, name: string) {
  await page.locator('[data-testid="terminal-group-create"]').click();
  const input = page.locator('[data-testid="terminal-group-name-input"]');
  await expect(input).toBeVisible();
  await input.fill(name);
  await page.locator('[data-testid="terminal-group-name-submit"]').click();
  const tab = page.locator('[data-testid="terminal-group-tab"]').filter({ hasText: name });
  await expect(tab).toBeVisible();
  return tab;
}

test('default tab is All and lists every session', async ({ page }) => {
  await openTerminalList(page);

  const allTab = page.locator('[data-testid="terminal-group-tab"][data-group-id="all"]');
  await expect(allTab).toBeVisible();
  await expect(allTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-testid="terminal-list-tabs"]')).toBeVisible();
  await expect(page.locator('[data-testid="terminal-group-create"]')).toBeVisible();

  const rows = page.locator('[data-testid="terminal-session-row"]');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText(NORTH.name);
  await expect(rows.nth(1)).toContainText(OTHER.name);
  await expect(rows.nth(0).locator('.terminal-list-dot.busy')).toBeVisible();
  await expect(rows.nth(0)).toContainText('working');
});

test('creating a group via + adds a tab and shows the empty state', async ({ page }) => {
  await openTerminalList(page);
  await createGroup(page, 'north');

  const groupTab = page.locator('[data-testid="terminal-group-tab"]').filter({ hasText: 'north' });
  await expect(groupTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-testid="terminal-group-empty"]')).toBeVisible();
  await expect(page.locator('[data-testid="terminal-group-empty"]')).toContainText('No sessions in this group yet');
  await expect(page.locator('[data-testid="terminal-session-row"]')).toHaveCount(0);
});

test('row folder menu assigns a session without opening chat', async ({ page }) => {
  await openTerminalList(page);
  await createGroup(page, 'north');

  await page.locator('[data-testid="terminal-group-tab"][data-group-id="all"]').click();
  await expect(page.locator('[data-testid="terminal-session-row"]')).toHaveCount(2);

  const northRow = page.locator(`[data-testid="terminal-session-row"][data-session-target="${NORTH.target}"]`);
  await northRow.locator('[data-testid="terminal-row-groups"]').click();
  await expect(page.locator('[data-testid="terminal-group-menu"]')).toBeVisible();
  await expect(page.locator('.terminal-chat-view')).toHaveCount(0);

  const groupId = await page.locator('[data-testid="terminal-group-tab"]').filter({ hasText: 'north' }).getAttribute('data-group-id');
  expect(groupId).toBeTruthy();
  await page.locator(`[data-testid="terminal-group-check"][data-group-id="${groupId}"]`).check();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="terminal-group-menu"]')).toHaveCount(0);
  await page.locator('[data-testid="terminal-group-tab"]').filter({ hasText: 'north' }).click();

  const groupRows = page.locator('[data-testid="terminal-session-row"]');
  await expect(groupRows).toHaveCount(1);
  await expect(groupRows.first()).toContainText(NORTH.name);
  await expect(page.locator('.terminal-chat-view')).toHaveCount(0);
});

test('edit-group screen bulk-adds sessions', async ({ page }) => {
  await openTerminalList(page);
  await createGroup(page, 'north');

  await page.locator('[data-testid="terminal-group-manage"]').click();
  await page.locator('[data-testid="terminal-group-action-edit"]').click();
  const editor = page.locator('[data-testid="terminal-group-edit"]');
  await expect(editor).toBeVisible();
  await expect(editor.locator('h3')).toContainText('north');

  await editor.locator(`[data-testid="terminal-group-edit-session"][data-session-name="${NORTH.name}"]`).check();
  await editor.locator(`[data-testid="terminal-group-edit-session"][data-session-name="${OTHER.name}"]`).check();
  await page.locator('[data-testid="terminal-group-edit-done"]').click();
  await expect(editor).toHaveCount(0);

  const rows = page.locator('[data-testid="terminal-session-row"]');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText(NORTH.name);
  await expect(rows.nth(1)).toContainText(OTHER.name);
});

test('rename and delete a group never touch tmux', async ({ page }) => {
  const mutating: string[] = [];
  page.on('request', (req) => {
    if (/\/api\/tmux\//.test(req.url()) && req.method() !== 'GET') {
      mutating.push(`${req.method()} ${req.url()}`);
    }
  });

  await openTerminalList(page);
  await createGroup(page, 'north');
  const groupTab = page.locator('[data-testid="terminal-group-tab"]').filter({ hasText: 'north' });
  const groupId = await groupTab.getAttribute('data-group-id');

  await page.locator('[data-testid="terminal-group-manage"]').click();
  await page.locator('[data-testid="terminal-group-action-rename"]').click();
  const input = page.locator('[data-testid="terminal-group-name-input"]');
  await expect(input).toHaveValue('north');
  await input.fill('core');
  await page.locator('[data-testid="terminal-group-name-submit"]').click();
  await expect(page.locator(`[data-testid="terminal-group-tab"][data-group-id="${groupId}"]`)).toContainText('core');

  await page.locator('[data-testid="terminal-group-manage"]').click();
  await page.locator('[data-testid="terminal-group-action-delete"]').click();
  await expect(page.locator(`[data-testid="terminal-group-tab"][data-group-id="${groupId}"]`)).toHaveCount(0);
  await expect(page.locator('[data-testid="terminal-group-tab"][data-group-id="all"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-testid="terminal-session-row"]')).toHaveCount(2);
  expect(mutating).toEqual([]);
});

test('groups, membership, and selected tab persist across reload', async ({ page }) => {
  await openTerminalList(page);
  await createGroup(page, 'north');
  await page.locator('[data-testid="terminal-group-tab"][data-group-id="all"]').click();

  const northRow = page.locator(`[data-testid="terminal-session-row"][data-session-target="${NORTH.target}"]`);
  await northRow.locator('[data-testid="terminal-row-groups"]').click();
  const groupId = await page.locator('[data-testid="terminal-group-tab"]').filter({ hasText: 'north' }).getAttribute('data-group-id');
  await page.locator(`[data-testid="terminal-group-check"][data-group-id="${groupId}"]`).check();
  await page.keyboard.press('Escape');
  await page.locator('[data-testid="terminal-group-tab"]').filter({ hasText: 'north' }).click();
  await expect(page.locator('[data-testid="terminal-session-row"]')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('agj_terminal_active_group'))).toBe(groupId);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-testid="terminal-group-tab"]').filter({ hasText: 'north' })).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
  await expect(page.locator('[data-testid="terminal-session-row"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="terminal-session-row"]').first()).toContainText(NORTH.name);

  const stored = await page.evaluate(() => ({
    groups: JSON.parse(localStorage.getItem('agj_terminal_groups') || '[]'),
    active: localStorage.getItem('agj_terminal_active_group'),
  }));
  expect(stored.active).toBe(groupId);
  expect(stored.groups).toEqual([
    expect.objectContaining({ id: groupId, name: 'north', sessions: [NORTH.name] }),
  ]);
});

test('tapping a row body still opens the chat', async ({ page }) => {
  await openTerminalList(page);
  const row = page.locator(`[data-testid="terminal-session-row"][data-session-target="${NORTH.target}"]`);
  await row.locator('.terminal-list-main').click();
  await expect(page.locator('.terminal-chat-view')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-testid="terminal-session-name"]')).toContainText(NORTH.name);
  await expect(page.locator('[data-testid="terminal-conversation"]')).toContainText(`hello from ${NORTH.target}`, { timeout: 10_000 });
});
