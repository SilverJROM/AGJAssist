import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const ACCEPTANCE_IDS = ['R1a', 'R1b', 'R3', 'R4', 'R5'] as const;
const REPORT_PATH = path.resolve(process.env.FENCE_REPORT_PATH || 'fence-report-v1.json');
const APP_ORIGIN = process.env.AGJ_TERMINAL_BASE_URL || 'http://localhost:3210';
const TERMINAL_PATH = `${APP_ORIGIN}/index.html#/terminals`;
const SETTINGS_PATH = `${APP_ORIGIN}/index.html#/settings`;
const TARGET = 'FENCE-TERM:0.0';
const COMMAND = 'fence hello from the phone';

const INITIAL_OUTPUT = [
  'Agent baseline from the live poll.',
  '⏵⏵ bypass permissions on · ctrl+t',
  '▌ Type a message',
  'Working… (5s · esc to interrupt)',
  'gpt-5.3-codex · ~/TGBOTS/AGJAssist',
  '┌──────────────────────────────┐',
  '│ Type a message               │',
  '└──────────────────────────────┘'
].join('\n');

const AFTER_SEND_OUTPUT = [
  INITIAL_OUTPUT,
  COMMAND,
  'Agent follow-up from the next live poll.',
  'Drizzling… (7m 38s · 22.9k tokens · xhigh effort)'
].join('\n');

type FailureKind = 'assert' | 'env' | 'syntax' | 'import' | 'not_found' | 'collect_error' | 'timeout' | 'error';
type FenceFailure = { id: string; kind: FailureKind };

test.beforeEach(async ({ page }) => {
  await page.addInitScript((stub) => {
    // Phone surface: TgApp + mobile pane picker (isTgMiniApp reads Telegram.WebApp.initData).
    (window as unknown as { Telegram: unknown }).Telegram = {
      WebApp: {
        initData: 'terminal-ux-fence',
        ready() {},
        expand() {},
        disableVerticalSwipes() {},
        themeParams: {},
        BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
        HapticFeedback: { selectionChanged() {} },
      },
    };
    localStorage.setItem('agj_token', 'terminal-ux-fence-token');
    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'terminal-ux-fence', username: 'e2e', role: 'owner' }));
    localStorage.removeItem('agj_terminal_conv_font_size');
    localStorage.removeItem('agj_terminal_font_size');
    (globalThis as typeof globalThis & { __AGJ_FENCE_STUB_CHROME_FILTER__?: boolean })
      .__AGJ_FENCE_STUB_CHROME_FILTER__ = stub === 'A1';
  }, process.env.FENCE_STUB || '');
});

