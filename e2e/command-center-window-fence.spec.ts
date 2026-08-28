import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ACCEPTANCE_IDS = ['G1','G2','G3','H1','H2','H3','I1','I2','J1','J2'] as const;
type AcceptanceId = typeof ACCEPTANCE_IDS[number];
type Failure = { id: AcceptanceId; kind: 'assert'; message?: string };

const REPORT_PATH = path.resolve(process.env.FENCE_REPORT_PATH || 'fence-report-v1.json');
const APP_ORIGIN = process.env.FENCE_ORIGIN || 'http://localhost:3210';
const OWNER_TOKEN = process.env.OWNER_TOKEN || 'test-token';
const AUTH_HEADERS = { authorization: `Bearer ${OWNER_TOKEN}` };

// Literal Telegram WebApp themeParams fixtures for H3 — distinct, product-owned
// inputs driven through the real applyTgTheme() path (src/web/public/app.js),
// never inferred from the mechanism under test.
const LIGHT_THEME_PARAMS = {
  bg_color: '#ffffff',
  text_color: '#111111',
  hint_color: '#555555',
  secondary_bg_color: '#f2f2f2',
  section_bg_color: '#eeeeee',
  section_separator_color: '#dddddd',
  button_color: '#2481cc',
  button_text_color: '#ffffff',
  accent_text_color: '#2481cc',
};
const DARK_THEME_PARAMS = {
  bg_color: '#0b0b0f',
  text_color: '#f5f5f5',
  hint_color: '#9a9a9a',
  secondary_bg_color: '#17171c',
  section_bg_color: '#141419',
  section_separator_color: '#26262c',
  button_color: '#5288c1',
  button_text_color: '#ffffff',
  accent_text_color: '#5288c1',
};

const CONTRIBUTOR_TESTS = [
  'test_f1_refresh_from_session_surface_visible',
  'test_f2_draft_and_switcher_surfaces_are_rendered',
  'test_f3_refresh_action_and_draft_reload_keep_composer_usable',
  'test_f4_header_v2_collapses_without_losing_command_center_chrome',
  'test_f5_phone_dropdown_and_wide_switcher_are_available',
  'test_f6_window_theme_attribute_is_applied',
] as const;

function shardPath(testName: string): string {
  return `${REPORT_PATH}.${testName}.json`;
}

function readShard(testName: string): { passed: AcceptanceId[]; failed: Failure[] } | null {
  try {
    return JSON.parse(fs.readFileSync(shardPath(testName), 'utf8'));
  } catch {
    return null;
  }
}

function writeReport() {
  const passed = new Set<AcceptanceId>();
  const failed: Failure[] = [];
  for (const testName of CONTRIBUTOR_TESTS) {
    const shard = readShard(testName);
    for (const id of shard?.passed || []) passed.add(id);
    failed.push(...(shard?.failed || []));
  }
  fs.writeFileSync(
    REPORT_PATH,
    JSON.stringify({
      schema: 'fence-report-v1',
      collected: [...ACCEPTANCE_IDS],
      passed: ACCEPTANCE_IDS.filter(id => passed.has(id) && !failed.some(f => f.id === id)),
      failed,
    }, null, 2) + '\n',
  );
}

async function check(
  localPassed: Set<AcceptanceId>,
  localFailed: Failure[],
  id: AcceptanceId,
  assertion: () => Promise<void> | void,
) {
  try {
    await assertion();
    localPassed.add(id);
  } catch (e) {
    localFailed.push({ id, kind: 'assert', message: e instanceof Error ? e.message : String(e) });
  }
}

function uniqueSession(prefix: string, workerIndex: number): string {
  return `f7-${prefix}-${process.pid}-${workerIndex}-${Date.now()}`;
}

