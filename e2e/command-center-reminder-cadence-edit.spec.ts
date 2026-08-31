import { test, expect } from '@playwright/test';

// The reminder EDIT panel (header "Reminders" dropdown) must let you change the
// cadence, not just add/remove sessions — and Save must PATCH the new cadence.

const TARGET = 'sess-a:0.0';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('agj_token', 'cadence-e2e-token');
    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'e2e', role: 'owner' }));
  });
  await page.route('**/api/auth/me', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: 1 } }) }));
  await page.route('**/api/safety/patterns', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"patterns":[]}' }));
  await page.route('**/api/terminal/groups', (r) => {
    if (r.request().method() !== 'GET') return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ groups: [{ id: 'g1', name: 'Working', sessions: ['sess-a', 'sess-b'] }] }) });
  });
  await page.route('**/api/tmux/sessions', (r) => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ sessions: [
      { session_name: 'sess-a', panes: [{ target: 'sess-a:0.0', command: 'claude', activity: 1, busy: false }] },
      { session_name: 'sess-b', panes: [{ target: 'sess-b:0.0', command: 'claude', activity: 1, busy: false }] },
    ] }),
  }));
  await page.route(/\/api\/tmux\/panes\/[^/]+\/output(?:\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ output: '● hi\n▌ Type', target: TARGET, lines: 200 }) }));
  await page.route('**/api/agent-reminders/active', (r) => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ reminders: [{ id: 'rem-1', cadence_minutes: 30, folder_group: 'g1', recipients: [{ agent_name: 'sess-a', include: 1 }] }] }),
  }));
});

test('reminder edit can change cadence and PATCHes it', async ({ page }) => {
  test.setTimeout(60_000);
  let patchBody: any = null;
  await page.route('**/api/agent-reminders/rem-1', async (route) => {
    if (route.request().method() === 'PATCH') {
      patchBody = route.request().postDataJSON();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    }
    return route.continue();
  });

  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto('http://localhost:3210/index.html#/terminals', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await page.locator(`[data-testid="terminal-session-row"][data-session-target="${TARGET}"]`).click();
  await expect(page.locator('.terminal-chat-view')).toBeVisible({ timeout: 15_000 });

  // Open the Reminders dropdown, then Edit the reminder.
  await page.locator('[data-testid="reminder-chip"]').click();
  await expect(page.locator('[data-testid="agent-reminders-dropdown"]')).toBeVisible();
  await page.locator('[data-testid="dd-reminder-edit"]').click();

  // Cadence controls exist and are seeded to the reminder's current 30m.
  await expect(page.locator('[data-testid="dd-edit-cadence-30"]')).toHaveClass(/btn-primary/);
  await expect(page.locator('[data-testid="dd-edit-cadence-15"]')).toBeVisible();
  await expect(page.locator('[data-testid="dd-edit-cadence-custom"]')).toBeVisible();

  // Change cadence to 60m and Save.
  await page.locator('[data-testid="dd-edit-cadence-60"]').click();
  await page.locator('[data-testid="dd-reminder-edit-save"]').click();
  await page.waitForTimeout(300);

  expect(patchBody).not.toBeNull();
  expect(patchBody.cadence_minutes).toBe(60);
  expect(Array.isArray(patchBody.recipients)).toBeTruthy();
  expect(patchBody.recipients.some((x: any) => x.agent_name === 'sess-a')).toBeTruthy();

  // And a custom cadence value flows through too. The dropdown stays open after
  // Save (only the edit panel closes), so just re-open the edit panel.
  await expect(page.locator('[data-testid="agent-reminders-dropdown"]')).toBeVisible();
  await page.locator('[data-testid="dd-reminder-edit"]').click();
  await page.locator('[data-testid="dd-edit-cadence-custom"]').fill('7');
  await page.locator('[data-testid="dd-reminder-edit-save"]').click();
  await page.waitForTimeout(300);
  expect(patchBody.cadence_minutes).toBe(7);
});
