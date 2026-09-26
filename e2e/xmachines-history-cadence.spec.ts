import { expect, test, type Browser, type Page } from '@playwright/test';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

// Hand-calculated for seriesToPoints(width=120, height=30). These strings are
// literals: the view is not asked what the geometry should be.
// temperature 11 then 47 → min 11, max 47, range 36 → "0,30 120,0"
// power 80, 20, 50 → min 20, max 80, range 60, step 60 → "0,0 60,30 120,15"
// utilization 5, 5 → range forced to 1, both y = 30 → "0,30 120,30"
const TEMP_POINTS = '0,30 120,0';
const POWER_POINTS = '0,0 60,30 120,15';
const UTIL_POINTS = '0,30 120,30';
const MACHINE_NAME = 'cadence-quartz';
const FIRST_AGE = '4s';
const REFRESHED_AGE = '34s';
const WINDOW_MS = 36_000;

const SERIES: Record<string, Array<{ time: string; value: number }>> = {
  temperature: [
    { time: '2026-09-26T00:00:00.000Z', value: 11 },
    { time: '2026-09-26T00:30:00.000Z', value: 47 },
  ],
  power: [
    { time: '2026-09-26T00:00:00.000Z', value: 80 },
    { time: '2026-09-26T00:30:00.000Z', value: 20 },
    { time: '2026-09-26T01:00:00.000Z', value: 50 },
  ],
  utilization: [
    { time: '2026-09-26T00:00:00.000Z', value: 5 },
    { time: '2026-09-26T00:30:00.000Z', value: 5 },
  ],
};

const PUBLIC_ROOT = path.resolve('src/web/public');

