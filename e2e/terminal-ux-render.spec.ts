import { expect, test } from '@playwright/test';

// Render-model proofs for Friendly terminal chat:
//   FIX A — sliding suffix/prefix overlap + accumulate (not prefix-from-0 / replace)
//   FIX B — canonicalize once; reject control-only; remove flattened pane echo
//   FIX C — keep bullet paragraph leaders; deep capture; no 200-line active cap

const APP_ORIGIN = process.env.AGJ_TERMINAL_BASE_URL || 'http://localhost:3210';
const TERMINAL_PATH = `${APP_ORIGIN}/index.html#/terminals`;
const TARGET = 'RENDER-TERM:0.0';

const OLD_REPLY_LINE = 'OLD-REPLY-LINE';
const NEW_REPLY_LINE = 'NEW-REPLY-LINE';
const YOU_MESSAGE = 'follow-up after the old reply';

const BASELINE_25 = [
  OLD_REPLY_LINE,
  ...Array.from({ length: 23 }, (_, i) => `OLD-CTX-${String(i + 1).padStart(2, '0')}`),
  'OLD-REPLY-TAIL',
];

const INITIAL_OUTPUT = [
  ...BASELINE_25,
  '⏵⏵ bypass permissions on · ctrl+t',
  '▌ Type a message',
  'Working… (5s · esc to interrupt)',
].join('\n');

const AFTER_SEND_SLID = [
  ...BASELINE_25.slice(1),
  YOU_MESSAGE,
  NEW_REPLY_LINE,
  '⏵⏵ bypass permissions on · ctrl+t',
  '▌ Type a message',
  'Working… (6s · esc to interrupt)',
].join('\n');

const CONTROL_CHAR_RE = /[\u0000-\u001F\u007F]/;

function tailLines(text: string, n: number) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
  const safe = Math.max(1, Number.isFinite(n) ? n : 25);
  return lines.slice(-safe).join('\n');
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { Telegram: unknown }).Telegram = {
      WebApp: {
        initData: 'terminal-ux-render',
        ready() {},
        expand() {},
        disableVerticalSwipes() {},
        themeParams: {},
        BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
        HapticFeedback: { selectionChanged() {} },
      },
    };
    localStorage.setItem('agj_token', 'terminal-ux-render-token');
    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'terminal-ux-render', username: 'e2e', role: 'owner' }));
  });
});

