import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const APP_ORIGIN = process.env.AGJ_TERMINAL_BASE_URL || 'http://localhost:3210';
const VALIDATION_DIR = path.join(process.cwd(), 'AGJ_Upgrade/command-center-2026-08-26/validation');
const SESSION_NAMES = [
  'alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot',
  'golf', 'hotel', 'india', 'juliet', 'kilo', 'lima',
];

const targetFor = (name: string) => `${name}:0.0`;

async function stubCommandCenter(page) {
  await page.addInitScript(({ sessions }) => {
    (window as unknown as { Telegram: unknown }).Telegram = {
      WebApp: {
        initData: 'command-center-switcher',
        ready() {}, expand() {}, disableVerticalSwipes() {},
        themeParams: {}, onEvent() {}, offEvent() {},
        BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
        HapticFeedback: { selectionChanged() {} },
      },
    };
    localStorage.setItem('agj_token', 'command-center-switcher-token');
    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'e2e', username: 'e2e', role: 'owner' }));
    localStorage.setItem('agj_terminal_groups', JSON.stringify([{ id: 'g1', name: 'Group1', sessions }]));
    localStorage.setItem('agj_terminal_active_group', 'g1');
    localStorage.setItem(`agj_terminal_draft:friendly-terminal:${encodeURIComponent('bravo:0.0')}`, 'literal bravo draft');
  }, { sessions: SESSION_NAMES });

  await page.route(/telegram-web-app\.js/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.route(/\/api\/auth\/me(?:\?.*)?$/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ id: 1, username: 'e2e', display_name: 'e2e', role: 'owner', totp_enabled: false }),
  }));
  await page.route('**/api/auth/telegram', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ token: 'command-center-switcher-token', user: { id: 1, username: 'e2e', displayName: 'e2e', role: 'owner' } }),
  }));
  await page.route(/\/api\/safety\/patterns(?:\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"patterns":[]}' }));
  await page.route(/\/api\/terminal\/groups(?:\?.*)?$/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ groups: [{ id: 'g1', name: 'Group1', sessions: SESSION_NAMES }], activeGroup: 'g1' }),
  }));
  await page.route(/\/api\/tmux\/sessions(?:\?.*)?$/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      sessions: SESSION_NAMES.map((name, index) => ({
        session_name: name,
        panes: [{ target: targetFor(name), command: 'claude', activity: 100 - index, busy: name === 'alpha' }],
      })),
    }),
  }));
  await page.route(/\/api\/tmux\/panes\/[^/]+\/output(?:\?.*)?$/, (route) => {
    const url = route.request().url();
    const target = decodeURIComponent(url.split('/panes/')[1]?.split('/output')[0] || '');
    const name = target.split(':')[0] || 'unknown';
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ output: `* ${name} ready\n| Type`, target, lines: 200 }),
    });
  });
  await page.route('**/api/agent-reminders/active', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"reminders":[]}' }));
  await page.route('**/api/agent-wakeups/pending', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"wakeups":[]}' }));
  await page.route('**/api/summary-agents/*/summaries', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"summaries":[]}' }));
  await page.route('**/api/summary-endpoints', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"endpoints":[]}' }));
}

async function openAlphaWithExpandedSwitcher(page, width: number) {
  await page.setViewportSize({ width, height: 820 });
  await page.goto(`${APP_ORIGIN}/index.html#/terminals`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="terminal-session-row"]', { state: 'visible' });
  await page.locator(`[data-testid="terminal-session-row"][data-session-target="${targetFor('alpha')}"]`).click({ position: { x: 24, y: 18 } });
  await expect(page.locator('[data-testid="terminal-session-name"]')).toContainText('alpha');
  if (width >= 900) await page.locator('[data-testid="tabs-collapse"]').click();
}

