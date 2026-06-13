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

// B5: extend B4 harness for R6 real derivation + live (real DOM nav+locator asserts, NOT grep; uses b4smoke + injected events for WS-live path)
test('B5: rail + mobilestrip show REAL derived role→agent→session→state (events + bindings, ≥2 roles, real DOM)', async ({ page }) => {
  await page.goto(PATH, { waitUntil: 'domcontentloaded' });
  const chat = page.locator('.agent-chat');
  await expect(chat).toBeVisible({ timeout: 15000 });
  // desktop: rail with real derived
  await page.setViewportSize({ width: 980, height: 700 });
  const rail = chat.locator('.rail');
  await expect(rail).toBeVisible();
  await expect(rail.locator('[data-role="projcore"]')).toBeVisible();
  await expect(rail.locator('[data-role="projcore"] .nm')).toContainText('projcore · grok-projcore');
  await expect(rail.locator('[data-role="projcore"] .nm')).toContainText('grok/4');
  await expect(rail.locator('[data-role="projcore"]')).toContainText('agj-os-TEST');
  await expect(rail.locator('[data-role="projcore"] .st')).toContainText('PROPOSED');
  await expect(rail.locator('[data-role="grok-build"] .nm')).toContainText('grok-build · claude-opus');
  await expect(rail.locator('[data-role="grok-build"] .nm')).toContainText('claude/opus');
  await expect(rail.locator('[data-role="codex5.5"] .st')).toContainText('DONE');
  // mobile: strip shows same real data
  await page.setViewportSize({ width: 390, height: 720 });
  const stripBody = chat.locator('.mobilestrip .strip-body');
  await expect(stripBody).toBeVisible();
  await expect(stripBody.locator('[data-role="projcore"]')).toBeVisible();
  await expect(stripBody).toContainText('grok/4');
  await expect(stripBody).toContainText('agj-os-TEST');
});

test('B5: live update — NEW agent_event (WS path) updates rail role state visibly (real DOM change, no reload)', async ({ page }) => {
  await page.goto(PATH, { waitUntil: 'domcontentloaded' });
  const chat = page.locator('.agent-chat');
  await expect(chat).toBeVisible({ timeout: 15000 });
  await page.setViewportSize({ width: 980, height: 700 });
  const rail = chat.locator('.rail');
  await expect(rail.locator('[data-role="projcore"] .st')).toContainText('PROPOSED');
  // simulate incoming WS event → setEvents (exact same as A3c handler in B4) → re-render derives new state
  await page.evaluate(() => {
    const w: any = window;
    if (typeof w.__injectAgentEvent === 'function') {
      w.__injectAgentEvent({ role: 'projcore', type: 'status', state: 'WORKING', ts: new Date().toISOString(), body: { note: 'B5 live' } });
    }
  });
  await expect(rail.locator('[data-role="projcore"] .st')).toContainText('WORKING');
  // no reload: transcript and other structure intact
  await expect(chat.locator('.transcript')).toBeVisible();
});