async function installRenderTransport(
  page: import('@playwright/test').Page,
  getOutput: () => string,
  onSend?: (body: unknown) => void,
  requestedLineCounts?: number[],
) {
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
      body: JSON.stringify({
        sessions: [{ session_name: 'RENDER-TERM', panes: [{ target: TARGET, command: 'codex' }] }],
      }),
    });
  });
  await page.route(/\/api\/tmux\/panes\/[^/]+\/output(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    const requested = Number(url.searchParams.get('lines') || '25');
    requestedLineCounts?.push(requested);
    const output = tailLines(getOutput(), requested);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ output, target: TARGET, lines: requested }),
    });
  });
  await page.route(/\/api\/tmux\/panes\/[^/]+\/send$/, async (route) => {
    onSend?.(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
}

async function openFriendlyTerminal(page: import('@playwright/test').Page) {
  await page.setViewportSize({ width: 800, height: 844 });
  await page.goto(TERMINAL_PATH, { waitUntil: 'domcontentloaded' });
  const row = page.locator(`[data-testid="terminal-session-row"][data-session-target="${TARGET}"]`);
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();
  await page.setViewportSize({ width: 390, height: 844 });
  const conversation = page.locator('[data-testid="terminal-conversation"]');
  if (!(await conversation.isVisible().catch(() => false))) {
    const friendly = page.getByRole('button', { name: /^Friendly$/ }).first();
    if (await friendly.isVisible().catch(() => false)) await friendly.click();
  }
  await expect(page.locator('.terminal-chat-view')).toBeVisible({ timeout: 15_000 });
}

test('FIX A: sliding full-pane send does not replay leftover old-reply tail', async ({ page }) => {
  test.setTimeout(60_000);
  let paneOutput = INITIAL_OUTPUT;
  const requested: number[] = [];
  await installRenderTransport(page, () => paneOutput, () => {
    paneOutput = AFTER_SEND_SLID;
  }, requested);
  await openFriendlyTerminal(page);

  const agentTurns = page.locator('[data-testid="terminal-turn-agent"]');
  const userTurns = page.locator('[data-testid="terminal-turn-user"]');
  await expect(agentTurns).toHaveCount(1);
  await expect(agentTurns.first()).toContainText(OLD_REPLY_LINE);

  const composerInput = page.locator('[data-testid="terminal-composer-input"], .terminal-chat-input-field').first();
  const sendButton = page.locator('[data-testid="terminal-send-command"], .terminal-chat-send-btn').first();
  await composerInput.fill(YOU_MESSAGE);
  await sendButton.click();

  await expect(userTurns).toHaveCount(1);
  await expect(userTurns.first()).toContainText(YOU_MESSAGE);
  await expect(agentTurns).toHaveCount(2, { timeout: 15_000 });

  const newAgent = agentTurns.last();
  await expect(newAgent).toContainText(NEW_REPLY_LINE);
  const newText = await newAgent.textContent();
  expect(newText).not.toContain(OLD_REPLY_LINE);
  expect(newText).not.toContain('OLD-REPLY-TAIL');
  expect(newText).not.toContain('OLD-CTX-01');
  await expect(agentTurns.first()).toContainText(OLD_REPLY_LINE);
  expect(requested.length).toBeGreaterThan(0);
});

test('FIX A: first new paragraph survives a second poll that slides it off the capture tail', async ({ page }) => {
  test.setTimeout(60_000);
  const paraOne = 'PARA-ONE-FIRST-LINE';
  const paraTwo = 'PARA-TWO-FIRST-LINE';
  let paneOutput = INITIAL_OUTPUT;
  let sent = false;
  await installRenderTransport(page, () => paneOutput, () => {
    sent = true;
    paneOutput = [
      ...BASELINE_25.slice(8),
      YOU_MESSAGE,
      paraOne,
      'para-one-wrap continues the first paragraph',
      'Working… (6s · esc to interrupt)',
    ].join('\n');
  });
  await openFriendlyTerminal(page);

  const composerInput = page.locator('[data-testid="terminal-composer-input"]').first();
  const sendButton = page.locator('[data-testid="terminal-send-command"]').first();
  await composerInput.fill(YOU_MESSAGE);
  await sendButton.click();

  const newAgent = page.locator('[data-testid="terminal-turn-agent"]').last();
  await expect(newAgent).toContainText(paraOne, { timeout: 15_000 });
  expect(sent).toBe(true);

  paneOutput = [
    'para-one-wrap continues the first paragraph',
    paraTwo,
    'para-two-wrap continues the second paragraph',
    'Working… (8s · esc to interrupt)',
  ].join('\n');

  await expect(newAgent).toContainText(paraOne, { timeout: 15_000 });
  await expect(newAgent).toContainText(paraTwo, { timeout: 15_000 });
});

test('FIX B: multi-line composer text is flattened; POST has no control characters and does not error', async ({ page }) => {
  test.setTimeout(60_000);
  let sentPayload: { command?: string; enter?: boolean } | null = null;
  let paneOutput = INITIAL_OUTPUT;
  await installRenderTransport(page, () => paneOutput, (body) => {
    sentPayload = body as { command?: string; enter?: boolean };
    const command = sentPayload?.command || '';
    paneOutput = [
      ...BASELINE_25.slice(1),
      command,
      'agent reply after flattened echo',
    ].join('\n');
  });
  await openFriendlyTerminal(page);

  const composerInput = page.locator('[data-testid="terminal-composer-input"]');
  const sendButton = page.locator('[data-testid="terminal-send-command"]');
  await composerInput.fill('line one\nline two');
  await sendButton.click();

  await expect.poll(() => sentPayload).not.toBeNull();
  expect(sentPayload).toEqual({ command: 'line one line two', enter: true, clear_first: false });
  expect(CONTROL_CHAR_RE.test(sentPayload!.command || '')).toBe(false);

  await expect(page.locator('.terminal-chat-entry-error')).toHaveCount(0);
  await expect(page.getByText(/unsupported control characters/i)).toHaveCount(0);
  await expect(page.getByText(/Command failed/i)).toHaveCount(0);

  const newAgent = page.locator('[data-testid="terminal-turn-agent"]').last();
  await expect(newAgent).toContainText('agent reply after flattened echo', { timeout: 15_000 });
  const agentText = await newAgent.textContent();
  expect(agentText).not.toContain('line one line two');
  expect(agentText).not.toContain('line one\nline two');
});

test('FIX B: control-only input is not POSTed and shows a local validation message', async ({ page }) => {
  test.setTimeout(60_000);
  let sentPayload: unknown = null;
  await installRenderTransport(page, () => INITIAL_OUTPUT, (body) => {
    sentPayload = body;
  });
  await openFriendlyTerminal(page);

  const composerInput = page.locator('[data-testid="terminal-composer-input"]');
  const sendButton = page.locator('[data-testid="terminal-send-command"]');
  await composerInput.evaluate((el) => {
    const field = el as HTMLTextAreaElement;
    field.value = '\u0001\u0002\u0003\u007F';
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(sendButton).toBeEnabled();
  await sendButton.click();

  await expect(page.getByText(/empty after removing control characters/i)).toBeVisible({ timeout: 10_000 });
  expect(sentPayload).toBeNull();
});

test('FIX B: all C0 controls plus DEL flatten in the POST body', async ({ page }) => {
  test.setTimeout(60_000);
  let sentPayload: { command?: string } | null = null;
  await installRenderTransport(page, () => INITIAL_OUTPUT, (body) => {
    sentPayload = body as { command?: string };
  });
  await openFriendlyTerminal(page);

  let raw = 'start';
  for (let c = 1; c <= 0x1f; c += 1) raw += String.fromCharCode(c);
  raw += `\u007Fend`;

  const composerInput = page.locator('[data-testid="terminal-composer-input"]');
  const sendButton = page.locator('[data-testid="terminal-send-command"]');
  await composerInput.evaluate((el, value) => {
    const field = el as HTMLTextAreaElement;
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }, raw);
  await expect(sendButton).toBeEnabled();
  await sendButton.click();

  await expect.poll(() => sentPayload).not.toBeNull();
  expect(CONTROL_CHAR_RE.test(sentPayload!.command || '')).toBe(false);
  expect(sentPayload!.command).toMatch(/^start/);
  expect(sentPayload!.command).toMatch(/end$/);
});

test('FIX C: bullet-prefixed paragraph first lines survive in the agent turn', async ({ page }) => {
  test.setTimeout(60_000);
  let paneOutput = INITIAL_OUTPUT;
  await installRenderTransport(page, () => paneOutput, () => {
    paneOutput = [
      ...BASELINE_25.slice(1),
      YOU_MESSAGE,
      '• First line of paragraph one',
      'continuation of paragraph one',
      '',
      '• First line of paragraph two',
      'continuation of paragraph two',
      'I will use plan mode for this change.',
      'This is for agents that need a review.',
      'Press enter to cycle through the options in the wizard.',
    ].join('\n');
  });
  await openFriendlyTerminal(page);

  const composerInput = page.locator('[data-testid="terminal-composer-input"]').first();
  const sendButton = page.locator('[data-testid="terminal-send-command"]').first();
  await composerInput.fill(YOU_MESSAGE);
  await sendButton.click();

  const newAgent = page.locator('[data-testid="terminal-turn-agent"]').last();
  await expect(newAgent).toContainText('First line of paragraph one', { timeout: 15_000 });
  await expect(newAgent).toContainText('First line of paragraph two');
  await expect(newAgent).toContainText('continuation of paragraph one');
  await expect(newAgent).toContainText('I will use plan mode for this change.');
  await expect(newAgent).toContainText('for agents that need a review');
  await expect(newAgent).toContainText('to cycle through the options');
});

test('FIX C: a reply longer than 25 and 200 lines is not tail-truncated', async ({ page }) => {
  test.setTimeout(60_000);
  const replyLines = Array.from({ length: 220 }, (_, i) => `REPLY-${i + 1}`);
  let paneOutput = INITIAL_OUTPUT;
  const requested: number[] = [];
  await installRenderTransport(page, () => paneOutput, () => {
    paneOutput = [INITIAL_OUTPUT, YOU_MESSAGE, ...replyLines].join('\n');
  }, requested);
  await openFriendlyTerminal(page);

  const composerInput = page.locator('[data-testid="terminal-composer-input"]').first();
  const sendButton = page.locator('[data-testid="terminal-send-command"]').first();
  await composerInput.fill(YOU_MESSAGE);
  await sendButton.click();

  const newAgent = page.locator('[data-testid="terminal-turn-agent"]').last();
  await expect(newAgent).toContainText('REPLY-1', { timeout: 15_000 });
  await expect(newAgent).toContainText('REPLY-220');
  expect(Math.max(0, ...requested)).toBeGreaterThanOrEqual(200);
});
