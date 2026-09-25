import { describe, it, expect } from 'vitest';

type MachineName = 'gpu' | 'gpu2' | 'hdd' | string;

interface ProtectedRole {
  machine: MachineName;
  ipSuffix: string;
  role: string;
  reason: string;
}

function isProtected(machineName: string, ip: string, roles: Record<string, boolean>, hddLeaseActive: boolean, hddScheduleActive: boolean): { protected: boolean; role?: string } {
  const base = machineName.toLowerCase();
  const ipTail = ip.split('.').pop() ?? '';

  if (base === 'gpu' && ipTail === '174') {
    if (roles.signal) {
      return { protected: true, role: 'signal' };
    }
  }
  if (base === 'gpu2' && ipTail === '179') {
    if (roles.glimmer) {
      return { protected: true, role: 'glimmer' };
    }
  }
  if (base === 'hdd' && ipTail === '169') {
    if (hddLeaseActive || hddScheduleActive) {
      return { protected: true, role: 'transcript-archive' };
    }
  }
  return { protected: false };
}

describe('xmachines protected roles resolver', () => {
  it('L4a gpu .174 protected while signal role live', () => {
    const res = isProtected('gpu', '192.168.254.174', { signal: true, glimmer: false }, false, false);
    expect(res.protected).toBe(true);
    expect(res.role).toBe('signal');
  });

  it('L4b gpu2 .179 protected while glimmer role live', () => {
    const res = isProtected('gpu2', '192.168.254.179', { signal: false, glimmer: true }, false, false);
    expect(res.protected).toBe(true);
    expect(res.role).toBe('glimmer');
  });

  it('L4c hdd .169 protected during transcript-archive lease', () => {
    const res = isProtected('hdd', '192.168.254.169', { signal: false, glimmer: false }, true, false);
    expect(res.protected).toBe(true);
    expect(res.role).toBe('transcript-archive');
  });

  it('L4c hdd .169 protected during scheduled window', () => {
    const res = isProtected('hdd', '192.168.254.169', { signal: false, glimmer: false }, false, true);
    expect(res.protected).toBe(true);
    expect(res.role).toBe('transcript-archive');
  });

  it('L4e hard-refuse .174 and .179 during run', () => {
    const gpuRes = isProtected('gpu', '192.168.254.174', { signal: true, glimmer: false }, false, false);
    const gpu2Res = isProtected('gpu2', '192.168.254.179', { signal: false, glimmer: true }, false, false);
    expect(gpuRes.protected).toBe(true);
    expect(gpu2Res.protected).toBe(true);
  });

  it('L4f removing live role fixture makes machine controllable', () => {
    const protectedRes = isProtected('gpu', '192.168.254.174', { signal: true, glimmer: false }, false, false);
    expect(protectedRes.protected).toBe(true);
    const clearedRes = isProtected('gpu', '192.168.254.174', { signal: false, glimmer: false }, false, false);
    expect(clearedRes.protected).toBe(false);
  });

  it('L4d active role name exposed', () => {
    const res = isProtected('gpu2', '10.0.0.179', { signal: false, glimmer: true }, false, false);
    expect(res.role).toBe('glimmer');
  });
});
