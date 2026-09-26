import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { chromium } from '@playwright/test';
import type { FastifyInstance } from 'fastify';
import { createApiServer, type ApiServices } from '../../src/api/server.js';
import { AppConfig } from '../../src/config/config.js';
import { deriveWolSafety, resolveXmacLogPath } from '../../src/services/xmachines/uptime.js';
import { renderMachineCostDetail } from '../../src/web/public/xmachines-cost-view.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const VALIDATION = path.join(REPO, 'xmachines/projcore-run-2026-09-25/validation');
const SPY = path.join(REPO, 'tests/helpers/xmac-argv-spy.sh');
const OWNER = 'b14-owner-token';
const NOW = new Date('2026-09-26T12:00:00Z');
const UP_SECONDS = 86400;
const WAKE_AT = '2026-09-26T02:18:00Z';
const UP_AT = '2026-09-26T02:18:45Z';
const EARLIER_UP = '2026-09-26T02:10:00Z';
const WARNING = 'Unverified machine may remain off';
const LOG = [
  `${UP_AT} UP hdd 45s`,
  `${WAKE_AT} WAKE gpu aa:bb`,
  `${WAKE_AT} WAKE media aa:bb`,
  `${UP_AT} UP media 45s`,
].join('\n');

type ChallengeBody = {
  status?: string;
  reason?: string;
  confirmation?: string;
  challengeId?: string;
  displayNumber?: number;
};

function minimalConfig(): AppConfig {
  return {
    telegram: {
      botToken: '123:ABC',
      authorizedUserId: 1,
      authorizedChatIds: [1],
      testMode: true,
      updateMode: 'polling',
      webhookUrl: null,
      webhookPath: '/api/telegram/webhook',
      webhookSecretToken: 's',
    },
    runtime: { workspaceRoot: '/tmp', allowedCommandPrefixes: [], maxToolIterations: 1, defaultTimeoutMinutes: 1 },
    api: { port: 0, host: '127.0.0.1', jwtSecret: 's', sessionExpiryHours: 24 },
    db: { path: ':memory:' },
    projects: { root: '/tmp' },
    tmux: { historyRetentionDays: 1, outputBufferLines: 100, streamIntervalMs: 100 },
    overmind: { token: 't' },
  };
}

function stubServices(): ApiServices {
  return {
    authService: {
      verifyToken: (token: string) => (token === OWNER ? { id: 1, role: 'owner', username: 'owner' } : null),
    } as ApiServices['authService'],
    projectService: {} as ApiServices['projectService'],
    safetyService: {} as ApiServices['safetyService'],
    auditService: {} as ApiServices['auditService'],
    tmuxService: {} as ApiServices['tmuxService'],
    tmuxStreamManager: {} as ApiServices['tmuxStreamManager'],
    db: {} as ApiServices['db'],
    delegationService: {} as ApiServices['delegationService'],
    noteService: {} as ApiServices['noteService'],
    planService: {} as ApiServices['planService'],
    taskService: {} as ApiServices['taskService'],
    fileService: {} as ApiServices['fileService'],
    stepTemplateService: {} as ApiServices['stepTemplateService'],
    personalTaskService: {} as ApiServices['personalTaskService'],
    reminderService: {} as ApiServices['reminderService'],
    agentAssignmentService: {} as ApiServices['agentAssignmentService'],
  };
}

function ownerHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    authorization: `Bearer ${OWNER}`,
    host: 'localhost:3101',
    origin: 'http://localhost:3101',
    ...extra,
  };
}

function spyArgv(log: string): string[][] {
  if (!fs.existsSync(log)) return [];
  return fs.readFileSync(log, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.split('\t').slice(1));
}

async function waitForArgv(spyLog: string, minLines: number): Promise<string[][]> {
  const deadline = Date.now() + 2000;
  let rows = spyArgv(spyLog);
  while (rows.length < minLines && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    rows = spyArgv(spyLog);
  }
  return spyArgv(spyLog);
}

async function expectSameArgv(spyLog: string, rows: string[][]): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(spyArgv(spyLog)).toEqual(rows);
}

