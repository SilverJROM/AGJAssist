import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import type { FastifyInstance } from 'fastify';
import { createApiServer, type ApiServices } from '../../src/api/server.js';
import { AppConfig } from '../../src/config/config.js';
import { DatabaseService } from '../../src/db/database.js';
import { persistSampleCycle, type SampleReading } from '../../src/db/xmachines-store.js';
import { renderFleetOverview, renderMachineCostDetail } from '../../src/web/public/xmachines-cost-view.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OWNER = 'b13-owner-token';
const FROM = '2026-04-01T00:00:00.000Z';
const TO = '2026-04-01T01:00:00.000Z';
const MID = '2026-04-01T00:30:00.000Z';
const INSIDE_OTHER = '2026-04-01T00:15:00.000Z';
const OUTSIDE = '2026-03-01T00:00:00.000Z';
const CAVEAT = 'bursts shorter than 30 minutes may be missed';
const COST_KEYS = ['cost', 'costPhp', 'kwh', 'tariffFlag', 'tariffPhpPerKwh', 'isPlaceholder', 'caveat', 'currency'];

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
    runtime: {
      workspaceRoot: '/tmp',
      allowedCommandPrefixes: [],
      maxToolIterations: 1,
      defaultTimeoutMinutes: 1,
    },
    api: { port: 0, host: '127.0.0.1', jwtSecret: 's', sessionExpiryHours: 24 },
    db: { path: ':memory:' },
    projects: { root: '/tmp' },
    tmux: { historyRetentionDays: 1, outputBufferLines: 100, streamIntervalMs: 100 },
    overmind: { token: 't' },
  };
}

function servicesFor(db: DatabaseService): ApiServices {
  return {
    authService: {
      verifyToken: (token: string) =>
        token === OWNER ? { id: 1, role: 'owner', username: 'owner' } : null,
    } as ApiServices['authService'],
    projectService: {} as ApiServices['projectService'],
    safetyService: {} as ApiServices['safetyService'],
    auditService: {} as ApiServices['auditService'],
    tmuxService: {} as ApiServices['tmuxService'],
    tmuxStreamManager: {} as ApiServices['tmuxStreamManager'],
    db,
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

function reading(machineName: string, gpuUuid: string, sampleTime: string, powerWatts: number): SampleReading {
  return {
    machineName,
    gpuUuid,
    sampleTime,
    temperature: null,
    powerWatts,
    utilizationGpu: null,
    utilizationMem: null,
    fanSpeed: null,
    vramMb: null,
  };
}

function ownerHeaders(): Record<string, string> {
  return { authorization: `Bearer ${OWNER}`, host: 'localhost:3101' };
}

function detailUrl(): string {
  return `/api/xmachines/machines/hdd?from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}`;
}

function keysOf(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) keysOf(item, found);
    return found;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      found.push(key);
      keysOf(child, found);
    }
  }
  return found;
}

function region(markup: string, testId: string): Element {
  const dom = new JSDOM(`<!doctype html><body>${markup}</body>`);
  const el = dom.window.document.querySelector(`[data-testid="${testId}"]`);
  if (!el) throw new Error(`missing ${testId}`);
  return el;
}

