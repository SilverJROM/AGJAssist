import { expect, test } from '@playwright/test';

// Attach-image regression proof for the Friendly terminal composer. grok46 added a
// paperclip button that opens a hidden file input; picking an image POSTs base64 JSON
// to /api/tmux/attach-image, shows a chip, and on send appends
// "\n[image: <path>]" to the outgoing command so the agent can read it. Reuses the
// auth/tmux-poll stubbing pattern from e2e/terminal-ux-conversation.spec.ts /
// e2e/terminal-ux-layout.spec.ts.

const APP_ORIGIN = process.env.AGJ_TERMINAL_BASE_URL || 'http://localhost:3210';
const TERMINAL_PATH = `${APP_ORIGIN}/index.html#/terminals`;
const TARGET = 'ATTACH-TERM:0.0';
const ATTACH_PATH = 'tmp/term-test.png';

const INITIAL_OUTPUT = [
  'Agent baseline from the live poll.',
  '⏵⏵ bypass permissions on · ctrl+t',
  '▌ Type a message',
  'Working… (5s · esc to interrupt)',
].join('\n');

// 1x1 transparent PNG, valid enough to satisfy the composer's image/* file input.
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { Telegram: unknown }).Telegram = {
      WebApp: {
        initData: 'terminal-ux-attach',
        ready() {},
        expand() {},
        disableVerticalSwipes() {},
        themeParams: {},
        BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
        HapticFeedback: { selectionChanged() {} },
      },
    };
    localStorage.setItem('agj_token', 'terminal-ux-attach-token');
    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'terminal-ux-attach', username: 'e2e', role: 'owner' }));
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
      body: JSON.stringify({ sessions: [{ session_name: 'ATTACH-TERM', panes: [{ target: TARGET, command: 'codex' }] }] }),
    });
  });
  await page.route(/\/api\/tmux\/panes\/[^/]+\/output(?:\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ output: INITIAL_OUTPUT }) });
  });
});

async function openFriendlyTerminal(page: import('@playwright/test').Page) {
  await page.setViewportSize({ width: 800, height: 844 });
  await page.goto(TERMINAL_PATH, { waitUntil: 'domcontentloaded' });
  const picker = page.locator('.terminal-mobile-picker select');
  if (await picker.isVisible().catch(() => false)) {
    await picker.selectOption(TARGET);
  } else {
    const pane = page.locator('.session-tree .tree-item', { hasText: TARGET });
    await expect(pane).toBeVisible({ timeout: 15_000 });
    await pane.click();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const conversation = page.locator('[data-testid="terminal-conversation"]');
  if (!(await conversation.isVisible().catch(() => false))) {
    const friendly = page.getByRole('button', { name: /^Friendly$/ }).first();
    if (await friendly.isVisible().catch(() => false)) await friendly.click();
  }
  await expect(page.locator('.terminal-chat-view')).toBeVisible({ timeout: 15_000 });
}

async function attachTinyPng(page: import('@playwright/test').Page, name = 'shot.png') {
  const attachButton = page.locator('[data-testid="terminal-attach-image"]');
  await expect(attachButton).toBeVisible();
  const fileInput = page.locator('input[type="file"]');
  await expect(fileInput).toHaveCount(1);
  await fileInput.setInputFiles({
    name,
    mimeType: 'image/png',
    buffer: Buffer.from(TINY_PNG_BASE64, 'base64'),
  });
}

test('attach-image: paperclip -> chip -> send appends [image: path] and clears the chip', async ({ page }) => {
  // Each mocked send runs the app's real post-send output-polling loop (~3.4s) before
  // `sending` clears and re-enables the composer controls; this test drives that cycle
  // three times.
  test.setTimeout(60_000);

  let sentCommand: unknown = null;
  let attachRequestBody: { filename?: string; dataBase64?: string } | null = null;

  await page.route(/\/api\/tmux\/attach-image$/, async (route) => {
    attachRequestBody = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, path: ATTACH_PATH }) });
  });
  await page.route(/\/api\/tmux\/panes\/[^/]+\/send$/, async (route) => {
    sentCommand = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  await openFriendlyTerminal(page);

  const composerInput = page.locator('[data-testid="terminal-composer-input"]');
  const sendButton = page.locator('[data-testid="terminal-send-command"]');
  const attachButton = page.locator('[data-testid="terminal-attach-image"]');
  const chip = page.locator('[data-testid="terminal-attachment-chip"]');

  // --- NON-VACUITY BASELINE: prove the "[image: ...]" reference is not always present.
  // Sending plain text with nothing attached must NOT contain an image reference; this
  // is what a no-op/broken attach implementation would still pass if we skipped it.
  await composerInput.fill('just text, no attachment');
  await sendButton.click();
  await expect.poll(() => sentCommand).not.toBeNull();
  expect(sentCommand).toEqual({ command: 'just text, no attachment', enter: true });
  expect(JSON.stringify(sentCommand)).not.toContain('[image:');
  sentCommand = null;

  // Composer controls are disabled for the duration of the send's own output-polling
  // cycle; wait for it to clear before driving the next interaction.
  await expect(attachButton).toBeEnabled({ timeout: 10_000 });

  // --- Attach an image via the paperclip button ---
  await attachTinyPng(page);

  await expect(chip).toBeVisible();
  expect(attachRequestBody).not.toBeNull();
  expect(attachRequestBody!.filename).toBe('shot.png');
  expect(typeof attachRequestBody!.dataBase64).toBe('string');
  expect(attachRequestBody!.dataBase64!.length).toBeGreaterThan(0);

  await page.screenshot({
    path: '/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/terminal-ux-2026-08-15/mockups/screenshots/LIVE-attach-chip.png',
  });

  // --- Type text alongside the attachment and send ---
  await composerInput.fill('look at this');
  await sendButton.click();

  await expect.poll(() => sentCommand).not.toBeNull();
  expect(sentCommand).toEqual({ command: `look at this [image: ${ATTACH_PATH}]`, enter: true });

  // Chip clears after send (state resets synchronously, no need to wait for the poll cycle).
  await expect(chip).toHaveCount(0);
  sentCommand = null;
  await expect(attachButton).toBeEnabled({ timeout: 10_000 });

  // --- Empty text field + attached image still sends just the reference ---
  await attachTinyPng(page, 'shot2.png');
  await expect(chip).toBeVisible();
  expect(await composerInput.inputValue()).toBe('');
  await sendButton.click();

  await expect.poll(() => sentCommand).not.toBeNull();
  expect(sentCommand).toEqual({ command: `[image: ${ATTACH_PATH}]`, enter: true });
  await expect(chip).toHaveCount(0);
});