function createSession(sessionName: string) {
  const result = spawnSync('tmux', [
    'new-session',
    '-d',
    '-s',
    sessionName,
    'bash',
    '-lc',
    `printf ${JSON.stringify(`${sessionName} agent output fixture\\n`)}; exec sleep 300`,
  ], { encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
}

function killSession(sessionName: string) {
  spawnSync('tmux', ['kill-session', '-t', sessionName], { encoding: 'utf8' });
}

function paneTargetFor(sessionName: string): string {
  const result = spawnSync('tmux', ['display-message', '-p', '-t', sessionName, '#S:#I.#P'], { encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
}

// Installs a fake window.Telegram.WebApp BEFORE the app's own theme-detection
// script runs (addInitScript fires ahead of any page script on every future
// navigation). Captures the themeChanged handler so a later evaluate() can
// re-drive the SAME product path applyTgTheme() uses on a real device theme
// flip, without a reload.
// index.html also loads the REAL telegram-web-app.js SDK from telegram.org
// after our addInitScript runs but before app.js — that script overwrites
// window.Telegram.WebApp with its own (initData: '') object outside an actual
// Telegram client, silently discarding our fixture. Stub the request so our
// mock survives to app.js's isTgMiniApp check.
async function installTelegramThemeFixture(page, themeParams: Record<string, string>) {
  await page.route('https://telegram.org/js/telegram-web-app.js', (route) => {
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* fence-stubbed: real Telegram WebApp SDK intentionally not loaded */' });
  });
  await page.addInitScript((tp) => {
    (window as any).Telegram = {
      WebApp: {
        initData: 'fence-theme-fixture',
        themeParams: tp,
        ready() {},
        expand() {},
        disableVerticalSwipes() {},
        onEvent(name: string, cb: () => void) {
          if (name === 'themeChanged') (window as any).__fenceApplyTheme = cb;
        },
      },
    };
  }, themeParams);
}

async function ensureTabsExpandedIfNeeded(page) {
  const switcher = page.locator('[data-testid="agent-group-switcher"]');
  const isHidden = await switcher.evaluate(el => el?.hasAttribute('hidden')).catch(() => true);
  if (isHidden) {
    const btn = page.locator('[data-testid="tabs-collapse"]');
    if (await btn.isVisible().catch(() => false)) {
      await btn.click();
    }
  }
}

async function installOwnerSession(page, primaryName: string, secondaryName: string, primaryTarget: string, secondaryTarget: string, extraSiblingNames: string[] = []) {
  await page.addInitScript(({ ownerToken, primaryName, secondaryName, primaryTarget, secondaryTarget, extraSiblingNames }) => {
    localStorage.setItem('agj_token', ownerToken);
    localStorage.setItem('agj_user', JSON.stringify({ id: 1000000001, name: 'jrom', role: 'owner' }));
    localStorage.setItem('agj_terminal_active_group', 'f7-window');
    localStorage.setItem('agj_terminal_groups', JSON.stringify([
      { id: 'f7-window', name: 'F7 Window', sessions: [primaryName, secondaryName, ...extraSiblingNames] },
    ]));
    localStorage.setItem(`agj_terminal_draft:friendly-terminal:${encodeURIComponent(primaryTarget)}`, 'test draft');
    localStorage.setItem(`agj_terminal_draft:friendly-terminal:${encodeURIComponent(secondaryTarget)}`, 'other draft');
  }, { ownerToken: OWNER_TOKEN, primaryName, secondaryName, primaryTarget, secondaryTarget, extraSiblingNames });
}

// extraSiblingCount: extra idle tmux sessions added to the same group so the
// wide header's tab strip actually overflows (J2 needs real scrollable
// content — a single sibling tab never overflows the 1024px header).
async function openAgentWindow(page, testInfo, prefix: string, sessions: string[], opts: { extraSiblingCount?: number } = {}) {
  const extraSiblingCount = opts.extraSiblingCount || 0;
  const primaryName = uniqueSession(`${prefix}-a`, testInfo.workerIndex);
  const secondaryName = uniqueSession(`${prefix}-b`, testInfo.workerIndex);
  createSession(primaryName);
  sessions.push(primaryName);
  createSession(secondaryName);
  sessions.push(secondaryName);
  const extraSiblingNames: string[] = [];
  for (let i = 0; i < extraSiblingCount; i++) {
    const extraName = uniqueSession(`${prefix}-x${i}`, testInfo.workerIndex);
    createSession(extraName);
    sessions.push(extraName);
    extraSiblingNames.push(extraName);
  }
  const primaryTarget = paneTargetFor(primaryName);
  const secondaryTarget = paneTargetFor(secondaryName);

  const allNames = [primaryName, secondaryName, ...extraSiblingNames];
  await expect.poll(async () => {
    const resp = await page.request.get(`${APP_ORIGIN}/api/tmux/sessions`, { headers: AUTH_HEADERS });
    const json = await resp.json().catch(() => ({}));
    const names = new Set((json.sessions || []).map((s: any) => s.session_name));
    return allNames.every((n) => names.has(n));
  }, { timeout: 10000 }).toBe(true);

  await installOwnerSession(page, primaryName, secondaryName, primaryTarget, secondaryTarget, extraSiblingNames);
  await page.goto(`${APP_ORIGIN}/index.html#/terminals`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="terminal-group-tab"][data-group-id="all"]').click();
  const row = page.locator('.terminal-list-name').filter({ hasText: primaryName }).first();
  await expect(row).toBeVisible({ timeout: 10000 });
  await row.click();
}

async function finishContributor(testName: string, localPassed: Set<AcceptanceId>, localFailed: Failure[]) {
  fs.writeFileSync(
    shardPath(testName),
    JSON.stringify({ passed: [...localPassed], failed: localFailed }, null, 2) + '\n',
  );
  writeReport();
  expect(localFailed, `FENCE failures: ${JSON.stringify(localFailed)}`).toEqual([]);
}

test.beforeEach(async ({}, testInfo) => {
  try { fs.unlinkSync(shardPath(testInfo.title)); } catch {}
});

test.afterAll(() => {
  writeReport();
});

test('test_f1_refresh_from_session_surface_visible', async ({ page }, testInfo) => {
  const localPassed = new Set<AcceptanceId>();
  const localFailed: Failure[] = [];
  const sessions: string[] = [];
  try {
    try {
      await openAgentWindow(page, testInfo, 'f1', sessions);
    } catch (e) {
      localFailed.push({ id: 'G3', kind: 'assert', message: e instanceof Error ? e.message : String(e) });
    }

    await check(localPassed, localFailed, 'G3', async () => {
      const refresh = page.locator('[data-testid="terminal-refresh"]');
      await expect(refresh).toBeVisible();
    });
  } finally {
    try {
      await finishContributor(testInfo.title, localPassed, localFailed);
    } finally {
      for (const sessionName of sessions) killSession(sessionName);
    }
  }
});

test('test_f2_draft_and_switcher_surfaces_are_rendered', async ({ page }, testInfo) => {
  const localPassed = new Set<AcceptanceId>();
  const localFailed: Failure[] = [];
  const sessions: string[] = [];
  try {
    try {
      await openAgentWindow(page, testInfo, 'f2', sessions);
    } catch (e) {
      localFailed.push({ id: 'G1', kind: 'assert', message: e instanceof Error ? e.message : String(e) });
    }

    await check(localPassed, localFailed, 'G1', async () => {
      const draft = page.locator('[data-testid="terminal-draft"]');
      await expect(draft).toBeVisible();
    });

    await ensureTabsExpandedIfNeeded(page);
    await check(localPassed, localFailed, 'G2', async () => {
      const switcher = page.locator('[data-testid="agent-group-switcher"]');
      await expect(switcher).toBeVisible();
    });
  } finally {
    try {
      await finishContributor(testInfo.title, localPassed, localFailed);
    } finally {
      for (const sessionName of sessions) killSession(sessionName);
    }
  }
});

test('test_f3_refresh_action_and_draft_reload_keep_composer_usable', async ({ page }, testInfo) => {
  const localPassed = new Set<AcceptanceId>();
  const localFailed: Failure[] = [];
  const sessions: string[] = [];
  try {
    try {
      await openAgentWindow(page, testInfo, 'f3', sessions);
    } catch (e) {
      localFailed.push({ id: 'I1', kind: 'assert', message: e instanceof Error ? e.message : String(e) });
    }

    await check(localPassed, localFailed, 'I1', async () => {
      const refreshBtn = page.locator('[data-testid="terminal-refresh"]');
      await expect(refreshBtn).toBeVisible();
      await refreshBtn.click();
      await expect(page.locator('[data-testid="terminal-turn-agent"]')).toBeVisible();
    });

    await check(localPassed, localFailed, 'I2', async () => {
      const draftInput = page.locator('[data-testid="terminal-composer-input"]');
      await expect(draftInput).toBeVisible();
      await draftInput.fill('test draft');
      await page.reload({ waitUntil: 'domcontentloaded' });
      // Re-select primary terminal after reload to ensure composer is active and draft is restored
      const primaryName = sessions[0];
      await page.waitForSelector('.terminal-list-name', { timeout: 15000 });
      const row = page.locator('.terminal-list-name').filter({ hasText: primaryName }).first();
      await expect(row).toBeVisible({ timeout: 15000 });
      await row.click();
      await page.waitForSelector('[data-testid="terminal-composer-input"]', { timeout: 30000 });
      const draftInputAfter = page.locator('[data-testid="terminal-composer-input"]');
      await expect(draftInputAfter).toBeVisible();
      await expect(draftInputAfter).toHaveValue('test draft');
    });
  } finally {
    try {
      await finishContributor(testInfo.title, localPassed, localFailed);
    } finally {
      for (const sessionName of sessions) killSession(sessionName);
    }
  }
});

test('test_f4_header_v2_collapses_without_losing_command_center_chrome', async ({ page }, testInfo) => {
  const localPassed = new Set<AcceptanceId>();
  const localFailed: Failure[] = [];
  const sessions: string[] = [];
  try {
    try {
      await openAgentWindow(page, testInfo, 'f4', sessions);
    } catch (e) {
      localFailed.push({ id: 'H1', kind: 'assert', message: e instanceof Error ? e.message : String(e) });
    }

    await check(localPassed, localFailed, 'H1', async () => {
      const header = page.locator('[data-testid="terminal-header-v2"]');
      await expect(header).toBeVisible();
      const switcher = page.locator('[data-testid="agent-group-switcher"]');
      const isHidden = await switcher.evaluate(el => el.hasAttribute('hidden'));
      expect(isHidden).toBe(true);
    });

    await check(localPassed, localFailed, 'H2', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      const header = page.locator('[data-testid="command-center-header"]');
      await expect(header).toBeVisible();
      const box = await header.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThan(0);
    });
  } finally {
    try {
      await finishContributor(testInfo.title, localPassed, localFailed);
    } finally {
      for (const sessionName of sessions) killSession(sessionName);
    }
  }
});

test('test_f5_phone_dropdown_and_wide_switcher_are_available', async ({ page }, testInfo) => {
  const localPassed = new Set<AcceptanceId>();
  const localFailed: Failure[] = [];
  const sessions: string[] = [];
  try {
    try {
      // extraSiblingCount forces the wide tab strip to overflow — J2 needs a
      // real draggable scrubber, which a single non-overflowing tab never has.
      await openAgentWindow(page, testInfo, 'f5', sessions, { extraSiblingCount: 4 });
    } catch (e) {
      localFailed.push({ id: 'J1', kind: 'assert', message: e instanceof Error ? e.message : String(e) });
    }

    await ensureTabsExpandedIfNeeded(page);
    await check(localPassed, localFailed, 'J1', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      const dropdown = page.locator('[data-testid="agent-group-switcher-dropdown"]');
      await expect(dropdown).toBeVisible();
    });

    await ensureTabsExpandedIfNeeded(page);
    await check(localPassed, localFailed, 'J2', async () => {
      await page.setViewportSize({ width: 1024, height: 800 });
      const switcher = page.locator('[data-testid="agent-group-switcher"]');
      await expect(switcher).toBeVisible();
      const tabs = page.locator('[data-testid="terminal-header-tab"]');
      const count = await tabs.count();
      expect(count).toBeGreaterThan(0);

      // Prove the scrubber is a real, working drag control: grab it and drag
      // left, then assert the tab strip's scrollLeft actually moved off 0.
      // (Dragging left increases clientX-to-startX delta positive per the
      // product's onPointerDown handler in src/web/public/app.js.)
      const scrubber = page.locator('[data-testid="agent-group-switcher-scrubber"]');
      await expect(scrubber).toBeVisible();
      const beforeScrollLeft = await switcher.evaluate((el) => el.scrollLeft);
      expect(beforeScrollLeft).toBe(0);
      const box = await scrubber.boundingBox();
      if (!box) throw new Error('agent-group-switcher-scrubber has no bounding box');
      const startX = box.x + box.width / 2;
      const startY = box.y + box.height / 2;
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX - 140, startY, { steps: 10 });
      await page.mouse.up();
      const afterScrollLeft = await switcher.evaluate((el) => el.scrollLeft);
      expect(afterScrollLeft).toBeGreaterThan(beforeScrollLeft);

      // Prove the wide path switches the active agent identically to the
      // narrow dropdown path: click a non-active tab, assert the header's
      // session-name target actually moves to that tab's literal session.
      const nonActiveTab = tabs.first();
      const clickedLabel = ((await nonActiveTab.textContent()) || '').replace(/\s*•\s*$/, '').trim();
      expect(clickedLabel.length).toBeGreaterThan(0);
      expect(clickedLabel).not.toBe(sessions[0]);
      await nonActiveTab.click();
      const sessionName = page.locator('[data-testid="terminal-session-name"]');
      await expect(sessionName).toContainText(clickedLabel);
      await expect(sessionName).not.toContainText(sessions[0]);
    });
  } finally {
    try {
      await finishContributor(testInfo.title, localPassed, localFailed);
    } finally {
      for (const sessionName of sessions) killSession(sessionName);
    }
  }
});

test('test_f6_window_theme_attribute_is_applied', async ({ page }, testInfo) => {
  const localPassed = new Set<AcceptanceId>();
  const localFailed: Failure[] = [];
  const sessions: string[] = [];
  try {
    try {
      // Drive the real Telegram device-theme path (window.Telegram.WebApp),
      // not a matchMedia/class-absence fallback — must be registered before
      // openAgentWindow's page.goto so app.js's isTgMiniApp detection sees it.
      await installTelegramThemeFixture(page, LIGHT_THEME_PARAMS);
      await openAgentWindow(page, testInfo, 'f6', sessions);
    } catch (e) {
      localFailed.push({ id: 'H3', kind: 'assert', message: e instanceof Error ? e.message : String(e) });
    }

    await check(localPassed, localFailed, 'H3', async () => {
      // Literal input 1: light. Assert the product actually applied it —
      // not synthesized from the absence of a class.
      const lightState = await page.evaluate(() => ({
        tgLight: document.body.classList.contains('tg-light'),
        rootBg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
        rootText: getComputedStyle(document.documentElement).getPropertyValue('--text').trim(),
      }));
      expect(lightState.tgLight).toBe(true);
      expect(lightState.rootBg).toBe(LIGHT_THEME_PARAMS.bg_color);
      expect(lightState.rootText).toBe(LIGHT_THEME_PARAMS.text_color);
      expect(lightState.rootBg).not.toBe(lightState.rootText);

      // Literal input 2: dark, driven through the SAME product mechanism —
      // Telegram's themeChanged event handler (captured as __fenceApplyTheme)
      // — not a page reload and not a second, test-invented code path.
      await page.evaluate((tp) => {
        (window as any).Telegram.WebApp.themeParams = tp;
        (window as any).__fenceApplyTheme?.();
      }, DARK_THEME_PARAMS);

      const darkState = await page.evaluate(() => {
        const shell = document.querySelector('.terminal-shell');
        return {
          tgLight: document.body.classList.contains('tg-light'),
          tgThemeBg: getComputedStyle(document.documentElement).getPropertyValue('--tg-theme-bg-color').trim(),
          shellBg: shell ? getComputedStyle(shell).getPropertyValue('--bg').trim() : null,
          shellText: shell ? getComputedStyle(shell).getPropertyValue('--text').trim() : null,
        };
      });
      expect(darkState.tgLight).toBe(false);
      expect(darkState.tgThemeBg).toBe(DARK_THEME_PARAMS.bg_color);
      // The terminal surface itself (not just :root) must carry the dark
      // product tokens — this is the "remains readable" half of OG H3.
      expect(darkState.shellBg).toBe(DARK_THEME_PARAMS.bg_color);
      expect(darkState.shellText).toBe(DARK_THEME_PARAMS.text_color);
      expect(darkState.shellBg).not.toBe(darkState.shellText);
      expect(darkState.shellBg).not.toBe(lightState.rootBg);
    });
  } finally {
    try {
      await finishContributor(testInfo.title, localPassed, localFailed);
    } finally {
      for (const sessionName of sessions) killSession(sessionName);
    }
  }
});
