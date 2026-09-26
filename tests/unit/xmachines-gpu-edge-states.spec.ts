import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { DatabaseService } from '../../src/db/database.js';
import { loadGpuTelemetryRows } from '../../src/services/xmachines/gpu-edge-states.js';
import { renderMachineCostDetail } from '../../src/web/public/xmachines-cost-view.js';

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
}));

const ROLE_TEXT = 'role text';
const LIVE_UUID = 'GPU-live-1';
const LIVE_NAME = 'NVIDIA RTX 4090';
const NA_UUID = 'GPU-111';
const NA_NAME = 'NVIDIA RTX 4090';
const LAST_UUID = 'GPU-LAST-9';
const LAST_NAME = 'NVIDIA RTX 4090';
const OTHER_UUID = 'GPU-222';
const OTHER_NAME = 'AMD Radeon PRO W6800';
const OLD_UUID = 'GPU-333';
const OLD_NAME = 'NVIDIA RTX 3090';
const OLD_SAMPLE_TIME = '2020-01-01T00:00:00.000Z';
const READ_NOW = '2026-09-26T12:00:00.000Z';
const NO_NVIDIA_STDERR = "NVIDIA-SMI has failed because it couldn't communicate with the NVIDIA driver. Make sure that the latest NVIDIA driver is installed and running.";

const tempDirs: string[] = [];

function tempDb(): DatabaseService {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agjassist-xmachines-edge-'));
  tempDirs.push(dir);
  return new DatabaseService(path.join(dir, 'edge.sqlite'));
}

function spawnOk(stdout: string, stderr = '') {
  return { stdout, stderr, status: 0, signal: null, error: undefined };
}

function documentOf(html: string) {
  return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window.document;
}

