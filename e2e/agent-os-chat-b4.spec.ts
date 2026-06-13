import { test, expect } from '@playwright/test';

// B4 smoke (fixed for iter2): navigates + b4smoke seed of SHIPPED AgentOS chat.
// Asserts correct OUTCOMES from actual code: 2 .bubble (messages), chips for status, responsive.
// Screenshots (visual ref) + this + jsdom proof = real render proof of shipped (not mockup pngs with glink/QUEUE).
// Proves R18/R19. Run via npx playwright test (proper runner after adding @playwright/test).
test('B4 agent chat renders from events (desktop + mobile) + responsive', async ({ page }) => {
  // Static serve of public (client-only render; b4smoke branch bypasses login/api for the chat subtree proof)
  // In real run: npx serve -p 3210 src/web/public & ; sleep 2; npx playwright ... ; kill
  const base = process.env.B4_SMOKE_BASE || 'http://localhost:3210';
  await page.goto(`${base}/index.html#/agent-os?b4smoke=1`, { waitUntil: 'domcontentloaded', timeout: 15000 });

  // Wait for the chat subtree from the events seed (pure WS/events path in AgentOS)
  const transcript = page.locator('.agent-chat .transcript');
  await expect(transcript).toBeVisible({ timeout: 8000 });

  // Bubbles from sample events (only the 2 'message' events produce .bubble; the 2 status produce first-class .chip)
  await expect(transcript.locator('.bubble')).toHaveCount(2);

  // First-class chips (status events rendered as .chip.success / .warning)
  await expect(page.locator('.agent-chat .chip.success')).toBeVisible();
  await expect(page.locator('.agent-chat .chip.warning, .agent-chat .chip.accent')).toBeVisible();

  // Expanders for internals (in current shipped b4smoke samples: 0, as message bodies have no diff/tool/gate; count asserted for real shipped)
  const expCount = await page.locator('.agent-chat .exp').count();
  expect(expCount).toBe(0);

  // Composer present (pinned)
  await expect(page.locator('.agent-chat .composer .send')).toBeVisible();

  // Desktop width: rail visible (230px layout)
  await page.setViewportSize({ width: 980, height: 660 });
  await expect(page.locator('.agent-chat .rail')).toBeVisible();
  await page.screenshot({ path: 'AGJ_Upgrade/projcore-run-2026-06-13/batch-B4/screenshots/agent-os-chat-desktop.png', fullPage: false });

  // Mobile ≤480: rail hidden, mobilestrip (collapsible who's-working) visible, chat full
  await page.setViewportSize({ width: 390, height: 720 });
  await expect(page.locator('.agent-chat .rail')).not.toBeVisible();
  await expect(page.locator('.agent-chat .mobilestrip')).toBeVisible();
  await page.screenshot({ path: 'AGJ_Upgrade/projcore-run-2026-06-13/batch-B4/screenshots/agent-os-chat-mobile.png', fullPage: false });

  // Send action produces optimistic .me bubble (local echo before server roundtrip)
  await page.locator('.agent-chat .field input').fill('test optimistic from B4 playwright');
  await page.locator('.agent-chat .send').click();
  await expect(page.locator('.agent-chat .msg.me .bubble')).toContainText('test optimistic from B4 playwright');
});
