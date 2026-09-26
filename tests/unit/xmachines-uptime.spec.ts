import { describe, it, expect } from 'vitest';
import { deriveUptimeDetail, type UptimeDetail, type BootIdentity } from '../../src/services/xmachines/uptime.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const XMAC_LOG = os.homedir() + '/.xmac/xmac.log';

function readLog() {
  try {
    return fs.readFileSync(XMAC_LOG, 'utf8');
  } catch {
    return '';
  }
}

describe('xmachines uptime', () => {
  it('C3a renders OS uptime since current boot', () => {
    const [upSeconds] = fs.readFileSync('/proc/uptime', 'utf8').trim().split(/\s+/).map(Number);
    const bootId = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
    const detail = deriveUptimeDetail({ machine: 'hdd', bootId, upSeconds, log: readLog() });
    expect(detail.uptime).toBeTruthy();
    expect(typeof detail.uptime).toBe('string');
    expect(detail.uptime).not.toBe('unknown');
    expect(detail.provenance).toBe('os');
  });

  it('C3b power-session duration shown only when WAKE→UP matches current boot identity', () => {
    const log = readLog();
    const bootId = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
    const [upSeconds] = fs.readFileSync('/proc/uptime', 'utf8').trim().split(/\s+/).map(Number);
    const detail = deriveUptimeDetail({ machine: 'hdd', bootId, upSeconds, log });
    const hasMatch = /WAKE hdd/.test(log) && /UP hdd/.test(log);
    if (hasMatch) {
      expect(detail.powerSession).not.toBeUndefined();
      if (detail.powerSession) {
        expect(typeof detail.powerSession.duration).toBe('number');
        expect(detail.powerSession.provenance).toBeDefined();
      }
    } else {
      expect(detail.powerSession).toBeUndefined();
    }
  });

  it('C3c unprovable power session renders unknown with provenance', () => {
    const fakeLog = '2026-09-25T00:00:00Z WAKE hdd aa:bb\n2026-09-25T00:01:00Z UP hdd 60s';
    const bootId = 'different-boot-id';
    const upSeconds = 1000;
    const detail = deriveUptimeDetail({ machine: 'hdd', bootId, upSeconds, log: fakeLog });
    expect(detail.powerSession).toBeUndefined();
    expect(detail.provenance).toBe('os');
  });

  it('C3d sampled total on-hours is labelled estimated', () => {
    const bootId = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
    const [upSeconds] = fs.readFileSync('/proc/uptime', 'utf8').trim().split(/\s+/).map(Number);
    const detail = deriveUptimeDetail({ machine: 'hdd', bootId, upSeconds, log: '' });
    expect(detail.sampledOnHours).toBeDefined();
    if (detail.sampledOnHours) {
      expect(detail.sampledOnHours.label).toBe('estimated');
      expect(typeof detail.sampledOnHours.hours).toBe('number');
    }
  });
});