afterEach(() => {
  vi.mocked(spawnSync).mockReset();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('B16 GPU edge rows', () => {
  it('E1c – UI GPU rows match live nvidia-smi identities rather than registry role text', () => {
    vi.mocked(spawnSync).mockReturnValue(spawnOk(
      `${LIVE_UUID}, ${LIVE_NAME}, 12, 512, 16384, 55, 120.5, 40`,
    ) as never);
    const db = tempDb();

    const surface = loadGpuTelemetryRows(db.raw, {
      machine: 'box-e1c',
      roleHint: ROLE_TEXT,
      nowIso: READ_NOW,
      refresh: true,
    });
    const doc = documentOf(surface.html);
    const row = doc.querySelector('.gpu-row');

    expect(surface.apiRows).toEqual([
      expect.objectContaining({ uuid: LIVE_UUID, name: LIVE_NAME }),
    ]);
    expect(surface.apiRows[0].uuid).toBe(LIVE_UUID);
    expect(surface.apiRows[0].name).toBe(LIVE_NAME);
    expect(row?.getAttribute('data-gpu-uuid')).toBe(LIVE_UUID);
    expect(row?.querySelector('.gpu-uuid')?.textContent).toBe(LIVE_UUID);
    expect(row?.querySelector('.gpu-name')?.textContent).toBe(LIVE_NAME);
    expect(row?.getAttribute('data-state')).toBe('live');
    expect(surface.html).not.toContain(ROLE_TEXT);
    expect(JSON.stringify(surface.apiRows)).not.toContain(ROLE_TEXT);
    expect(surface.html).not.toContain('stale');
    expect(surface.html).not.toContain('no-NVIDIA');
    db.close();
  });

  it('L11g – NVIDIA [N/A] power renders unavailable rather than zero', () => {
    vi.mocked(spawnSync).mockReturnValue(spawnOk(
      `${NA_UUID}, ${NA_NAME}, 37, 512, 16384, 60, [N/A], 45`,
    ) as never);
    const db = tempDb();

    const surface = loadGpuTelemetryRows(db.raw, {
      machine: 'box-na',
      roleHint: ROLE_TEXT,
      nowIso: READ_NOW,
      refresh: true,
    });
    const doc = documentOf(surface.html);
    const power = doc.querySelector('.metric-power');

    expect(power?.textContent).toBe('unavailable');
    expect(power?.getAttribute('aria-label')).toBe('power unavailable');
    expect(power?.getAttribute('data-availability')).toBe('unavailable');
    expect(power?.textContent).not.toMatch(/0/);
    expect(power?.textContent).not.toBe('0 W');
    expect(doc.querySelector('.metric-temperature')?.textContent).toBe('60 C');
    expect(doc.querySelector('.metric-utilization')?.textContent).toBe('37%');
    expect(surface.html).not.toContain('0 W');
    expect(surface.html).not.toContain(ROLE_TEXT);
    db.close();
  });

  it('L11h – a no-NVIDIA failure renders no-NVIDIA, distinct from empty, timeout, stale, and unavailable', () => {
    const db = tempDb();
    vi.mocked(spawnSync).mockReturnValue({
      stdout: '',
      stderr: NO_NVIDIA_STDERR,
      status: 1,
      signal: null,
      error: undefined,
    } as never);

    const missing = loadGpuTelemetryRows(db.raw, {
      machine: 'box-none',
      roleHint: ROLE_TEXT,
      nowIso: READ_NOW,
      refresh: true,
    });
    const missingDoc = documentOf(missing.html);

    expect(missing.state).toBe('no-nvidia');
    expect(missing.chip).toBe('no-NVIDIA');
    expect(missing.apiRows).toEqual([]);
    expect(missingDoc.querySelector('.chip')?.textContent).toBe('no-NVIDIA');
    expect(missingDoc.querySelector('.chip')?.getAttribute('role')).toBe('status');
    expect(missingDoc.querySelectorAll('.gpu-row')).toHaveLength(0);
    expect(missing.html).not.toContain('timeout');
    expect(missing.html).not.toContain('stale');
    expect(missing.html).not.toContain('unavailable');
    expect(missing.html).not.toContain('no GPUs');
    expect(missing.html).not.toContain(ROLE_TEXT);

    vi.mocked(spawnSync).mockReturnValue(spawnOk('') as never);
    const empty = loadGpuTelemetryRows(db.raw, {
      machine: 'box-empty',
      roleHint: ROLE_TEXT,
      nowIso: READ_NOW,
      refresh: true,
    });
    expect(empty.state).toBe('empty');
    expect(empty.chip).toBe('no GPUs');
    expect(documentOf(empty.html).querySelector('.chip')?.textContent).toBe('no GPUs');
    expect(empty.html).not.toContain('no-NVIDIA');

    vi.mocked(spawnSync).mockReturnValue({
      stdout: '',
      stderr: '',
      status: null,
      signal: 'SIGTERM',
      error: Object.assign(new Error('spawnSync ETIMEDOUT'), { code: 'ETIMEDOUT' }),
    } as never);
    const timedOut = loadGpuTelemetryRows(db.raw, {
      machine: 'box-timeout',
      roleHint: ROLE_TEXT,
      nowIso: READ_NOW,
      refresh: true,
    });
    expect(timedOut.state).toBe('driver-timeout');
    expect(timedOut.chip).toBe('error-timeout');
    expect(timedOut.html).not.toContain('no-NVIDIA');
    expect(timedOut.html).not.toContain('>stale<');
    db.close();
  });

  it('L11i – driver timeout renders system last-good history plus an error-timeout chip', () => {
    const seenAt = '2026-09-26T12:00:00.000Z';
    vi.mocked(spawnSync).mockReturnValueOnce(spawnOk(
      `${LAST_UUID}, ${LAST_NAME}, 12, 2048, 24576, 71, 180.5, 40`,
    ) as never);
    const db = tempDb();

    loadGpuTelemetryRows(db.raw, {
      machine: 'box-timeout-history',
      roleHint: ROLE_TEXT,
      nowIso: seenAt,
      refresh: true,
    });
    const stored = db.raw.prepare(
      'SELECT gpu_uuid, sample_time, temperature, power_watts FROM xm_samples WHERE gpu_uuid = ?',
    ).get(LAST_UUID) as { gpu_uuid: string; sample_time: string; temperature: number; power_watts: number };
    expect(stored).toEqual({
      gpu_uuid: LAST_UUID,
      sample_time: seenAt,
      temperature: 71,
      power_watts: 180.5,
    });

    vi.mocked(spawnSync).mockReturnValueOnce({
      stdout: '',
      stderr: '',
      status: null,
      signal: 'SIGTERM',
      error: Object.assign(new Error('spawnSync ETIMEDOUT'), { code: 'ETIMEDOUT' }),
    } as never);
    const surface = loadGpuTelemetryRows(db.raw, {
      machine: 'box-timeout-history',
      roleHint: ROLE_TEXT,
      nowIso: '2026-09-26T12:00:01.000Z',
      refresh: true,
    });
    const doc = documentOf(surface.html);
    const row = doc.querySelector('.gpu-row');
    const stillThere = db.raw.prepare(
      'SELECT COUNT(*) AS n FROM xm_samples WHERE gpu_uuid = ?',
    ).get(LAST_UUID) as { n: number };

    expect(stillThere.n).toBe(1);
    expect(surface.state).toBe('driver-timeout');
    expect(surface.chip).toBe('error-timeout');
    expect(surface.apiRows[0]).toMatchObject({
      uuid: LAST_UUID,
      name: LAST_NAME,
      chip: 'error-timeout',
      temperature: '71 C',
      power: '180.5 W',
    });
    expect(row?.getAttribute('data-history')).toBe('last-good');
    expect(row?.getAttribute('data-sample-time')).toBe(seenAt);
    expect(row?.querySelector('.chip')?.textContent).toBe('error-timeout');
    expect(row?.querySelector('.gpu-uuid')?.textContent).toBe(LAST_UUID);
    expect(row?.querySelector('.gpu-name')?.textContent).toBe(LAST_NAME);
    expect(row?.querySelector('.metric-temperature')?.textContent).toBe('71 C');
    expect(row?.querySelector('.metric-power')?.textContent).toBe('180.5 W');
    expect(surface.html).not.toContain(ROLE_TEXT);
    db.close();
  });

  it('L11j – a non-NVIDIA device shows its name and not-applicable metrics, never fabricated zeros', () => {
    vi.mocked(spawnSync).mockReturnValue(spawnOk(
      `${OTHER_UUID}, ${OTHER_NAME}, 0, 0, 0, 0, 0, 0`,
    ) as never);
    const db = tempDb();

    const surface = loadGpuTelemetryRows(db.raw, {
      machine: 'box-other',
      roleHint: ROLE_TEXT,
      nowIso: READ_NOW,
      refresh: true,
    });
    const doc = documentOf(surface.html);
    const row = doc.querySelector('.gpu-row');
    const metrics = [...doc.querySelectorAll('.metric')];

    expect(surface.state).toBe('non-nvidia');
    expect(surface.apiRows[0].name).toBe(OTHER_NAME);
    expect(surface.apiRows[0].uuid).toBe(OTHER_UUID);
    expect(row?.querySelector('.gpu-name')?.textContent).toBe(OTHER_NAME);
    expect(metrics.map((node) => node.textContent)).toEqual([
      'not-applicable',
      'not-applicable',
      'not-applicable',
      'not-applicable',
      'not-applicable',
    ]);
    expect(row?.textContent).not.toMatch(/0 W|0 C|0 MiB|0%/);
    expect(surface.html).not.toContain('0 W');
    expect(surface.html).not.toContain('0 C');
    expect(surface.html).not.toContain('0 MiB');
    expect(surface.html).not.toContain('0%');
    db.close();
  });

  it('L11k – an expired system sample renders stale and keeps the historical identity', () => {
    vi.mocked(spawnSync).mockReturnValue(spawnOk(
      `${OLD_UUID}, ${OLD_NAME}, 10, 1024, 24576, 44, 95.2, 30`,
    ) as never);
    const db = tempDb();

    loadGpuTelemetryRows(db.raw, {
      machine: 'box-stale',
      roleHint: ROLE_TEXT,
      nowIso: OLD_SAMPLE_TIME,
      refresh: true,
    });
    const stored = db.raw.prepare(
      'SELECT gpu_uuid, sample_time, temperature, power_watts FROM xm_samples WHERE gpu_uuid = ?',
    ).get(OLD_UUID) as { gpu_uuid: string; sample_time: string; temperature: number; power_watts: number };
    expect(stored).toEqual({
      gpu_uuid: OLD_UUID,
      sample_time: OLD_SAMPLE_TIME,
      temperature: 44,
      power_watts: 95.2,
    });
    const callsAfterSample = vi.mocked(spawnSync).mock.calls.length;

    const surface = loadGpuTelemetryRows(db.raw, {
      machine: 'box-stale',
      roleHint: ROLE_TEXT,
      nowIso: READ_NOW,
      refresh: false,
    });
    const doc = documentOf(surface.html);
    const row = doc.querySelector('.gpu-row');

    expect(vi.mocked(spawnSync).mock.calls.length).toBe(callsAfterSample);
    expect(surface.state).toBe('stale');
    expect(surface.chip).toBe('stale');
    expect(surface.apiRows[0]).toMatchObject({
      uuid: OLD_UUID,
      name: OLD_NAME,
      chip: 'stale',
      temperature: '44 C',
      power: '95.2 W',
    });
    expect(row?.getAttribute('data-state')).toBe('stale');
    expect(row?.getAttribute('data-sample-time')).toBe(OLD_SAMPLE_TIME);
    expect(row?.querySelector('.chip')?.textContent).toBe('stale');
    expect(row?.querySelector('.gpu-uuid')?.textContent).toBe(OLD_UUID);
    expect(row?.querySelector('.gpu-name')?.textContent).toBe(OLD_NAME);
    expect(row?.querySelector('.metric-temperature')?.textContent).toBe('44 C');
    expect(row?.querySelector('.metric-power')?.textContent).toBe('95.2 W');
    expect(surface.html).not.toContain('error-timeout');
    expect(surface.html).not.toContain(ROLE_TEXT);
    db.close();
  });

  it('C1c – stored VRAM total is rendered by the non-refresh production read', () => {
    const storedUuid = 'GPU-D4-STORED';
    const storedName = 'NVIDIA GeForce RTX 3090';
    vi.mocked(spawnSync).mockReturnValue(spawnOk(
      `${storedUuid}, ${storedName}, 41, 2048, 24576, 67, 220, 55`,
    ) as never);
    const db = tempDb();

    loadGpuTelemetryRows(db.raw, {
      machine: 'gpu',
      roleHint: ROLE_TEXT,
      nowIso: READ_NOW,
      refresh: true,
    });
    const stored = db.raw.prepare(
      'SELECT vram_mb, vram_total_mb FROM xm_samples WHERE gpu_uuid = ?',
    ).get(storedUuid) as { vram_mb: number; vram_total_mb: number };
    expect(stored).toEqual({ vram_mb: 2048, vram_total_mb: 24576 });

    vi.mocked(spawnSync).mockReset();
    const surface = loadGpuTelemetryRows(db.raw, {
      machine: 'gpu',
      roleHint: ROLE_TEXT,
      nowIso: READ_NOW,
      refresh: false,
    });
    const detail = renderMachineCostDetail({
      machine: { name: 'gpu' },
      gpuRows: surface.apiRows,
    });
    const cell = documentOf(detail).querySelector('[data-testid="xmachines-gpu-vram"]');

    expect(vi.mocked(spawnSync)).not.toHaveBeenCalled();
    expect(surface.apiRows).toHaveLength(1);
    expect(surface.apiRows[0].memory).toBe('2048/24576 MiB');
    expect(cell?.textContent).toBe('2048/24576 MiB');
    db.close();
  });
});
