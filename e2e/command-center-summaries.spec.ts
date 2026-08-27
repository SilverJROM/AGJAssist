import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('agj_token', 'd6-e2e-token');
    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'd6-e2e', role: 'owner' }));
  });
});

test('D6 AgentSummariesDropdown renders newest-first cards with endpoint tags', async ({ page }) => {
  await page.route('**/api/auth/me', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: 1 } }) });
  });
  await page.route('**/api/summary-endpoints', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        endpoints: [
          { id: 1, name: '140', base_url: 'http://192.168.254.140:1234/v1', model: 'llama3', is_default: true },
          { id: 2, name: 'test-ep', base_url: 'https://api.test/v1', model: 'gpt-4', is_default: false }
        ]
      })
    });
  });
  await page.route('**/api/summary-agents/*/summaries', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        summaries: [
          { id: 2, agent_name: 'agent-a', endpoint_id: 2, summary_text: 'Second summary', created_at: '2026-08-27T10:00:00Z' },
          { id: 1, agent_name: 'agent-a', endpoint_id: 1, summary_text: 'First summary', created_at: '2026-08-27T09:00:00Z' }
        ]
      })
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
  const sessionRow = page.locator('[data-testid="terminal-session-row"]').first();
  if (await sessionRow.count() > 0) {
    await sessionRow.click();
  }
  await page.waitForSelector('[data-testid="terminal-session-name"]', { state: 'attached' });

  await page.locator('[data-testid="summaries-toggle"]').click();
  await expect(page.locator('[data-testid="agent-summaries-dropdown"]')).toBeVisible();

  const cards = page.locator('[data-testid="summary-card"]');
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText('Second summary');
  await expect(cards.nth(0)).toContainText('via test-ep');
  await expect(cards.nth(1)).toContainText('First summary');
  await expect(cards.nth(1)).toContainText('via 140');
});

test('D6 AgentSummariesDropdown shows empty state when no summaries', async ({ page }) => {
  await page.route('**/api/auth/me', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: 1 } }) });
  });
  await page.route('**/api/summary-endpoints', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ endpoints: [] }) });
  });
  await page.route('**/api/summary-agents/*/summaries', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ summaries: [] }) });
  });
  await page.route('**/api/tmux/sessions', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ sessions: [{ session_name: 'test', panes: [{ target: '1', command: 'bash', activity: 1, busy: false }] }] })
    });
  });

  await page.goto('http://localhost:3210/index.html#/terminals');
  const sessionRow = page.locator('[data-testid="terminal-session-row"]').first();
  if (await sessionRow.count() > 0) await sessionRow.click();
  await page.waitForSelector('[data-testid="terminal-session-name"]', { state: 'attached' });

  await page.locator('[data-testid="summaries-toggle"]').click();
  await expect(page.locator('[data-testid="agent-summaries-dropdown"]')).toBeVisible();
  await expect(page.locator('[data-testid="summaries-empty"]')).toContainText('No summaries yet');
});
