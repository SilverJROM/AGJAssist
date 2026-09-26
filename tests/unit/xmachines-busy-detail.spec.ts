import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { buildBusyDetail } from '../../src/services/xmachines/busy-detail.js';

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

  function setup(machine: string, leases: string[], protectedRole?: string): string {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'b5-'));
    prev = {
      XMACHINES_PROTECTED_FIXTURE_DIR: process.env.XMACHINES_PROTECTED_FIXTURE_DIR,
      XMAC_STATE: process.env.XMAC_STATE,
      XMAC_CONF: process.env.XMAC_CONF,
    };

    // Non-routable registry address. The collector runs the busyCheck locally;
    // it must not name a live host. Protected-role octet lives in status.json.
    const conf = path.join(scratch, 'machines.conf');
    fs.writeFileSync(conf, `${machine}|192.0.2.50|02:00:00:00:00:50|agjrom|fixture|\n`);
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

    return scratch;
  }

  /** Fixture file the configured busyCheck prints. The spec reads it back; the model does not receive the text. */
  function armBusyFixture(machine: string, dir: string): string {
    const fixture = path.join(dir, 'collector-busy.txt');
    fs.writeFileSync(fixture, `probe-hold-${machine}-7741\n`);
    const conf = process.env.XMAC_CONF;
    if (!conf) throw new Error('XMAC_CONF missing');
    const command = `cat ${JSON.stringify(fixture)}`;
    fs.writeFileSync(conf, `${machine}|192.0.2.50|02:00:00:00:00:50|agjrom|fixture|${command}\n`);
    return fixture;
  }

  it('C4a renders current busy-check output from the configured check', () => {
    const dir = setup('gpu', [], undefined);
    const fixture = armBusyFixture('gpu', dir);
    const detail = buildBusyDetail('gpu');
    const boundaryOutput = fs.readFileSync(fixture, 'utf8').trim();
    expect(boundaryOutput).toBe('probe-hold-gpu-7741');
    expect(detail.busyCheckOutput).toBe(boundaryOutput);
    expect(detail.isBusy).toBe(true);
  });

  it('C4b renders each held xmac lease', () => {
    setup('hdd', ['lease1', 'lease2'], undefined);
    const detail = buildBusyDetail('hdd');
    expect(detail.leaseNames).toEqual(['lease1', 'lease2']);
    expect(detail.isLeased).toBe(true);
    expect(detail.refusalExplanation).toContain('lease1');
    expect(detail.refusalExplanation).toContain('lease2');
  });

  it('C4c and L4d names blocking mechanism in the product refusal explanation', () => {
    const dir = setup('gpu', ['hold-alpha', 'hold-beta'], 'signal');
    const fixture = armBusyFixture('gpu', dir);
    const detail = buildBusyDetail('gpu');
    const guard = fs.readFileSync(fixture, 'utf8').trim();
    expect(detail.isBusy).toBe(true);
    expect(detail.isLeased).toBe(true);
    expect(detail.isProtected).toBe(true);
    expect(detail.protectedRole).toBe('signal');
    expect(detail.refusalExplanation).toContain(guard);
    expect(detail.refusalExplanation).toContain('hold-alpha');
    expect(detail.refusalExplanation).toContain('hold-beta');
    expect(detail.refusalExplanation).toContain('signal');
  });

  it('empty busy with no leases and no protection', () => {
    setup('gpu', [], undefined);
    const detail = buildBusyDetail('gpu');
    expect(detail.isBusy).toBe(false);
    expect(detail.isLeased).toBe(false);
    expect(detail.isProtected).toBe(false);
    expect(detail.busyCheckOutput).toBe('');
    expect(detail.leaseNames).toEqual([]);
    expect(detail.protectedRole).toBeUndefined();
    expect(detail.refusalExplanation).toBe('');
  });
});
