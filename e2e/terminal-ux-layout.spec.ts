import { expect, test } from '@playwright/test';

// Layout regression proof for the Friendly terminal view. JROM reported the shipped
// build put the composer ABOVE the conversation; the 1:1 mockup
// (AGJ_Upgrade/terminal-ux-2026-08-15/mockups/claude/index.html) has the composer sticky
// at the BOTTOM, under the transcript. This file reuses the auth/tmux-poll stubbing
// pattern from e2e/terminal-ux-conversation.spec.ts.

const APP_ORIGIN = process.env.AGJ_TERMINAL_BASE_URL || 'http://localhost:3210';
const TERMINAL_PATH = `${APP_ORIGIN}/index.html#/terminals`;
const TARGET = 'LAYOUT-TERM:0.0';

const INITIAL_OUTPUT = [
  'Agent baseline from the live poll.',
  '⏵⏵ bypass permissions on · ctrl+t',
  '▌ Type a message',
  'Working… (5s · esc to interrupt)',
].join('\n');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { Telegram: unknown }).Telegram = {
      WebApp: {
        initData: 'terminal-ux-layout',
        ready() {},
        expand() {},
        disableVerticalSwipes() {},
        themeParams: {},
        BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
        HapticFeedback: { selectionChanged() {} },
      },
    };
    localStorage.setItem('agj_token', 'terminal-ux-layout-token');
    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'terminal-ux-layout', username: 'e2e', role: 'owner' }));
  });

  await page.route(/\/api\/auth\/me(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 1, username: 'e2e', display_name: 'e2e', role: 'owner', totp_enabled: false }),
    });
  });
  await page.route(/\/api\/safety\/patterns(?:\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ patterns: [] }) });
  });
  await page.route(/\/api\/tmux\/sessions(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ sessions: [{ session_name: 'LAYOUT-TERM', panes: [{ target: TARGET, command: 'codex' }] }] }),
    });
  });
  await page.route(/\/api\/tmux\/panes\/[^/]+\/output(?:\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ output: INITIAL_OUTPUT }) });
  });
  await page.route(/\/api\/tmux\/panes\/[^/]+\/send$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
});

async function openFriendlyTerminal(page: import('@playwright/test').Page, viewport: { width: number; height: number }) {
  // Select the pane through the production control before sizing to the target
  // viewport; the session tree is desktop-only, so pick at a wide width first.
  await page.setViewportSize({ width: Math.max(viewport.width, 800), height: Math.max(viewport.height, 844) });
  await page.goto(TERMINAL_PATH, { waitUntil: 'domcontentloaded' });
  const picker = page.locator('.terminal-mobile-picker select');
  if (await picker.isVisible().catch(() => false)) {
    await picker.selectOption(TARGET);
  } else {
    const pane = page.locator('.session-tree .tree-item', { hasText: TARGET });
    await expect(pane).toBeVisible({ timeout: 15_000 });
    await pane.click();
  }
  await page.setViewportSize(viewport);
  const conversation = page.locator('[data-testid="terminal-conversation"]');
  if (!(await conversation.isVisible().catch(() => false))) {
    const friendly = page.getByRole('button', { name: /^Friendly$/ }).first();
    if (await friendly.isVisible().catch(() => false)) await friendly.click();
  }
  await expect(page.locator('.terminal-chat-view')).toBeVisible({ timeout: 15_000 });
}