describe('xmachines wol-safety', () => {
  let app: FastifyInstance | undefined;
  let scratch: string | undefined;
  let prev: Record<string, string | undefined> | undefined;

  const ENV_KEYS = [
    'PATH',
    'XMAC_ARGV_SPY_LOG',
    'XMAC_ARGV_SPY_REAL',
    'XMACHINES_ARM',
    'XMAC_CONF',
    'XMAC_STATE',
    'XMAC_LOG',
    'XMACHINES_UP_SECONDS',
    'XMACHINES_PROTECTED_FIXTURE_DIR',
  ] as const;

  afterEach(async () => {
    await app?.close();
    app = undefined;
    if (prev) {
      for (const key of ENV_KEYS) {
        if (prev[key] === undefined) delete process.env[key];
        else process.env[key] = prev[key];
      }
    }
    prev = undefined;
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
    scratch = undefined;
  });

  function restorePoint(): void {
    const saved: Record<string, string | undefined> = {};
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    prev = saved;
  }

  async function bootFixture(logText: string): Promise<{ spyLog: string }> {
    restorePoint();
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'b14-wol-'));
    const bin = path.join(scratch, 'bin');
    fs.mkdirSync(bin);
    fs.symlinkSync(SPY, path.join(bin, 'xmac.sh'));
    const spyLog = path.join(scratch, 'spy.log');
    const logPath = path.join(scratch, 'xmac.log');
    fs.writeFileSync(logPath, `${logText}\n`);
    const conf = path.join(scratch, 'machines.conf');
    fs.writeFileSync(conf, [
      'hdd|192.0.2.50|02:00:00:00:00:50|agjrom|fixture|',
      'gpu|192.0.2.51|02:00:00:00:00:51|agjrom|fixture|',
      'media|192.0.2.52|02:00:00:00:00:52|agjrom|fixture|',
      '',
    ].join('\n'));
    const xmacState = path.join(scratch, 'xmac-state');
    fs.mkdirSync(xmacState);
    process.env.PATH = `${bin}${path.delimiter}${process.env.PATH ?? ''}`;
    process.env.XMAC_ARGV_SPY_LOG = spyLog;
    delete process.env.XMAC_ARGV_SPY_REAL;
    process.env.XMACHINES_ARM = '1';
    process.env.XMAC_CONF = conf;
    process.env.XMAC_STATE = xmacState;
    process.env.XMAC_LOG = logPath;
    process.env.XMACHINES_UP_SECONDS = '100000000';
    delete process.env.XMACHINES_PROTECTED_FIXTURE_DIR;
    app = await createApiServer(minimalConfig(), stubServices());
    return { spyLog };
  }

  function off(machine: string, key: string, payload?: Record<string, unknown>) {
    return app!.inject({
      method: 'POST',
      url: `/api/xmachines/machines/${machine}/power/off`,
      headers: ownerHeaders({ 'idempotency-key': key }),
      payload,
    });
  }

  it('I5a WoL-safe shows the last WAKE followed by the verified UP timestamp', () => {
    const log = `${WAKE_AT} WAKE hdd aa:bb\n${UP_AT} UP hdd 45s`;
    const evidence = deriveWolSafety({ machine: 'hdd', upSeconds: UP_SECONDS, log, now: NOW });
    expect(evidence).toEqual({
      lastWake: '2026-09-26T02:18:00Z',
      verifiedUp: '2026-09-26T02:18:45Z',
      status: 'verified',
    });
  });

  it('I5a an UP with no WAKE is not a verified pair', () => {
    const evidence = deriveWolSafety({
      machine: 'hdd',
      upSeconds: UP_SECONDS,
      log: `${UP_AT} UP hdd 45s`,
      now: NOW,
    });
    expect(evidence).toEqual({
      lastWake: null,
      verifiedUp: null,
      status: 'never-verified',
    });
  });

  it('I5a an UP that precedes WAKE is not a verified pair', () => {
    const log = `${EARLIER_UP} UP hdd 30s\n${WAKE_AT} WAKE hdd aa:bb`;
    const evidence = deriveWolSafety({ machine: 'hdd', upSeconds: UP_SECONDS, log, now: NOW });
    expect(evidence).toEqual({
      lastWake: '2026-09-26T02:18:00Z',
      verifiedUp: null,
      status: 'stale',
    });
  });

  it('the log resolver honours an explicit fixture and the default xmac log outside vitest', () => {
    const fixture = '/tmp/b14-wol-fixture.log';
    expect(resolveXmacLogPath({ XMAC_LOG: fixture })).toBe('/tmp/b14-wol-fixture.log');
    expect(resolveXmacLogPath({ VITEST: 'true' })).toBeNull();
    expect(resolveXmacLogPath({})).toMatch(/\/\.xmac\/xmac\.log$/);
  });

  it('I5b/I5d a never-verified machine renders never verified and the off warning', async () => {
    await bootFixture(LOG);
    const detail = await app!.inject({
      method: 'GET',
      url: '/api/xmachines/machines/hdd',
      headers: ownerHeaders(),
    });
    expect(detail.statusCode).toBe(200);
    const body = detail.json() as { wolSafety?: { lastWake: string | null; verifiedUp: string | null; status: string; warning: string | null } };
    expect(body.wolSafety).toEqual({
      lastWake: null,
      verifiedUp: null,
      status: 'never-verified',
      warning: 'Unverified machine may remain off',
    });

    const verified = await app!.inject({
      method: 'GET',
      url: '/api/xmachines/machines/media',
      headers: ownerHeaders(),
    });
    expect(verified.json()).toMatchObject({
      wolSafety: {
        lastWake: '2026-09-26T02:18:00Z',
        verifiedUp: '2026-09-26T02:18:45Z',
        status: 'verified',
        warning: null,
      },
    });

    const markup = renderMachineCostDetail(body);
    fs.mkdirSync(VALIDATION, { recursive: true });
    const htmlPath = path.join(VALIDATION, 'B14-never-verified.html');
    const pngPath = path.join(VALIDATION, 'B14-never-verified.png');
    const domPath = path.join(VALIDATION, 'B14-never-verified-dom.json');
    fs.writeFileSync(htmlPath, `<!doctype html><html><head><meta charset="utf-8"><title>WoL safety</title><style>body{font:16px sans-serif;background:#fff;color:#111;margin:24px}[role=alert]{color:#7a1f1f;font-weight:700}</style></head><body>${markup}</body></html>`);

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
      await page.goto(pathToFileURL(htmlPath).href);
      const statusText = (await page.getByTestId('xmachines-wol-status').innerText()).trim();
      const warningText = (await page.getByTestId('xmachines-wol-warning').innerText()).trim();
      const statusAria = await page.getByTestId('xmachines-wol-status').getAttribute('aria-label');
      const warningAria = await page.getByTestId('xmachines-wol-warning').getAttribute('aria-label');
      const aria = await page.getByTestId('xmachines-machine-detail').ariaSnapshot();
      await page.screenshot({ path: pngPath, fullPage: true });
      const artifact = { statusText, warningText, statusAria, warningAria, aria };
      fs.writeFileSync(domPath, `${JSON.stringify(artifact, null, 2)}\n`);
      expect(statusText).toBe('never verified');
      expect(warningText).toBe(WARNING);
      expect(statusAria).toBe('WoL safety never verified');
      expect(warningAria).toBe(WARNING);
      expect(aria).toContain('never verified');
      expect(aria).toContain(WARNING);
    } finally {
      await browser.close();
    }

    const saved = JSON.parse(fs.readFileSync(domPath, 'utf8')) as { statusText: string; warningText: string; aria: string };
    expect(saved.statusText).toBe('never verified');
    expect(saved.warningText).toBe('Unverified machine may remain off');
    expect(saved.aria).toContain('never verified');
    expect(saved.aria).toContain('Unverified machine may remain off');
    expect(fs.statSync(pngPath).size).toBeGreaterThan(500);

    const verifiedMarkup = renderMachineCostDetail(verified.json());
    const verifiedPage = `<!doctype html><html><body>${verifiedMarkup}</body></html>`;
    const verifiedHtml = path.join(scratch!, 'verified.html');
    fs.writeFileSync(verifiedHtml, verifiedPage);
    const browser2 = await chromium.launch({ headless: true });
    try {
      const page = await browser2.newPage();
      await page.goto(pathToFileURL(verifiedHtml).href);
      const text = await page.getByTestId('xmachines-machine-detail').innerText();
      expect(text).toContain('2026-09-26T02:18:00Z');
      expect(text).toContain('2026-09-26T02:18:45Z');
      expect(text).not.toContain('never verified');
      expect(text).not.toContain('Unverified machine may remain off');
    } finally {
      await browser2.close();
    }
  }, 60_000);

  it('I5c stale and never-verified Off waits for a consumed force confirmation', async () => {
    const { spyLog } = await bootFixture(LOG);

    const never = await off('hdd', 'b14-hdd-challenge');
    expect(never.statusCode).toBe(400);
    const neverBody = never.json() as ChallengeBody;
    expect(neverBody.status).toBe('rejected');
    expect(neverBody.reason).toBe('force-confirmation-required');
    expect(neverBody.confirmation).toContain('Unverified machine may remain off');
    expect(typeof neverBody.challengeId).toBe('string');
    expect(typeof neverBody.displayNumber).toBe('number');
    await expectSameArgv(spyLog, []);

    const wrongNumber = neverBody.displayNumber === 10 ? 11 : 10;
    const burned = await off('hdd', 'b14-hdd-wrong', {
      challengeId: neverBody.challengeId,
      selectedNumber: wrongNumber,
    });
    expect(burned.statusCode).toBe(400);
    expect((burned.json() as ChallengeBody).reason).toBe('force-confirmation-required');
    expect((burned.json() as ChallengeBody).confirmation).toContain('Unverified machine may remain off');
    await expectSameArgv(spyLog, []);

    const stale = await off('gpu', 'b14-gpu-challenge');
    expect(stale.statusCode).toBe(400);
    const staleBody = stale.json() as ChallengeBody;
    expect(staleBody.reason).toBe('force-confirmation-required');
    expect(staleBody.confirmation).toContain('Unverified machine may remain off');
    expect(staleBody.confirmation).toContain('status=stale');
    await expectSameArgv(spyLog, []);

    const renewed = await off('hdd', 'b14-hdd-renew');
    const renewedBody = renewed.json() as ChallengeBody;
    expect(renewed.statusCode).toBe(400);
    expect(renewedBody.reason).toBe('force-confirmation-required');
    const accepted = await off('hdd', 'b14-hdd-confirm', {
      challengeId: renewedBody.challengeId,
      selectedNumber: renewedBody.displayNumber,
    });
    expect(accepted.statusCode).toBe(202);
    expect((accepted.json() as { status?: string }).status).toBe('in-progress');
    expect(await waitForArgv(spyLog, 1)).toEqual([['down', 'hdd', '--owner-off']]);

    const gpuAccepted = await off('gpu', 'b14-gpu-confirm', {
      challengeId: staleBody.challengeId,
      selectedNumber: staleBody.displayNumber,
    });
    expect(gpuAccepted.statusCode).toBe(202);
    expect(await waitForArgv(spyLog, 2)).toEqual([
      ['down', 'hdd', '--owner-off'],
      ['down', 'gpu', '--owner-off'],
    ]);

    const direct = await off('media', 'b14-media-verified');
    expect(direct.statusCode).toBe(202);
    expect((direct.json() as { status?: string; reason?: string }).reason).toBeUndefined();
    const rows = await waitForArgv(spyLog, 3);
    expect(rows).toEqual([
      ['down', 'hdd', '--owner-off'],
      ['down', 'gpu', '--owner-off'],
      ['down', 'media', '--owner-off'],
    ]);
    expect(rows.flat()).not.toContain('--force');
  }, 30_000);
});
