import { expect, test } from '@playwright/test';

const APP_ORIGIN = process.env.AGJ_TERMINAL_BASE_URL || 'http://localhost:3210';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { Telegram: unknown }).Telegram = {
      WebApp: {
        initData: 'command-center-header',
        ready() {}, expand() {}, disableVerticalSwipes() {},
        themeParams: {}, onEvent() {}, offEvent() {},
        BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
        HapticFeedback: { selectionChanged() {} },
      },
    };
    localStorage.setItem('agj_token', 'command-center-header-token');
    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'e2e', username: 'e2e', role: 'owner' }));
  });
});

test('command-center header collapse chrome renders', async ({ page }) => {
  test.setTimeout(60_000);
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(/telegram-web-app\.js/, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.route(/\/api\/auth\/me(?:\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 1, username: 'e2e', display_name: 'e2e', role: 'owner', totp_enabled: false }) }));
  await page.route('**/api/auth/telegram', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token: 'command-center-header-token', user: { id: 1, username: 'e2e', displayName: 'e2e', role: 'owner' } }) });
  });
  await page.route('**/api/tmux/sessions', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sessions: [
          { session_name: 'alpha', panes: [{ target: 't1', command: 'bash', activity: 1, busy: false }] },
          { session_name: 'bravo', panes: [{ target: 't2', command: 'bash', activity: 2, busy: false }] },
          { session_name: 'charlie', panes: [{ target: 't3', command: 'bash', activity: 3, busy: false }] },
          { session_name: 'delta', panes: [{ target: 't4', command: 'bash', activity: 4, busy: false }] },
          { session_name: 'echo', panes: [{ target: 't5', command: 'bash', activity: 5, busy: false }] },
          { session_name: 'foxtrot', panes: [{ target: 't6', command: 'bash', activity: 6, busy: false }] },
        ]
      })
    });
  });
  await page.addInitScript(() => {
    localStorage.setItem('agj_terminal_groups', JSON.stringify([{ id: 'g1', name: 'group1', sessions: ['alpha','bravo','charlie','delta','echo','foxtrot'] }]));
    localStorage.setItem('agj_terminal_active_group', 'g1');
  });
  await page.route('**/api/agent-reminders/active', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reminders: [{ id: 'rem-1', cadence_minutes: 30 }] }) });
  });
  await page.route('**/api/agent-wakeups/pending', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ wakeups: [{ id: 'wake-1', action: 'test' }] }) });
  });
  await page.route('**/api/summary-agents/*/summaries', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ summaries: [{ summary_text: 'Summary signal test' }] }) });
  });
  await page.route('**/api/summary-endpoints', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ endpoints: [{ id: 'ep1', name: 'ep-test', is_default: true }] }) });
  });

  await page.goto(`${APP_ORIGIN}/index.html#/terminals`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="terminal-session-row"]', { state: 'visible' });
  // Drive the real row handler, away from its action controls.
  await page.locator('[data-testid="terminal-session-row"][data-session-target="t1"]').click({ position: { x: 24, y: 18 } });
  await page.waitForSelector('[data-testid="terminal-session-name"]', { state: 'visible' });
  await page.waitForSelector('[data-testid="command-center-header"]', { state: 'visible' });
  await page.waitForSelector('[data-testid="terminal-header-v2"]', { state: 'visible' });
  expect(pageErrors).toEqual([]);

  const requests: string[] = [];
  page.on('request', req => requests.push(req.url()));
  const countRequests = (pattern: RegExp) => requests.filter(u => pattern.test(u)).length;

  // Phone/tablet (<=899px) switches agents via the DROPDOWN, not the tab strip:
  // the "Tabs ▼" toggle and the strip are hidden; the group dropdown is shown.
  // (The strip is a desktop affordance — covered by terminal-ux-header-tabs and
  // command-center-switcher at >=900px.)
  await expect(page.locator('[data-testid="tabs-collapse"]')).toBeHidden();
  const switchers = page.locator('[data-testid="agent-group-switcher"]');
  await expect(switchers).toHaveCount(1);
  await expect(switchers.first()).toBeHidden();
  await expect(page.locator('[data-testid="agent-group-switcher-dropdown"]')).toBeVisible();
  // No visible tab buttons at phone width
  expect(await page.locator('[data-testid="terminal-header-tab"]').evaluateAll(
    elements => elements.filter((element) => (element as HTMLElement).offsetParent !== null).length
  )).toBe(0);

  // Reminder row is COLLAPSED by default on phone -> the bell shows, chips hidden.
  await expect(page.locator('[data-testid="bell-indicator"]')).toBeVisible();
  await expect(page.locator('[data-testid="utilities"]')).toBeHidden();
  await expect(page.locator('.cc-util-icon-dot')).toBeVisible();
  await expect(page.locator('.cc-util-icon-count')).toHaveText('1');

  // Expand utilities via the bell -> literal chips appear, bell hides.
  await page.locator('[data-testid="bell-indicator"]').click();
  await expect(page.locator('[data-testid="utilities"]')).toBeVisible();
  await expect(page.locator('[data-testid="bell-indicator"]')).toBeHidden();
  await expect(page.locator('[data-testid="reminder-chip"]')).toContainText('rem-1');
  await expect(page.locator('[data-testid="wakeup-chip"]')).toContainText('wake-1');
  await expect(page.locator('[data-testid="summary-chip"]')).toContainText('Summary signal test');

  // Collapse utilities back to the bell.
  await page.locator('[data-testid="utilities-collapse"]').click();
  await expect(page.locator('[data-testid="utilities"]')).toBeHidden();
  await expect(page.locator('[data-testid="utilities-collapse"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="bell-indicator"]')).toBeVisible();

  // Controls are TUCKED by default on phone -> the "…" handle shows, items hidden.
  const controlsCollapse = page.locator('[data-testid="controls-collapse"]');
  await expect(controlsCollapse).toBeVisible();
  await expect(controlsCollapse).toHaveText('...');
  await expect(page.locator('[data-testid="terminal-font-decrease"]')).toBeHidden();
  await expect(page.locator('[data-testid="terminal-mynav"]')).toBeHidden();

  // Reveal the controls; font pill, ME-nav, summaries and gear appear.
  await controlsCollapse.click();
  await expect(page.locator('[data-testid="terminal-font-decrease"]')).toBeVisible();
  await expect(page.locator('[data-testid="terminal-mynav"]')).toBeVisible();
  await expect(page.locator('[data-testid="summaries-toggle"]')).toBeVisible();
  await expect(page.locator('[data-testid="terminal-menu"]')).toBeVisible();

  // Summaries toggle fetches + opens its dropdown (controls now revealed).
  const summariesBefore = countRequests(/\/api\/summary-agents\/.*\/summaries/);
  await page.locator('[data-testid="summaries-toggle"]').click();
  await page.waitForSelector('[data-testid="agent-summaries-dropdown"]', { state: 'visible' });
  await page.waitForTimeout(200);
  expect(countRequests(/\/api\/summary-agents\/.*\/summaries/)).toBeGreaterThan(summariesBefore);
  await page.locator('[data-testid="summaries-toggle"]').click();
  await expect(page.locator('[data-testid="agent-summaries-dropdown"]')).toBeHidden();

  // Settings menu opens (aria-expanded), refetches reminders, then closes.
  const remindersBefore = countRequests(/\/api\/agent-reminders\/active/);
  await page.locator('[data-testid="terminal-menu"]').click();
  await expect(page.locator('[data-testid="terminal-menu"]')).toHaveAttribute('aria-expanded', 'true');
  await page.waitForTimeout(200);
  expect(countRequests(/\/api\/agent-reminders\/active/)).toBeGreaterThan(remindersBefore);
  await page.locator('.terminal-menu-overlay').dispatchEvent('pointerdown');
  await expect(page.locator('[data-testid="terminal-menu"]')).toHaveAttribute('aria-expanded', 'false');

  // Tuck the controls back behind the "…" handle.
  await controlsCollapse.click();
  await expect(controlsCollapse).toHaveText('...');
  await expect(page.locator('[data-testid="terminal-font-decrease"]')).toBeHidden();
  // Fully collapsed chrome stays on one row inside the actual topbar at 390px.
  const geometry = await page.locator('[data-term-topbar]').evaluate((topbar) => {
    const topRect = topbar.getBoundingClientRect();
    const main = topbar.querySelector('.terminal-topbar-main');
    if (!main) throw new Error('terminal topbar row is missing');
    const rows = [...main.children].filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    const bands: number[] = [];
    for (const row of rows) {
      const r = row.getBoundingClientRect();
      const top = Math.round(r.top);
      if (!bands.some(b => Math.abs(b - top) <= 4)) bands.push(top);
    }
    return {
      height: topRect.height,
      bands,
      rects: rows.map(r => {
        const b = r.getBoundingClientRect();
        return { left: b.left, right: b.right };
      }),
    };
  });
  expect(geometry.bands).toHaveLength(1);
  expect(geometry.height).toBeLessThanOrEqual(60);
  for (const rect of geometry.rects) {
    expect(rect.left).toBeGreaterThanOrEqual(-1);
    expect(rect.right).toBeLessThanOrEqual(391);
  }
});