test('§7: terminal conversation composes on the served iPhone surface', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const passed: string[] = [];
  const failed: FenceFailure[] = [];
  let outputStage: 'initial' | 'after-send' = 'initial';
  let sentPayload: unknown = null;
  let stubTransformApplied = process.env.FENCE_STUB !== 'A1';
  let reachedSurface = false;

  const writeReport = () => {
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify({
      schema: 'fence-report-v1',
      collected: [...ACCEPTANCE_IDS],
      passed,
      failed
    }, null, 2)}\n`);
  };

  const check = async (id: typeof ACCEPTANCE_IDS[number], assertion: () => Promise<void>) => {
    try {
      await assertion();
      passed.push(id);
    } catch (error) {
      failed.push({ id, kind: error instanceof Error && /timeout/i.test(error.message) ? 'timeout' : 'assert' });
      throw new Error(`FENCE_ASSERT:${id}`);
    }
  };

  const openTerminal = async () => {
    // Select the real session through the production control before shrinking to
    // the iPhone viewport; non-Telegram desktop mode intentionally hides its
    // session tree at mobile width.
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
    reachedSurface = true;
  };

  try {
    if (process.env.FENCE_STUB === 'A1') {
      await page.route('**/terminal-chat-state.js*', async (route) => {
        const response = await route.fetch();
        const source = await response.text();
        const signature = /export function cleanTerminalOutput\s*\(\s*text\s*\)\s*\{/;
        const body = source.replace(
          signature,
          (match) => `${match}\n  if (globalThis.__AGJ_FENCE_STUB_CHROME_FILTER__) return normalizeTerminalOutput(text);`
        );
        stubTransformApplied = body !== source;
        await route.fulfill({
          response,
          body,
          headers: { ...response.headers(), 'content-type': 'text/javascript; charset=utf-8' }
        });
      });
    }

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
          sessions: [{
            session_name: 'FENCE-TERM',
            panes: [{ target: TARGET, command: 'codex' }]
          }]
        })
      });
    });

    await page.route(/\/api\/tmux\/panes\/[^/]+\/output\?lines=\d+$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ output: outputStage === 'initial' ? INITIAL_OUTPUT : AFTER_SEND_OUTPUT })
      });
    });

    await page.route(/\/api\/tmux\/panes\/[^/]+\/send$/, async (route) => {
      sentPayload = route.request().postDataJSON();
      outputStage = 'after-send';
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });

    await openTerminal();

    const initialStatus = page.locator('[data-testid="terminal-status"]');
    const statusBeforeSend = await initialStatus.count() > 0 ? await initialStatus.textContent() : null;

    await check('R1a', async () => {
      const bubble = page.locator('[data-testid="terminal-turn-agent"] .terminal-chat-bubble').first();
      expect(await bubble.count()).toBe(1);
      const metrics = await bubble.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          family: style.fontFamily.toLowerCase(),
          size: Number.parseFloat(style.fontSize),
          lineHeight: Number.parseFloat(style.lineHeight) / Number.parseFloat(style.fontSize)
        };
      });
      expect(metrics.family).not.toContain('monospace');
      expect(metrics.size).toBeGreaterThanOrEqual(16);
      expect(metrics.lineHeight).toBeGreaterThanOrEqual(1.5);
    });

    const commandInput = page.locator('[data-testid="terminal-composer-input"], .terminal-chat-input-field').first();
    const sendButton = page.locator('[data-testid="terminal-send-command"], .terminal-chat-send-btn').first();
    expect(await commandInput.count()).toBe(1);
    expect(await commandInput.isVisible()).toBe(true);
    await commandInput.evaluate((element, command) => {
      const input = element as HTMLTextAreaElement;
      input.value = command;
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: command }));
    }, COMMAND);
    // Call the rendered production control without Playwright's actionability
    // retry masking the intentionally-missing future layout on current HEAD.
    await sendButton.evaluate((element) => (element as HTMLButtonElement).click());
    await page.waitForTimeout(1_500);

    await check('R1b', async () => {
      expect(sentPayload).toEqual({ command: COMMAND, enter: true });
      const agentTurns = page.locator('[data-testid="terminal-turn-agent"]');
      const userTurns = page.locator('[data-testid="terminal-turn-user"]');
      expect(await agentTurns.count()).toBeGreaterThanOrEqual(2);
      expect(await userTurns.count()).toBe(1);
      expect(await userTurns.first().textContent()).toContain(COMMAND);

      const firstAgentId = await agentTurns.first().getAttribute('data-turn-id');
      const latestAgentId = await agentTurns.last().getAttribute('data-turn-id');
      const latestTimestamp = await agentTurns.last().locator('[data-testid="terminal-turn-time"]').textContent();
      expect(firstAgentId).toBeTruthy();
      expect(latestAgentId).toBeTruthy();
      expect(latestAgentId).not.toBe(firstAgentId);

      const agentBox = await agentTurns.last().boundingBox();
      const userBox = await userTurns.first().boundingBox();
      expect(agentBox).not.toBeNull();
      expect(userBox).not.toBeNull();
      expect(userBox!.x).toBeGreaterThan(agentBox!.x);

      await page.waitForTimeout(1_100);
      expect(await agentTurns.last().getAttribute('data-turn-id')).toBe(latestAgentId);
      expect(await agentTurns.last().locator('[data-testid="terminal-turn-time"]').textContent()).toBe(latestTimestamp);
    });

    await check('R5', async () => {
      expect(stubTransformApplied).toBe(true);
      expect(statusBeforeSend).toContain('Working… (5s');
      const status = page.locator('[data-testid="terminal-status"]');
      expect(await status.count()).toBe(1);
      expect(await status.textContent()).toContain('Drizzling… (7m 38s');

      const bubbles = page.locator('[data-testid="terminal-turn-agent"] .terminal-chat-bubble');
      const bubbleText = await bubbles.allTextContents();
      const joined = bubbleText.join('\n');
      expect(joined).not.toContain('⏵⏵');
      expect(joined).not.toContain('▌ Type a message');
      expect(joined).not.toContain('gpt-5.3-codex');
      expect(joined).not.toMatch(/[┌┐└┘]/u);
      expect(joined).not.toContain(COMMAND);
      expect(joined).not.toContain('Working…');
      expect(joined).not.toContain('Drizzling…');
    });

    await check('R3', async () => {
      const bubble = page.locator('[data-testid="terminal-turn-agent"] .terminal-chat-bubble').last();
      const increase = page.locator('[data-testid="terminal-font-increase"]');
      expect(await bubble.count()).toBe(1);
      expect(await increase.count()).toBe(1);
      const before = Number.parseFloat(await bubble.evaluate((element) => getComputedStyle(element).fontSize));
      await increase.click();
      await increase.click();
      await increase.click();
      const after = Number.parseFloat(await bubble.evaluate((element) => getComputedStyle(element).fontSize));
      expect(after).toBe(Math.min(26, before + 3));

      const storage = await page.evaluate(() => ({
        value: localStorage.getItem('agj_terminal_conv_font_size'),
        keys: Object.keys(localStorage).filter((key) => key.includes('terminal_conv_font')),
        css: getComputedStyle(document.documentElement).getPropertyValue('--terminal-conv-font').trim()
      }));
      expect(storage.value).toBe(String(after));
      expect(storage.keys).toEqual(['agj_terminal_conv_font_size']);
      expect(Number.parseFloat(storage.css)).toBe(after);

      await openTerminal();
      const reloadedBubble = page.locator('[data-testid="terminal-turn-agent"] .terminal-chat-bubble').last();
      expect(await reloadedBubble.count()).toBe(1);
      expect(Number.parseFloat(await reloadedBubble.evaluate((element) => getComputedStyle(element).fontSize))).toBe(after);
    });

    await check('R4', async () => {
      const before = Number(await page.evaluate(() => localStorage.getItem('agj_terminal_conv_font_size')));
      await page.goto(SETTINGS_PATH, { waitUntil: 'domcontentloaded' });
      const row = page.locator('[data-testid="terminal-conv-font-settings"]');
      expect(await row.count()).toBe(1);
      const slider = row.locator('input[type="range"]');
      const next = Math.min(26, before + 1);
      await slider.evaluate((element, value) => {
        const input = element as HTMLInputElement;
        input.value = String(value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, next);
      expect(await page.evaluate(() => localStorage.getItem('agj_terminal_conv_font_size'))).toBe(String(next));

      await openTerminal();
      const bubble = page.locator('[data-testid="terminal-turn-agent"] .terminal-chat-bubble').last();
      expect(await bubble.count()).toBe(1);
      expect(Number.parseFloat(await bubble.evaluate((element) => getComputedStyle(element).fontSize))).toBe(next);
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--terminal-conv-font').trim())).toBe(`${next}px`);
    });

    await page.screenshot({ path: testInfo.outputPath('terminal-ux-iphone.png') });
  } catch (error) {
    const isNamedAssertion = error instanceof Error && error.message.startsWith('FENCE_ASSERT:');
    if (!isNamedAssertion) {
      const kind: FailureKind = reachedSurface ? 'assert' : 'env';
      console.error(`[terminal-ux-fence] ${kind} after setup=${reachedSurface}: ${error instanceof Error ? error.message : String(error)}`);
      for (const id of ACCEPTANCE_IDS) {
        if (!passed.includes(id) && !failed.some((item) => item.id === id)) failed.push({ id, kind });
      }
    }
  } finally {
    writeReport();
  }

  expect(failed, `FENCE failures: ${JSON.stringify(failed)}`).toEqual([]);
});

type FrozenTransportHooks = {
  onOutputRequest?: (lines: number | null) => void;
  onCreateSession?: (body: unknown) => void;
};

async function installFrozenTransport(
  page: import('@playwright/test').Page,
  output: string,
  onSend?: (body: unknown) => void,
  hooks: FrozenTransportHooks = {},
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
    if (route.request().method() === 'POST') {
      hooks.onCreateSession?.(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sessions: [{ session_name: 'FENCE-TERM', panes: [{ target: TARGET, command: 'codex' }] }],
      }),
    });
  });
  await page.route(/\/api\/tmux\/panes\/[^/]+\/output/, async (route) => {
    const lines = Number(new URL(route.request().url()).searchParams.get('lines'));
    hooks.onOutputRequest?.(Number.isFinite(lines) ? lines : null);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ output, target: TARGET, lines: 200 }),
    });
  });
  await page.route(/\/api\/tmux\/panes\/[^/]+\/send$/, async (route) => {
    onSend?.(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
}

async function installXtermStub(page: import('@playwright/test').Page) {
  await page.route(/https:\/\/cdn\.jsdelivr\.net\/npm\/xterm@5\.3\.0\/\+esm(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      contentType: 'text/javascript',
      body: `export class Terminal {
        constructor(options) { this.options = options; this.rows = 24; }
        loadAddon() {}
        open(container) { const node = document.createElement('div'); node.className = 'xterm'; container.appendChild(node); }
        refresh() {}
        reset() {}
        write() {}
        onData() { return { dispose() {} }; }
        dispose() {}
      }`,
    });
  });
  await page.route(/https:\/\/cdn\.jsdelivr\.net\/npm\/xterm-addon-fit@0\.8\.0\/\+esm(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      contentType: 'text/javascript',
      body: 'export class FitAddon { fit() {} }',
    });
  });
}

async function selectPaneAndFriendly(page: import('@playwright/test').Page) {
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
  const friendly = page.getByRole('button', { name: /^Friendly$/ }).first();
  if (await friendly.isVisible().catch(() => false)) await friendly.click();
  await expect(page.locator('.terminal-chat-view')).toBeVisible({ timeout: 15_000 });
}

test('A3 R1b R2 production wire — YOU + AGENT bubbles and both POST shapes', async ({ page }) => {
  const posts: unknown[] = [];
  await installFrozenTransport(page, INITIAL_OUTPUT, (body) => posts.push(body));
  await selectPaneAndFriendly(page);
  await expect(page.locator('[data-testid="terminal-turn-agent"]')).toHaveCount(1);
  await page.locator('[data-testid="terminal-composer-input"], .terminal-chat-input-field').first().fill(COMMAND);
  await page.locator('[data-testid="terminal-send-command"], .terminal-chat-send-btn').first().click();
  await expect(page.locator('[data-testid="terminal-turn-user"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="terminal-turn-user"]')).toContainText(COMMAND);
  await page.locator('[data-testid="terminal-send-enter"], .terminal-chat-enter-btn').first().click();
  expect(posts).toEqual(expect.arrayContaining([
    expect.objectContaining({ command: COMMAND, enter: true }),
    expect.objectContaining({ send_enter_only: true }),
  ]));
});

test('A4 R1a R3 R4 R7 type and font — live Settings sync and mobile fit', async ({ page }) => {
  await installFrozenTransport(page, INITIAL_OUTPUT);
  await selectPaneAndFriendly(page);
  await page.setViewportSize({ width: 390, height: 844 });

  const mobileFit = await page.evaluate(() => {
    const surface = document.querySelector('[data-testid="terminal-conversation"], .terminal-chat-view, .terminal-shell, #app') || document.body;
    return {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      overflowX: {
        html: getComputedStyle(document.documentElement).overflowX,
        body: getComputedStyle(document.body).overflowX,
        surface: getComputedStyle(surface).overflowX,
      },
      surface2: getComputedStyle(document.documentElement).getPropertyValue('--surface-2').trim(),
    };
  });
  expect(mobileFit.scrollWidth).toBeLessThanOrEqual(mobileFit.clientWidth);
  expect(Object.values(mobileFit.overflowX)).not.toContain('hidden');
  expect(mobileFit.surface2).not.toEqual('');

  await page.goto(SETTINGS_PATH, { waitUntil: 'domcontentloaded' });
  const settingsRow = page.locator('[data-testid="terminal-conv-font-settings"]');
  await expect(settingsRow).toHaveCount(1);
  const settingsControl = settingsRow.locator('input[type="range"]');
  await expect(settingsControl).toHaveCount(1);
  const settingsSize = 20;
  await settingsControl.evaluate((element, value) => {
    const input = element as HTMLInputElement;
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, settingsSize);
  expect(await page.evaluate(() => localStorage.getItem('agj_terminal_conv_font_size'))).toBe(String(settingsSize));

  await selectPaneAndFriendly(page);
  const sample = page.locator('[data-testid="terminal-turn-agent"] .terminal-chat-bubble').first();
  await expect(sample).toBeVisible();
  expect(Number.parseFloat(await sample.evaluate((el) => getComputedStyle(el).fontSize))).toBe(settingsSize);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--terminal-conv-font').trim())).toBe(`${settingsSize}px`);

  const metrics = await sample.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      size: parseFloat(cs.fontSize),
      lh: parseFloat(cs.lineHeight) / parseFloat(cs.fontSize),
      family: cs.fontFamily.toLowerCase(),
      css: getComputedStyle(document.documentElement).getPropertyValue('--terminal-conv-font').trim(),
    };
  });
  expect(metrics.size).toBeGreaterThanOrEqual(16);
  expect(metrics.lh).toBeGreaterThanOrEqual(1.5);
  expect(metrics.family).not.toMatch(/jetbrains|fira code|monospace/);
  expect(metrics.css).toBe(`${metrics.size}px`);

  const plus = page.locator('[data-testid="terminal-font-increase"]');
  await expect(plus).toHaveCount(1);
  const before = metrics.size;
  await plus.click();
  await plus.click();
  await plus.click();
  const after = await sample.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(after).toBe(Math.min(26, before + 3));
  const inlineStorage = await page.evaluate(() => ({
    value: localStorage.getItem('agj_terminal_conv_font_size'),
    keys: Object.keys(localStorage).filter((key) => key.includes('terminal_conv_font')),
    css: getComputedStyle(document.documentElement).getPropertyValue('--terminal-conv-font').trim(),
  }));
  expect(inlineStorage).toEqual({
    value: String(after),
    keys: ['agj_terminal_conv_font_size'],
    css: `${after}px`,
  });
});

test('A6 R6 R7 single topbar — controls still perform their functions at 390', async ({ page, browser }) => {
  test.setTimeout(60_000);
  const requestedLines: Array<number | null> = [];
  const createdSessions: unknown[] = [];
  await installXtermStub(page);
  await installFrozenTransport(page, INITIAL_OUTPUT, undefined, {
    onOutputRequest: (lines) => requestedLines.push(lines),
    onCreateSession: (body) => createdSessions.push(body),
  });
  await selectPaneAndFriendly(page);

  const menu = page.locator('[data-testid="terminal-menu"], [data-term-menu], button:has-text("☰")');
  const menuSheet = page.locator('[data-testid="terminal-menu-sheet"], [data-term-menu-sheet], .terminal-menu-sheet, [role="menu"]').first();
  const openMenu = async () => {
    if (!(await menuSheet.isVisible().catch(() => false))) await menu.click();
    await expect(menuSheet).toBeVisible();
  };

  await expect(menu).toHaveCount(1);
  await openMenu();
  await expect(menuSheet.getByText(/^connected$/i).first()).toBeVisible();

  const linesControl = menuSheet.locator('.terminal-chat-line-picker select, [data-testid="terminal-lines"], [data-lines]').first();
  const values = await linesControl.locator('option').evaluateAll((opts) =>
    opts.map((o) => (o as HTMLOptionElement).value),
  );
  for (const n of ['25', '50', '100', '150', '200']) expect(values).toContain(n);
  const linesRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return /\/api\/tmux\/panes\/[^/]+\/output$/.test(url.pathname) && url.searchParams.get('lines') === '150';
  });
  await linesControl.selectOption('150');
  await linesRequest;
  expect(requestedLines).toContain(150);

  const lastUpdated = page.locator('[data-testid="terminal-last-updated"], [data-terminal-last-updated], .terminal-chat-detail-pill').filter({ hasText: /updated/i }).first();
  await expect(lastUpdated).toBeVisible();
  const updatedBefore = await lastUpdated.textContent();
  await page.waitForTimeout(1_100);
  await openMenu();
  const refreshRequest = page.waitForRequest((request) => /\/api\/tmux\/panes\/[^/]+\/output\?lines=150$/.test(request.url()));
  await menuSheet.getByRole('button', { name: /^Refresh$/ }).click();
  await refreshRequest;
  await expect.poll(() => lastUpdated.textContent()).not.toBe(updatedBefore);

  await openMenu();
  await menuSheet.getByRole('button', { name: /^Raw$/ }).click();
  await expect(page.locator('.terminal-panel .xterm')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.terminal-chat-view')).toHaveCount(0);

  await openMenu();
  await menuSheet.getByRole('button', { name: /^Friendly$/ }).click();
  await expect(page.locator('.terminal-chat-view')).toBeVisible();

  await openMenu();
  await menuSheet.getByRole('button', { name: /^\+?\s*New(?: Session)?$/i }).click();
  const createModal = page.locator('.modal', { hasText: 'New Tmux Session' });
  await expect(createModal).toBeVisible();
  await createModal.locator('input').fill('fence-created');
  await createModal.getByRole('button', { name: /^Create$/ }).click();
  await expect.poll(() => createdSessions.length).toBe(1);
  expect(createdSessions[0]).toEqual(expect.objectContaining({ name: 'fence-created' }));
  await expect(createModal).toHaveCount(0);

  await openMenu();
  const fullScreen = menuSheet.getByRole('button', { name: /^Full Screen$/ });
  await expect(fullScreen).toHaveCount(1);
  await fullScreen.click();
  await expect(page.locator('.terminal-fullscreen-overlay')).toBeVisible();
  await expect(page.locator('body')).toHaveClass(/tg-terminal-focus/);
  await openMenu();
  await menuSheet.getByRole('button', { name: /^(?:Close Full|Collapse)$/ }).click();
  await expect(page.locator('.terminal-fullscreen-overlay')).toHaveCount(0);

  const headers = page.locator('.terminal-shell-header, .terminal-chat-header, [data-term-topbar]');
  expect(await headers.count()).toBeLessThanOrEqual(1);
  const mobileFit = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(mobileFit.scrollWidth).toBeLessThanOrEqual(mobileFit.clientWidth);

  const desktopPage = await browser.newPage();
  try {
    await desktopPage.addInitScript(() => {
      localStorage.setItem('agj_token', 'terminal-ux-fence-token');
      localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'terminal-ux-fence', username: 'e2e', role: 'owner' }));
    });
    await installXtermStub(desktopPage);
    await installFrozenTransport(desktopPage, INITIAL_OUTPUT);
    await selectPaneAndFriendly(desktopPage);
    const desktopMenu = desktopPage.locator('[data-testid="terminal-menu"], [data-term-menu], button:has-text("☰")');
    await desktopMenu.click();
    const desktopSheet = desktopPage.locator('[data-testid="terminal-menu-sheet"], [data-term-menu-sheet], .terminal-menu-sheet, [role="menu"]').first();
    await expect(desktopSheet).toBeVisible();
    await expect(desktopSheet.getByRole('button', { name: /^Full Screen$/ })).toHaveCount(0);
  } finally {
    await desktopPage.close();
  }

  await openMenu();
  await menuSheet.getByRole('button', { name: /^Disconnect$/ }).click();
  await expect(page.getByText('No terminal selected')).toBeVisible();
});

test('A7 R8 show-raw reveals stripped chrome', async ({ page }) => {
  await installFrozenTransport(page, INITIAL_OUTPUT);
  await selectPaneAndFriendly(page);
  const toggle = page.locator('[data-testid="terminal-show-raw"], [data-show-raw]');
  await expect(toggle).toHaveCount(1);
  await toggle.click();
  const raw = page.locator('[data-testid="terminal-raw-chrome"], [data-raw-chrome], .terminal-chat-raw');
  await expect(raw).toBeVisible();
  await expect(raw).toContainText('⏵⏵');
});