function startStatic(): Promise<{ origin: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://127.0.0.1').pathname);
    const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const file = path.resolve(PUBLIC_ROOT, rel);
    if (file !== PUBLIC_ROOT && !file.startsWith(PUBLIC_ROOT + path.sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    fs.readFile(file, (err, buf) => {
      if (err) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      const ext = path.extname(file);
      const types: Record<string, string> = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.png': 'image/png',
        '.svg': 'image/svg+xml',
      };
      res.writeHead(200, { 'content-type': types[ext] || 'application/octet-stream' });
      res.end(buf);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      resolve({
        origin: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

function fulfillJson(route: { fulfill: (opts: { status: number; contentType: string; body: string }) => Promise<void> }, body: unknown) {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function openFleet(browser: Browser, origin: string, opts: { hidden?: boolean }): Promise<{ page: Page; reads: string[]; close: () => Promise<void> }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const reads: string[] = [];
  let telemetryCalls = 0;
  page.on('request', (req) => {
    if (/\/api\/xmachines\//.test(req.url())) reads.push(req.url());
  });
  await page.route(/telegram-web-app\.js|cdn\.jsdelivr\.net\/npm\/xterm/, (route) => route.fulfill({
    status: 200,
    contentType: 'text/plain',
    body: '',
  }));
  await page.route(/\/api\//, (route) => {
    const url = route.request().url();
    if (/\/api\/xmachines\/telemetry(?:\?|$)/.test(url)) {
      telemetryCalls += 1;
      const sampleAge = telemetryCalls === 1 ? FIRST_AGE : REFRESHED_AGE;
      return fulfillJson(route, {
        machines: [{
          name: MACHINE_NAME,
          state: 'up',
          gpuTemp: 41,
          powerWatts: 180,
          uptime: '1d 2h',
          sampleAge,
          provenance: 'collector-cadence',
          freshness: 'fresh',
        }],
      });
    }
    const history = url.match(/\/api\/xmachines\/machines\/([^/]+)\/history/);
    if (history) {
      const metric = new URL(url).searchParams.get('metric') || '';
      return fulfillJson(route, {
        machine: decodeURIComponent(history[1]),
        metric,
        series: SERIES[metric] || [],
      });
    }
    if (url.includes('/api/projects')) return fulfillJson(route, { projects: [] });
    if (url.includes('/api/personal-tasks')) return fulfillJson(route, { tasks: [] });
    if (url.includes('/api/reminders')) return fulfillJson(route, { reminders: [] });
    if (url.includes('/api/notes')) return fulfillJson(route, { notes: [] });
    if (url.includes('/api/auth/me')) {
      return fulfillJson(route, { id: 1, name: 'owner', username: 'owner', role: 'owner', totp_enabled: false });
    }
    return fulfillJson(route, {});
  });
  await page.addInitScript((hidden) => {
    localStorage.setItem('agj_token', 'd6-cadence-owner-token');
    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'owner', username: 'owner', role: 'owner' }));
    if (hidden) {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    }
  }, !!opts.hidden);
  await page.goto(`${origin}/index.html#/xmachines`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await expect(page.locator('[data-testid="xmachines-fleet-card"]')).toBeVisible({ timeout: 30_000 });
  return { page, reads, close: () => context.close() };
}

test('fleet sparklines follow history fixtures and only a visible xmachines view refetches', async ({ browser }) => {
  test.setTimeout(150_000);
  const server = await startStatic();
  const opened: Array<{ close: () => Promise<void> }> = [];
  try {
    const visible = await openFleet(browser, server.origin, {});
    opened.push(visible);

    const temp = visible.page.locator('[data-testid="xmachines-sparkline-temp"] polyline');
    const power = visible.page.locator('[data-testid="xmachines-sparkline-power"] polyline');
    const util = visible.page.locator('[data-testid="xmachines-sparkline-util"] polyline');
    await expect(temp).toHaveCount(1);
    await expect(power).toHaveCount(1);
    await expect(util).toHaveCount(1);
    await expect(temp).toHaveAttribute('points', TEMP_POINTS);
    await expect(power).toHaveAttribute('points', POWER_POINTS);
    await expect(util).toHaveAttribute('points', UTIL_POINTS);
    await expect(visible.page.locator('[data-testid="xmachines-sample-age"]').first()).toHaveText(FIRST_AGE);

    const historyUrls = visible.reads.filter((url) => url.includes('/history'));
    expect(historyUrls.some((url) => url.includes(MACHINE_NAME) && url.includes('metric=temperature'))).toBe(true);
    expect(historyUrls.some((url) => url.includes(MACHINE_NAME) && url.includes('metric=power'))).toBe(true);
    expect(historyUrls.some((url) => url.includes(MACHINE_NAME) && url.includes('metric=utilization'))).toBe(true);

    const hidden = await openFleet(browser, server.origin, { hidden: true });
    opened.push(hidden);
    expect(hidden.reads.some((url) => url.includes('/api/xmachines/telemetry'))).toBe(true);

    const offRoute = await openFleet(browser, server.origin, {});
    opened.push(offRoute);
    await offRoute.page.evaluate(() => { window.location.hash = '#/tasks'; });
    await expect(offRoute.page.locator('[data-testid="xmachines-fleet-overview"]')).toHaveCount(0);
    await offRoute.page.waitForTimeout(500);

    const visibleMark = visible.reads.length;
    const hiddenMark = hidden.reads.length;
    const offRouteMark = offRoute.reads.length;

    await visible.page.waitForTimeout(WINDOW_MS);

    const visibleDelta = visible.reads.slice(visibleMark);
    const hiddenDelta = hidden.reads.slice(hiddenMark);
    const offRouteDelta = offRoute.reads.slice(offRouteMark);

    expect(visibleDelta.some((url) => /\/api\/xmachines\/telemetry(?:\?|$)/.test(url)), `visible refetch missing: ${JSON.stringify(visibleDelta)}`).toBe(true);
    await expect(visible.page.locator('[data-testid="xmachines-sample-age"]').first()).toHaveText(REFRESHED_AGE);
    expect(hiddenDelta, `hidden tab kept requesting: ${JSON.stringify(hiddenDelta)}`).toEqual([]);
    expect(offRouteDelta, `background route kept requesting: ${JSON.stringify(offRouteDelta)}`).toEqual([]);
  } finally {
    await Promise.all(opened.map((arm) => arm.close().catch(() => undefined)));
    await server.close();
  }
});
