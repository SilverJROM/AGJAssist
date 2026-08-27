import { test, expect } from '@playwright/test';

const APP_ORIGIN = 'http://localhost:3210';
const OWNER_TOKEN = process.env.OWNER_TOKEN || 'REDACTED_TEST_JWT';

test('command-center wakeup UI and API', async ({ page }) => {
  await page.addInitScript((token) => {
    localStorage.setItem('agj_token', token);
    localStorage.setItem('agj_user', JSON.stringify({ id: 1000000001, name: 'jrom', role: 'owner' }));
  }, OWNER_TOKEN);

  const pane1 = 'pane-1';
  const pane2 = 'pane-2';
  const action1 = 'Active pane wakeup';
  const action2 = 'Other pane wakeup';
  const futureMs = Date.now() + 70 * 60 * 1000;
  const futureIso = new Date(futureMs).toISOString();

  let postPayload = null;
  let deleteId = null;

  await page.route('**/api/tmux/sessions', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ sessions: [{ session_name: 's1', panes: [
        { target: pane1, command: 'bash', activity: '', busy: false },
        { target: pane2, command: 'bash', activity: '', busy: false }
      ]}] })
    });
  });

  await page.route('**/api/agent-wakeups/pending', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ wakeups: [
        { id: 'w1', pane_target: pane1, action: action1, manual_fire_time: futureIso },
        { id: 'w2', pane_target: pane2, action: action2, manual_fire_time: futureIso }
      ]})
    });
  });

  await page.route('**/api/agent-wakeups', async route => {
    if (route.request().method() === 'POST') {
      postPayload = await route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ wakeup: { id: 'w3', pane_target: postPayload.pane_target, action: postPayload.action, manual_fire_time: postPayload.manual_fire_time } })
      });
    } else {
      await route.continue();
    }
  });

  await page.route('**/api/agent-wakeups/*', async route => {
    if (route.request().method() === 'DELETE') {
      deleteId = route.request().url().split('/').pop();
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
    } else {
      await route.continue();
    }
  });

  await page.goto(`${APP_ORIGIN}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.goto(`${APP_ORIGIN}/index.html#/terminals`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(10000);

  // Open terminal menu
  const menuBtn = page.locator('[data-testid="terminal-menu"]');
  await menuBtn.waitFor({ state: 'attached', timeout: 30000 });
  await menuBtn.click();

  // Wait for sheet
  await page.locator('[data-testid="wakeup-sheet"]').waitFor({ state: 'visible', timeout: 10000 });

  // Assert sheet and inputs visible
  await expect(page.locator('[data-testid="wakeup-sheet"]')).toBeVisible();
  await expect(page.locator('[data-testid="wakeup-date-input"]')).toBeVisible();
  await expect(page.locator('[data-testid="wakeup-time-input"]')).toBeVisible();
  await expect(page.locator('[data-testid="wakeup-action-input"]')).toBeVisible();

  // Collapsed summary should reflect only active pane
  const collapsed = page.locator('[data-testid="wakeup-collapsed-summary"]');
  await expect(collapsed).toBeVisible();
  await expect(collapsed).toContainText('1 wakeup');
  await expect(collapsed).toContainText('in');

  // Expand
  await page.locator('[data-testid="wakeup-expand-toggle"]').click();

  // Only active pane row should appear
  const rows = page.locator('[data-testid="wakeup-pending-row"]');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(pane1);
  await expect(rows.first()).toContainText(action1);
  await expect(rows.first()).not.toContainText(action2);

  // Fill non-default schedule
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const dateStr = tomorrow.toISOString().slice(0, 10);
  const timeStr = '12:00';
  const nonDefaultAction = 'Deliberate non-default action';
  const expectedIso = new Date(`${dateStr}T${timeStr}`).toISOString();

  await page.locator('[data-testid="wakeup-date-input"]').fill(dateStr);
  await page.locator('[data-testid="wakeup-time-input"]').fill(timeStr);
  await page.locator('[data-testid="wakeup-action-input"]').fill(nonDefaultAction);

  await page.locator('[data-testid="wakeup-save"]').click();

  // Assert POST payload
  expect(postPayload).not.toBeNull();
  expect(postPayload.pane_target).toBe(pane1);
  expect(postPayload.action).toBe(nonDefaultAction);
  expect(postPayload.manual_fire_time).toBe(expectedIso);

  // Cancel active wakeup
  await page.locator('[data-testid="wakeup-cancel"]').first().click();
  expect(deleteId).toBe('w1');

  // Row removed
  await expect(page.locator('[data-testid="wakeup-pending-row"]')).toHaveCount(0);
});
