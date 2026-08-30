import { expect, test, type Page } from '@playwright/test';

// The selection prompt renders as a centered MODAL that dominates the screen
// (~80vh) and scrolls internally — at every form factor (phone/tablet/desktop),
// never collapsing to a "1-row" strip. Regression guard for the repeatedly
// reported "superminimized" options panel.

const APP_ORIGIN = process.env.AGJ_TERMINAL_BASE_URL || 'http://localhost:3210';
const TARGET = 'SEL:0.0';

// A long option set (12 options w/ descriptions) so the panel content exceeds
// its own height → proves the internal scroll, not just the sizing.
const lines: string[] = [
  '● Long context so the transcript above has plenty to show.',
  'Line of history one.', 'Line of history two.', 'Line of history three.',
  'Line of history four.', 'Line of history five.', 'Line of history six.',
  '',
  '❯ 1. First choice with a fairly long description line',
  '     Explanation for the first choice so it takes real vertical room.',
];
for (let n = 2; n <= 12; n++) {
  lines.push(`  ${n}. Option number ${n} with a descriptive label`);
  lines.push(`     Description for option ${n} that adds another line of height.`);
}
lines.push('Enter to select · ↑/↓ to navigate · Esc to cancel');
lines.push('▌ Type a message');
const OUTPUT = lines.join('\n');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { Telegram: unknown }).Telegram = {
      WebApp: {
        initData: 'terminal-ux-selection-dominant',
        ready() {}, expand() {}, disableVerticalSwipes() {},
        themeParams: {}, onEvent() {}, offEvent() {},
        BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
        HapticFeedback: { selectionChanged() {} },
      },
    };
    localStorage.setItem('agj_token', 'terminal-ux-selection-dominant-token');
    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'sel', username: 'e2e', role: 'owner' }));
  });
  await page.route(/telegram-web-app\.js/, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.route(/\/api\/auth\/me(?:\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 1, username: 'e2e', display_name: 'e2e', role: 'owner', totp_enabled: false }) }));
  await page.route(/\/api\/safety\/patterns(?:\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"patterns":[]}' }));
  await page.route(/\/api\/tmux\/sessions(?:\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sessions: [{ session_name: 'SEL', panes: [{ target: TARGET, command: 'claude' }] }] }) }));
  await page.route(/\/api\/tmux\/panes\/[^/]+\/output(?:\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ output: OUTPUT, target: TARGET, lines: 200 }) }));
  await page.route(/\/api\/tmux\/panes\/[^/]+\/keys$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"message":"ok"}' }));
});

async function checkModalAt(page: Page, w: number, h: number, name: string) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto(`${APP_ORIGIN}/index.html#/terminals`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await page.locator(`[data-testid="terminal-session-row"][data-session-target="${TARGET}"]`).click();
  await expect(page.locator('.terminal-chat-view')).toBeVisible({ timeout: 15_000 });
  const sel = page.locator('[data-testid="terminal-selection"]');
  await expect(sel).toBeVisible();
  await expect(page.locator('[data-testid="terminal-selection-backdrop"]')).toBeVisible();
  await expect(page.locator('[data-testid="terminal-selection-opt"]').nth(11)).toHaveCount(1);
  await page.waitForTimeout(300);

  const selBox = await sel.boundingBox();
  if (!selBox) throw new Error(`missing modal box @ ${name}`);
  const ratio = selBox.height / h;                                   // dominance vs viewport
  const scroll = await sel.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
  const bodyScrollW = await page.evaluate(() => document.documentElement.scrollWidth);

  if (process.env.SEL_SHOT_DIR) await page.screenshot({ path: `${process.env.SEL_SHOT_DIR}/sel-modal-${name}.png` });
  // eslint-disable-next-line no-console
  console.log(`[proof:${name}] vp=${w}x${h} modalH=${Math.round(selBox.height)} modalW=${Math.round(selBox.width)} ratio=${ratio.toFixed(2)} scroll=${scroll.sh}>${scroll.ch} bodyScrollW=${bodyScrollW}`);

  expect(ratio).toBeGreaterThan(0.6);              // dominant modal (target ~0.82)
  expect(scroll.sh).toBeGreaterThan(scroll.ch);    // scrolls internally
  expect(selBox.width).toBeLessThanOrEqual(w);     // fits within the viewport width
  expect(bodyScrollW).toBeLessThanOrEqual(w + 1);  // no horizontal page overflow
}

test('modal dominates + scrolls on desktop', async ({ page }) => {
  test.setTimeout(60_000);
  await checkModalAt(page, 1280, 860, 'desktop');
});

test('modal dominates + scrolls on tablet', async ({ page }) => {
  test.setTimeout(60_000);
  await checkModalAt(page, 768, 1024, 'tablet');
});

test('modal dominates + scrolls on phone', async ({ page }) => {
  test.setTimeout(60_000);
  await checkModalAt(page, 390, 844, 'phone');
});
