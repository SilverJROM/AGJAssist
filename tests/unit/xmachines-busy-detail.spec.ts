import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { buildBusyDetail, type BusyDetail } from '../../src/services/xmachines/busy-detail.js';

describe('xmachines busy detail model', () => {
  let scratch: string | undefined;
  let prev: Record<string, string | undefined>;

  afterEach(() => {
    if (prev) {
      restoreEnv('XMACHINES_PROTECTED_FIXTURE_DIR', prev.XMACHINES_PROTECTED_FIXTURE_DIR);
      restoreEnv('XMAC_STATE', prev.XMAC_STATE);
      restoreEnv('XMAC_CONF', prev.XMAC_CONF);
    }
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
  });

  function restoreEnv(name: string, value: string | undefined) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  function setup(machine: string, busyOutput: string, leases: string[], protectedRole?: string) {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'b5-'));
    prev = {
      XMACHINES_PROTECTED_FIXTURE_DIR: process.env.XMACHINES_PROTECTED_FIXTURE_DIR,
      XMAC_STATE: process.env.XMAC_STATE,
      XMAC_CONF: process.env.XMAC_CONF,
    };

    const conf = path.join(scratch, 'machines.conf');
    fs.writeFileSync(conf, `${machine}|192.168.254.174|02:00:00:00:00:50|agjrom|fixture|echo busy\n`);
    process.env.XMAC_CONF = conf;

    const state = path.join(scratch, 'xmac-state');
    fs.mkdirSync(state, { recursive: true });
    const leaseDir = path.join(state, 'leases', machine);
    fs.mkdirSync(leaseDir, { recursive: true });
    for (const lease of leases) {
      fs.writeFileSync(path.join(leaseDir, lease), '');
    }
    process.env.XMAC_STATE = state;

    if (protectedRole) {
      const fixtures = path.join(scratch, 'fixtures');
      fs.mkdirSync(fixtures, { recursive: true });
      fs.writeFileSync(path.join(fixtures, 'status.json'), JSON.stringify({ [machine]: { ip: '192.168.254.174' } }));
      fs.writeFileSync(path.join(fixtures, 'roles.json'), JSON.stringify({ signal: 'live', glimmer: 'cleared' }));
      fs.writeFileSync(path.join(fixtures, 'leases.json'), JSON.stringify({ names: [] }));
      fs.writeFileSync(path.join(fixtures, 'schedule.json'), JSON.stringify({ 'transcript-archive': { active: false } }));
      process.env.XMACHINES_PROTECTED_FIXTURE_DIR = fixtures;
    } else {
      delete process.env.XMACHINES_PROTECTED_FIXTURE_DIR;
    }

    return { busyOutput, leases, protectedRole };
  }

  it('C4a renders current busy-check output', () => {
    setup('gpu', 'process-running', [], undefined);
    const detail = buildBusyDetail('gpu', 'process-running');
    expect(detail.busyCheckOutput).toBe('process-running');
    expect(detail.isBusy).toBe(true);
  });

  it('C4b renders each held xmac lease', () => {
    setup('hdd', '', ['lease1', 'lease2'], undefined);
    const detail = buildBusyDetail('hdd', '');
    expect(detail.leaseNames).toEqual(['lease1', 'lease2']);
    expect(detail.isLeased).toBe(true);
  });

  it('C4c and L4d names blocking mechanism in refusal explanation', () => {
    const { leaseNames } = setup('gpu', 'busy-process', ['active-lease'], 'signal');
    const detail = buildBusyDetail('gpu', 'busy-process');
    expect(detail.isBusy).toBe(true);
    expect(detail.isLeased).toBe(true);
    expect(detail.isProtected).toBe(true);
    expect(detail.protectedRole).toBe('signal');
    const explanation = [detail.busyCheckOutput && `busy: ${detail.busyCheckOutput}`, detail.leaseNames.length && `leases: ${detail.leaseNames.join(', ')}`, detail.protectedRole && `protected-role: ${detail.protectedRole}`].filter(Boolean).join('; ');
    expect(explanation).toContain('busy: busy-process');
    expect(explanation).toContain('leases: active-lease');
    expect(explanation).toContain('protected-role: signal');
  });

  it('empty busy with no leases and no protection', () => {
    setup('gpu', '', [], undefined);
    const detail = buildBusyDetail('gpu', '');
    expect(detail.isBusy).toBe(false);
    expect(detail.isLeased).toBe(false);
    expect(detail.isProtected).toBe(false);
    expect(detail.busyCheckOutput).toBe('');
    expect(detail.leaseNames).toEqual([]);
    expect(detail.protectedRole).toBeUndefined();
  });
});