const VIEWPORTS = [
  { name: 'iPhone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
];

for (const viewport of VIEWPORTS) {
  test(`Friendly terminal composer sits below the conversation at ${viewport.name} (${viewport.width}x${viewport.height})`, async ({ page }, testInfo) => {
    await openFriendlyTerminal(page, viewport);

    const conversation = page.locator('[data-testid="terminal-conversation"]');
    const composerInput = page.locator('[data-testid="terminal-composer-input"]');
    await expect(conversation).toBeVisible();
    await expect(composerInput).toBeVisible();

    // --- THE assertion that would have caught the reported bug ---
    // Composer's top edge must sit at or below the conversation's bottom edge
    // (an 8px tolerance absorbs the composer's translucent gradient overlap with
    // the transcript's last few px, which is a deliberate visual fade, not overlap).
    const conversationBox = await conversation.boundingBox();
    const composerBox = await composerInput.boundingBox();
    expect(conversationBox).not.toBeNull();
    expect(composerBox).not.toBeNull();
    expect(composerBox!.y).toBeGreaterThanOrEqual(conversationBox!.y + conversationBox!.height - 8);

    // NON-VACUITY CHECK: prove the assertion above is falsifiable, i.e. it would have
    // caught the reported bug. `.terminal-chat-view` is `display:flex; flex-direction:
    // column` with the transcript and composer as its only two flex children (both
    // default order:0, so DOM order == visual order). Injecting `order:-1` on the
    // composer reproduces exactly the reported defect (composer rendered first / on
    // top) without touching production CSS. We then assert the SAME geometric
    // relation the real test uses and expect it to be false, proving this is a live
    // regression trap rather than a tautology.
    const inverted = await page.evaluate(() => {
      const style = document.createElement('style');
      style.textContent = '.terminal-chat-composer{order:-1}';
      document.head.appendChild(style);
      const conv = document.querySelector('[data-testid="terminal-conversation"]')!.getBoundingClientRect();
      const composer = document.querySelector('[data-testid="terminal-composer-input"]')!.getBoundingClientRect();
      style.remove();
      return { convY: conv.y, convHeight: conv.height, composerY: composer.y };
    });
    const wouldPassUnderOldLayout = inverted.composerY >= inverted.convY + inverted.convHeight - 8;
    expect(wouldPassUnderOldLayout).toBe(false);

    // Composer placeholder text matches the mockup ("Message the agent…" not the
    // raw-terminal "Type a terminal command...").
    await expect(composerInput).toHaveAttribute('placeholder', 'Message the agent...');

    // Compact topbar: hamburger menu exists; Show raw / Full Screen are NOT
    // top-level — they live inside the settings sheet.
    const menuButton = page.locator('[data-testid="terminal-menu"]');
    await expect(menuButton).toBeVisible();
    const topbar = page.locator('[data-term-topbar]');
    await expect(topbar.getByRole('button', { name: /Show raw/i })).toHaveCount(0);
    await expect(topbar.getByRole('button', { name: /Full Screen/i })).toHaveCount(0);
    await expect(topbar.locator('[data-testid="terminal-show-raw"]')).toHaveCount(0);

    // Both send controls exist.
    await expect(page.locator('[data-testid="terminal-send-command"]')).toBeVisible();
    await expect(page.locator('[data-testid="terminal-send-enter"]')).toBeVisible();

    if (viewport.width <= 390) {
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
    }

    const screenshotPath = viewport.width <= 390
      ? '/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/terminal-ux-2026-08-15/mockups/screenshots/LIVE-terminal-mobile.png'
      : '/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/terminal-ux-2026-08-15/mockups/screenshots/LIVE-terminal-desktop.png';
    await page.screenshot({ path: screenshotPath });
    void testInfo;
  });

  // WCAG contrast regression proof. JROM reported the shipped build's agent bubble text
  // was faint/unreadable (a broken dark/light color mix). grok46's fix put the agent
  // bubble text and background on a single light theme; this measures the ACTUAL
  // rendered colors (not the CSS source) and computes the real WCAG contrast ratio,
  // so a future regression that reintroduces a dark-on-dark or light-on-light pairing
  // fails this test even if it doesn't touch layout geometry.
  test(`Agent bubble text meets WCAG AA contrast at ${viewport.name} (${viewport.width}x${viewport.height})`, async ({ page }) => {
    await openFriendlyTerminal(page, viewport);

    const bubble = page.locator('[data-testid="terminal-turn-agent"] .terminal-chat-bubble').first();
    await expect(bubble).toBeVisible();
    const textNode = bubble.locator('.terminal-chat-content').first();
    await expect(textNode).toBeVisible();

    const measured = await page.evaluate(() => {
      function parseRgb(value: string): [number, number, number, number] {
        const match = value.match(/rgba?\(([^)]+)\)/);
        if (!match) return [255, 255, 255, 1];
        const parts = match[1].split(',').map((part) => Number.parseFloat(part.trim()));
        return [parts[0] ?? 255, parts[1] ?? 255, parts[2] ?? 255, parts[3] ?? 1];
      }
      // Walk up the tree to find the first ancestor with a non-transparent
      // background-color, i.e. the color that actually paints behind the text.
      function effectiveBackground(el: Element | null): [number, number, number] {
        let node = el;
        while (node) {
          const bg = getComputedStyle(node).backgroundColor;
          const [r, g, b, a] = parseRgb(bg);
          if (a > 0) return [r, g, b];
          node = node.parentElement;
        }
        return [255, 255, 255];
      }
      const bubbleEl = document.querySelector('[data-testid="terminal-turn-agent"] .terminal-chat-bubble');
      const textEl = bubbleEl?.querySelector('.terminal-chat-content');
      if (!bubbleEl || !textEl) return null;
      const [tr, tg, tb] = parseRgb(getComputedStyle(textEl).color);
      const [br, bg, bb] = effectiveBackground(bubbleEl);
      return { text: [tr, tg, tb] as [number, number, number], bg: [br, bg, bb] as [number, number, number] };
    });

    expect(measured).not.toBeNull();
    const { text, bg } = measured!;

    function relativeLuminance([r, g, b]: [number, number, number]): number {
      const channel = (c: number) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    }

    const lText = relativeLuminance(text);
    const lBg = relativeLuminance(bg);
    const lighter = Math.max(lText, lBg);
    const darker = Math.min(lText, lBg);
    const contrastRatio = (lighter + 0.05) / (darker + 0.05);

    console.log(
      `[contrast:${viewport.name}] text=rgb(${text.join(',')}) bg=rgb(${bg.join(',')}) ratio=${contrastRatio.toFixed(2)}:1`
    );

    // WCAG AA for normal-size body text.
    expect(contrastRatio).toBeGreaterThanOrEqual(4.5);

    const lightScreenshotPath = viewport.width <= 390
      ? '/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/terminal-ux-2026-08-15/mockups/screenshots/LIVE-terminal-light-mobile.png'
      : '/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/terminal-ux-2026-08-15/mockups/screenshots/LIVE-terminal-light-desktop.png';
    await page.screenshot({ path: lightScreenshotPath });
  });
}