async function writeEvidence(page, label: string) {
  fs.mkdirSync(VALIDATION_DIR, { recursive: true });
  await page.screenshot({ path: path.join(VALIDATION_DIR, `${label}.png`), fullPage: true });
  const snapshot = await page.evaluate(() => {
    const header = document.querySelector('[data-testid="terminal-header-v2"]');
    const dropdown = document.querySelector('[data-testid="agent-group-switcher-dropdown"]');
    const select = dropdown?.querySelector('select');
    const strip = document.querySelector('[data-testid="agent-group-switcher"]') as HTMLElement | null;
    const scrubber = header?.querySelector('[data-testid="agent-group-switcher-scrubber"]') as HTMLElement | null;
    return {
      activeName: document.querySelector('[data-testid="terminal-session-name"]')?.textContent,
      dropdownDisplay: dropdown ? getComputedStyle(dropdown).display : null,
      dropdownRect: dropdown ? dropdown.getBoundingClientRect().toJSON() : null,
      selectValue: (select as HTMLSelectElement | null)?.value ?? null,
      selectOptions: select ? [...select.options].map((option) => ({
        text: option.textContent,
        value: option.value,
        className: option.className,
      })) : [],
      stripDisplay: strip ? getComputedStyle(strip).display : null,
      stripScroll: strip ? { left: strip.scrollLeft, clientWidth: strip.clientWidth, scrollWidth: strip.scrollWidth } : null,
      visibleTabs: [...document.querySelectorAll('[data-testid="terminal-header-tab"]')]
        .filter((element) => (element as HTMLElement).offsetParent !== null)
        .map((element) => element.textContent),
      scrubberDisplay: scrubber ? getComputedStyle(scrubber).display : null,
      scrubberRect: scrubber ? scrubber.getBoundingClientRect().toJSON() : null,
      controlsRect: document.querySelector('.cc-ctrlcluster')?.getBoundingClientRect().toJSON() ?? null,
      headerHtml: header?.outerHTML,
    };
  });
  fs.writeFileSync(path.join(VALIDATION_DIR, `${label}-dom.txt`), JSON.stringify(snapshot, null, 2));
}

test.beforeEach(async ({ page }) => {
  await stubCommandCenter(page);
});

test('phone width uses a visible full-group dropdown with current status and draft markers', async ({ page }) => {
  await openAlphaWithExpandedSwitcher(page, 390);
  await writeEvidence(page, 'F5-narrow-a3');

  const header = page.locator('[data-testid="terminal-header-v2"]');
  const dropdown = page.locator('[data-testid="agent-group-switcher-dropdown"]');
  const select = dropdown.locator('select');

  await expect(dropdown).toBeVisible();
  const narrowGeometry = await page.evaluate(() => {
    const dropdown = document.querySelector('[data-testid="agent-group-switcher-dropdown"]') as HTMLElement | null;
    const controls = document.querySelector('.cc-ctrlcluster') as HTMLElement | null;
    if (!dropdown || !controls) throw new Error('missing switcher or controls geometry');
    const d = dropdown.getBoundingClientRect();
    const c = controls.getBoundingClientRect();
    return { dropdownWidth: d.width, dropdownRight: d.right, controlsLeft: c.left };
  });
  expect(narrowGeometry.dropdownWidth).toBeGreaterThan(80);
  expect(narrowGeometry.dropdownRight).toBeLessThanOrEqual(narrowGeometry.controlsLeft - 4);
  await expect(page.locator('[data-testid="agent-group-switcher"]')).toBeHidden();
  await expect(header.locator('[data-testid="agent-group-switcher-scrubber"]')).toBeHidden();

  await expect(select).toHaveValue(targetFor('alpha'));
  const optionTexts = await select.locator('option').allTextContents();
  expect(optionTexts.slice(0, 4)).toEqual([
    'alpha running',
    'bravo idle • draft',
    'charlie idle',
    'delta idle',
  ]);

  await select.selectOption(targetFor('bravo'));
  await expect(page.locator('[data-testid="terminal-session-name"]')).toContainText('bravo');
});

test('desktop width uses the strip and a pointer-drag scrubber that scrolls the strip', async ({ page }) => {
  await openAlphaWithExpandedSwitcher(page, 900);
  await writeEvidence(page, 'F5-wide-a3-before');

  const dropdown = page.locator('[data-testid="agent-group-switcher-dropdown"]');
  const strip = page.locator('[data-testid="agent-group-switcher"]');
  const scrubber = page.locator('[data-testid="terminal-header-v2"] [data-testid="agent-group-switcher-scrubber"]');

  await expect(dropdown).toBeHidden();
  await expect(strip).toBeVisible();
  await expect(scrubber).toBeVisible();
  await expect(page.locator('[data-testid="terminal-header-tab"]').first()).toHaveText('bravo •');
  await page.locator('[data-testid="terminal-header-tab"]').filter({ hasText: 'charlie' }).click();
  await expect(page.locator('[data-testid="terminal-session-name"]')).toContainText('charlie');

  const overflow = await strip.evaluate((element) => ({
    left: element.scrollLeft,
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBeGreaterThan(overflow.clientWidth);

  const box = await scrubber.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x - 220, box!.y + box!.height / 2, { steps: 6 });
  await page.mouse.up();

  await expect.poll(() => strip.evaluate((element) => element.scrollLeft)).toBeGreaterThan(overflow.left);
  await writeEvidence(page, 'F5-wide-a3-after');
});