test('attach-image: clipboard paste of an image uses the same chip and send path', async ({ page }) => {
  test.setTimeout(60_000);

  let sentCommand: unknown = null;
  let attachRequestBody: { filename?: string; dataBase64?: string } | null = null;

  await page.route(/\/api\/tmux\/attach-image$/, async (route) => {
    attachRequestBody = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, path: ATTACH_PATH }) });
  });
  await page.route(/\/api\/tmux\/panes\/[^/]+\/send$/, async (route) => {
    sentCommand = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  await openFriendlyTerminal(page);

  const composerInput = page.locator('[data-testid="terminal-composer-input"]');
  const sendButton = page.locator('[data-testid="terminal-send-command"]');
  const chip = page.locator('[data-testid="terminal-attachment-chip"]');

  // Plain-text paste must not trigger attach or preventDefault.
  await composerInput.focus();
  await page.evaluate(() => {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: {
        items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }],
      },
    });
    const field = document.querySelector('[data-testid="terminal-composer-input"]');
    field!.dispatchEvent(event);
  });
  await expect(chip).toHaveCount(0);
  expect(attachRequestBody).toBeNull();

  await page.evaluate((b64) => {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const file = new File([bytes], 'clip.png', { type: 'image/png' });
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: {
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }],
      },
    });
    const field = document.querySelector('[data-testid="terminal-composer-input"]');
    const cancelled = !field!.dispatchEvent(event);
    (window as unknown as { __pastePrevented?: boolean }).__pastePrevented = cancelled;
  }, TINY_PNG_BASE64);

  await expect(chip).toBeVisible();
  expect(attachRequestBody).not.toBeNull();
  expect(attachRequestBody!.filename).toMatch(/^pasted-\d{8}T\d+Z\.png$/);
  expect(typeof attachRequestBody!.dataBase64).toBe('string');
  expect(attachRequestBody!.dataBase64!.length).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as unknown as { __pastePrevented?: boolean }).__pastePrevented)).toBe(true);

  await composerInput.fill('look at this');
  await sendButton.click();
  await expect.poll(() => sentCommand).not.toBeNull();
  expect(sentCommand).toEqual({ command: `look at this [image: ${ATTACH_PATH}]`, enter: true });
  await expect(chip).toHaveCount(0);
});
