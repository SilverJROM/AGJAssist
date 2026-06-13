import { test, expect } from '@playwright/test';
const PATH = '/index.html?b4smoke=1#/agent-os';
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('agj_token', 'b4-e2e-token');
    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'b4-e2e' }));
  });
});
test('B4: shipped AgentOS chat renders real DOM from agent_events (bubbles + chips)', async ({ page }) => {
  await page.goto(PATH, { waitUntil: 'domcontentloaded' });
  const chat = page.locator('.agent-chat');
  await expect(chat).toBeVisible({ timeout: 15000 });
  await expect(chat.locator('.transcript')).toBeVisible();
  await expect(chat.locator('.transcript .bubble')).toHaveCount(2);
  await expect(chat.locator('.chip.success')).toHaveCount(1);
  await expect(chat.locator('.chip.success')).toBeVisible();
  await expect(chat.locator('.chip.warning')).toHaveCount(1);
  await expect(chat.locator('.chip.warning')).toBeVisible();
  await expect(chat.locator('.chip.accent')).toHaveCount(0);
  await expect(chat.locator('.exp')).toHaveCount(0);
  await expect(chat.locator('.msg.me .bubble')).toContainText('go ahead, keep effort medium');
  await expect(chat.locator('.transcript')).toContainText('Added role_bindings table');
  await expect(chat.locator('.composer .send')).toBeVisible();
});
test('B4: responsive — desktop rail, mobile mobilestrip (real @media)', async ({ page }) => {
  await page.goto(PATH, { waitUntil: 'domcontentloaded' });
  const chat = page.locator('.agent-chat');
  await expect(chat).toBeVisible({ timeout: 15000 });
  await page.setViewportSize({ width: 980, height: 700 });
  await expect(chat.locator('.rail')).toBeVisible();
  await expect(chat.locator('.mobilestrip')).toBeHidden();
  await page.setViewportSize({ width: 390, height: 720 });
  await expect(chat.locator('.rail')).toBeHidden();
  await expect(chat.locator('.mobilestrip')).toBeVisible();
});
test('B4: send guard holds in no-backend harness (no crash, count stays 2)', async ({ page }) => {
  await page.goto(PATH, { waitUntil: 'domcontentloaded' });
  const chat = page.locator('.agent-chat');
  await expect(chat).toBeVisible({ timeout: 15000 });
  await expect(chat.locator('.transcript .bubble')).toHaveCount(2);
  await chat.locator('.field input').fill('hello from B4 e2e');
  await chat.locator('.send').click();
  await expect(chat.locator('.transcript .bubble')).toHaveCount(2);
  await expect(chat).toBeVisible();
});