describe('xmachines cost integration B13', () => {
  const scratchDirs: string[] = [];
  let app: FastifyInstance | undefined;
  let db: DatabaseService | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
    db?.close();
    db = undefined;
    for (const dir of scratchDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  async function boot(tariff: string | null): Promise<void> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b13-cost-'));
    scratchDirs.push(dir);
    db = new DatabaseService(path.join(dir, 'cost.sqlite'));
    persistSampleCycle(db.raw, [
      reading('hdd', 'GPU-COST-HDD-A', FROM, 1000),
      reading('hdd', 'GPU-COST-HDD-A', MID, 500),
      reading('gpu', 'GPU-COST-OTHER', INSIDE_OTHER, 1000),
      reading('hdd', 'GPU-COST-HDD-A', OUTSIDE, 8000),
    ]);
    if (tariff !== null) {
      db.raw.prepare("INSERT INTO xm_config (key, value) VALUES ('xm_cost_tariff_ph_p_per_kwh', ?)").run(tariff);
    }
    app = await createApiServer(minimalConfig(), servicesFor(db));
  }

  it('C3e/I4a detail cost is the persisted in-window sample feed', async () => {
    await boot(null);
    const stored = db!.raw.prepare(`
      SELECT machine_name, power_watts, sample_time
      FROM xm_samples
      WHERE machine_name = ? AND sample_time >= ? AND sample_time < ?
      ORDER BY sample_time
    `).all('hdd', FROM, TO);
    expect(stored).toEqual([
      { machine_name: 'hdd', power_watts: 1000, sample_time: FROM },
      { machine_name: 'hdd', power_watts: 500, sample_time: MID },
    ]);

    const res = await app!.inject({ method: 'GET', url: detailUrl(), headers: ownerHeaders() });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      machine: { name: string };
      cost: {
        kwh: number;
        costPhp: number;
        currency: string;
        tariffPhpPerKwh: number;
        isPlaceholder: boolean;
        tariffFlag: string;
        caveat: string;
      };
    };
    expect(body.machine.name).toBe('hdd');
    expect(body.cost.kwh).toBe(0.25);
    expect(body.cost.costPhp).toBe(0.25);
    expect(body.cost.currency).toBe('PHP');
    expect(body.cost.tariffPhpPerKwh).toBe(1);
    expect(body.cost.isPlaceholder).toBe(true);
    expect(body.cost.tariffFlag).toBe('placeholder');
    expect(body.cost.caveat).toBe(CAVEAT);
  });

  it('I4b/I4c a configured tariff changes the PHP amount and clears the placeholder flag', async () => {
    await boot('4');
    const res = await app!.inject({ method: 'GET', url: detailUrl(), headers: ownerHeaders() });
    expect(res.statusCode).toBe(200);
    const cost = (res.json() as { cost: { kwh: number; costPhp: number; tariffPhpPerKwh: number; isPlaceholder: boolean; tariffFlag: string; currency: string; caveat: string } }).cost;
    expect(cost.kwh).toBe(0.25);
    expect(cost.costPhp).toBe(1);
    expect(cost.currency).toBe('PHP');
    expect(cost.tariffPhpPerKwh).toBe(4);
    expect(cost.isPlaceholder).toBe(false);
    expect(cost.tariffFlag).toBe('configured');
    expect(cost.caveat).toBe(CAVEAT);
  });

  it('I4e fleet overview payload has no cost fields', async () => {
    await boot(null);
    const res = await app!.inject({ method: 'GET', url: '/api/xmachines/telemetry', headers: ownerHeaders() });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { machines: Array<{ name: string; powerWatts: number }> };
    expect(body.machines.find((machine) => machine.name === 'hdd')?.powerWatts).toBe(90);
    for (const key of keysOf(body)) expect(COST_KEYS).not.toContain(key);
    const text = JSON.stringify(body);
    expect(text).not.toContain('PHP');
    expect(text).not.toContain('placeholder');
    expect(text).not.toContain(CAVEAT);
  });

  it('I4b/I4c/I4d detail HTML shows PHP, the placeholder flag, and the short-burst caveat', () => {
    const markup = renderMachineCostDetail({
      machine: { name: 'hdd' },
      decoyCostPhp: 12345,
      cost: {
        kwh: 0.75,
        costPhp: 0.75,
        currency: 'PHP',
        tariffPhpPerKwh: 1,
        isPlaceholder: true,
        tariffFlag: 'placeholder',
        caveat: CAVEAT,
      },
    });
    const detail = region(markup, 'xmachines-machine-detail');
    expect(detail.getAttribute('aria-label')).toBe('Machine detail');
    expect(detail.textContent).toContain('PHP 0.75');
    expect(detail.textContent).toContain('placeholder tariff');
    expect(detail.textContent).toContain(CAVEAT);
    expect(detail.textContent).not.toContain('12345');
    expect(detail.querySelector('[data-testid="xmachines-cost-php"]')?.getAttribute('aria-label')).toBe('Energy cost in PHP');
    expect(detail.querySelector('[data-testid="xmachines-tariff-flag"]')?.getAttribute('aria-label')).toBe('Tariff is a placeholder');
    expect(detail.querySelector('[data-testid="xmachines-cost-caveat"]')?.getAttribute('aria-label')).toBe('Short burst caveat');
  });

  it('I4c a configured detail flag does not say placeholder', () => {
    const markup = renderMachineCostDetail({
      machine: { name: 'hdd' },
      cost: {
        kwh: 0.75,
        costPhp: 3,
        currency: 'PHP',
        isPlaceholder: false,
        caveat: CAVEAT,
      },
    });
    const detail = region(markup, 'xmachines-machine-detail');
    expect(detail.textContent).toContain('PHP 3');
    expect(detail.textContent).toContain('configured tariff');
    expect(detail.textContent).not.toContain('placeholder');
    expect(detail.textContent).toContain(CAVEAT);
  });

  it('I4d/I4e overview HTML omits cost even when a machine object carries it', () => {
    const markup = renderFleetOverview({
      machines: [{
        name: 'hdd',
        state: 'synthetic',
        powerWatts: 90,
        costPhp: 12345,
        cost: { costPhp: 0.75, kwh: 0.75, isPlaceholder: true, caveat: CAVEAT, currency: 'PHP' },
      }],
    });
    const overview = region(markup, 'xmachines-fleet-overview');
    expect(overview.getAttribute('aria-label')).toBe('Fleet overview');
    expect(overview.textContent).toContain('hdd');
    expect(overview.textContent).toContain('synthetic');
    expect(overview.textContent).not.toContain('PHP');
    expect(overview.textContent).not.toContain('placeholder');
    expect(overview.textContent).not.toContain('bursts shorter');
    expect(overview.textContent).not.toContain('12345');
    expect(overview.textContent).not.toContain('0.75');
    expect(overview.textContent).not.toContain('kWh');
  });

  it('detail and overview pages render through app.js', () => {
    const appSrc = fs.readFileSync(path.join(REPO, 'src/web/public/app.js'), 'utf8');
    expect(appSrc).toContain("from './xmachines-cost-view.js'");
    expect(appSrc).toContain('renderMachineCostDetail');
    expect(appSrc).toContain('renderFleetOverview');
    expect(appSrc).toContain("api('/api/xmachines/telemetry')");
    expect(appSrc).toContain("api('/api/xmachines/machines/'");
    expect(appSrc).toContain("route === '/xmachines'");
    expect(appSrc).toContain("route.startsWith('/xmachines/')");
  });
});
