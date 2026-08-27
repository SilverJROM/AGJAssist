import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('agj_token', 'b1-e2e-token');
    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'b1-e2e', role: 'owner' }));
  });
});

test('C5 ActiveRemindersView renders mocked reminder', async ({ page }) => {
  await page.route('**/api/auth/me', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: 1 } }) });
  });
  await page.route('**/api/agent-reminders/active', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ reminders: [{ id: 'rem-1', cadence_minutes: 30 }] })
    });
  });
  await page.route('**/api/tmux/sessions', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ sessions: [{ session_name: 'test', panes: [{ target: '1', command: 'bash', activity: 1, busy: false }] }] })
    });
  });

  await page.goto('http://localhost:3210/index.html#/terminals');
  // Open first session if in list view to expose settings menu
  const sessionRow = page.locator('[data-testid="terminal-session-row"]').first();
  if (await sessionRow.count() > 0) {
    await sessionRow.click();
  }
  await page.waitForSelector('[data-testid="terminal-menu"]', { state: 'attached' });
  await page.locator('[data-testid="terminal-menu"]').click({ force: true });
  await expect(page.locator('[data-testid="agent-reminder-sheet"]')).toBeVisible();
  await expect(page.locator('[data-testid="active-reminder-row"]')).toContainText('rem-1');
  await expect(page.locator('[data-testid="active-reminder-row"]')).toContainText('30 min');
});

test('C5 create reminder flow posts correct payload', async ({ page }) => {
  await page.route('**/api/auth/me', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: 1 } }) });
  });
  let postedBody = null;
  await page.route('**/api/agent-reminders', async route => {
    if (route.request().method() === 'POST') {
      postedBody = await route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true })
      });
    } else {
      await route.continue();
    }
  });

  // Also mock active list to avoid errors
  await page.route('**/api/agent-reminders/active', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ reminders: [] })
    });
  });
  await page.route('**/api/tmux/sessions', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ sessions: [{ session_name: 'test', panes: [{ target: '1', command: 'bash', activity: 1, busy: false }] }] })
    });
  });

  await page.goto('http://localhost:3210/index.html#/terminals');
  // Open first session if in list view to expose settings menu
  const sessionRow = page.locator('[data-testid="terminal-session-row"]').first();
  if (await sessionRow.count() > 0) {
    await sessionRow.click();
  }
  await page.waitForSelector('[data-testid="terminal-menu"]', { state: 'attached' });
  await page.locator('[data-testid="terminal-menu"]').click({ force: true });
  await expect(page.locator('[data-testid="agent-reminder-sheet"]')).toBeVisible();

  // Select deliberately non-default cadence preset
  await page.locator('[data-testid="cadence-preset-60"]').click();

  // Repeat limit mode stop with custom value
  await page.locator('[data-testid="repeat-limit-mode-stop"]').click();
  await page.locator('[data-testid="repeat-limit-input"]').fill('3');

  // Toggle include/skip recipients
  await page.locator('[data-testid="include-recipients-toggle"]').uncheck();
  await page.locator('[data-testid="skip-recipients-toggle"]').check();

  await page.locator('[data-testid="agent-reminder-save"]').click();

  expect(postedBody).not.toBeNull();
  expect(postedBody.cadence_minutes).toBe(60);
  expect(postedBody.repeat_limit).toBe(3);
  expect(postedBody.recipients).toEqual({ include: false, skip: true });
  // folder_group is null for default 'all' tab
  expect(postedBody.folder_group).toBeNull();
});
