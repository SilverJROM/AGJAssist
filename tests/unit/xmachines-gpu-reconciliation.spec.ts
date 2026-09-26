import { describe, it, expect, afterEach } from 'vitest';
import { DatabaseService } from '../../src/db/database.js';
import { reconcileGpuIdentities, persistSampleCycle } from '../../src/db/xmachines-store.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

const tempDirs: string[] = [];

function tempDb(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agjassist-xmachines-reconcile-'));
  tempDirs.push(dir);
  return path.join(dir, name);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('B15 GPU reconciliation – atomic add/remove/reorder with retired history', () => {
  it('E1b L11e L11f – add, remove and reorder atomically by UUID, retired identities retained', () => {
    const dbPath = tempDb('reconcile.sqlite');
    const db = new DatabaseService(dbPath);
    const raw = db.raw;

    const seenAt1 = '2026-09-25T01:00:00Z';
    reconcileGpuIdentities(raw, 'fixture-box-zeta', [
      { gpuUuid: 'GPU-UUID-KEEP', gpuName: 'RTX 3090', ordinal: 0 },
      { gpuUuid: 'GPU-UUID-GONE', gpuName: 'RTX 4090', ordinal: 1 },
    ], seenAt1);

    const keep1 = raw.prepare('SELECT id, gpu_uuid, ordinal, status, first_seen, last_seen FROM xm_devices WHERE gpu_uuid = ?').get('GPU-UUID-KEEP') as any;
    const gone1 = raw.prepare('SELECT id, gpu_uuid, ordinal, status FROM xm_devices WHERE gpu_uuid = ?').get('GPU-UUID-GONE') as any;
    expect(keep1.ordinal).toBe(0);
    expect(keep1.status).toBe('active');
    expect(gone1.status).toBe('active');
    expect(keep1.first_seen).toBe(seenAt1);

    const seenAt2 = '2026-09-25T02:00:00Z';
    reconcileGpuIdentities(raw, 'fixture-box-zeta', [
      { gpuUuid: 'GPU-UUID-NEW', gpuName: 'A100', ordinal: 0 },
      { gpuUuid: 'GPU-UUID-KEEP', gpuName: 'RTX 3090', ordinal: 1 },
    ], seenAt2);

    const keep2 = raw.prepare('SELECT id, gpu_uuid, ordinal, status, first_seen, last_seen FROM xm_devices WHERE gpu_uuid = ?').get('GPU-UUID-KEEP') as any;
    const gone2 = raw.prepare('SELECT id, gpu_uuid, ordinal, status FROM xm_devices WHERE gpu_uuid = ?').get('GPU-UUID-GONE') as any;
    const new2 = raw.prepare('SELECT gpu_uuid, gpu_name, ordinal, status FROM xm_devices WHERE gpu_uuid = ?').get('GPU-UUID-NEW') as any;

    expect(keep2.id).toBe(keep1.id);
    expect(keep2.ordinal).toBe(1);
    expect(keep2.status).toBe('active');
    expect(keep2.first_seen).toBe(seenAt1);
    expect(keep2.last_seen).toBe(seenAt2);

    expect(gone2.id).toBe(gone1.id);
    expect(gone2.status).toBe('retired');

    expect(new2).toMatchObject({
      gpu_uuid: 'GPU-UUID-NEW',
      gpu_name: 'A100',
      ordinal: 0,
      status: 'active',
    });

    db.close();
  });

  it('L11d – GPU history attaches to UUID via samples, retired identity preserves history', () => {
    const dbPath = tempDb('history.sqlite');
    const db = new DatabaseService(dbPath);
    const raw = db.raw;

    const seenAt1 = '2026-09-25T01:00:00Z';
    reconcileGpuIdentities(raw, 'fixture-box-zeta', [
      { gpuUuid: 'GPU-UUID-HIST', gpuName: 'RTX 4090', ordinal: 0 },
    ], seenAt1);

    persistSampleCycle(raw, [{
      machineName: 'fixture-box-zeta',
      gpuUuid: 'GPU-UUID-HIST',
      sampleTime: seenAt1,
      temperature: 71,
      powerWatts: 180,
      utilizationGpu: 0.5,
      utilizationMem: 0.25,
      fanSpeed: 900,
      vramMb: 24576,
    }]);

    const seenAt2 = '2026-09-25T02:00:00Z';
    reconcileGpuIdentities(raw, 'fixture-box-zeta', [], seenAt2);

    const device = raw.prepare('SELECT gpu_uuid, status, first_seen FROM xm_devices WHERE gpu_uuid = ?').get('GPU-UUID-HIST') as any;
    expect(device.status).toBe('retired');
    expect(device.first_seen).toBe(seenAt1);

    const samples = raw.prepare('SELECT gpu_uuid, temperature, sample_time FROM xm_samples WHERE gpu_uuid = ?').all('GPU-UUID-HIST') as any[];
    expect(samples).toHaveLength(1);
    expect(samples[0].temperature).toBe(71);

    db.close();
  });

  it('atomicity – duplicate UUID in observed batch throws and rolls back entire transaction', () => {
    const dbPath = tempDb('atomic.sqlite');
    const db = new DatabaseService(dbPath);
    const raw = db.raw;

    reconcileGpuIdentities(raw, 'fixture-box-zeta', [
      { gpuUuid: 'GPU-UUID-A', gpuName: 'RTX 3090', ordinal: 0 },
    ], '2026-09-25T01:00:00Z');

    const before = raw.prepare('SELECT COUNT(*) as c FROM xm_devices').get() as any;
    const beforeCount = before.c;

    expect(() => reconcileGpuIdentities(raw, 'fixture-box-zeta', [
      { gpuUuid: 'GPU-UUID-B', gpuName: 'A100', ordinal: 0 },
      { gpuUuid: 'GPU-UUID-B', gpuName: 'A100-dup', ordinal: 1 },
    ], '2026-09-25T02:00:00Z')).toThrow();

    const after = raw.prepare('SELECT COUNT(*) as c FROM xm_devices').get() as any;
    expect(after.c).toBe(beforeCount);

    db.close();
  });
});
