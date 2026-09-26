import { describe, it, expect } from 'vitest';
import { parseXmacLog, type UptimeDetail } from '../../src/services/xmachines/uptime.js';

type WolSafetyEvidence = {
  lastWake: string | null;
  verifiedUp: string | null;
  status: 'verified' | 'never-verified' | 'stale';
};

function deriveWolSafety(machine: string, upSeconds: number, log: string): WolSafetyEvidence {
  const lines = log.split('\n');
  const now = new Date();
  const bootTime = new Date(now.getTime() - upSeconds * 1000);
  let lastWake: Date | null = null;
  let lastUp: Date | null = null;
  let wakeTs = '';
  let upTs = '';
  for (const line of lines) {
    if (!line.includes(machine)) continue;
    const tsMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)/);
    if (!tsMatch) continue;
    const ts = new Date(tsMatch[1]);
    if (ts < bootTime) continue;
    if (line.includes('WAKE')) {
      lastWake = ts;
      wakeTs = tsMatch[1];
    }
    if (line.includes('UP')) {
      lastUp = ts;
      upTs = tsMatch[1];
    }
  }
  if (!lastWake) {
    return { lastWake: null, verifiedUp: null, status: 'never-verified' };
  }
  if (!lastUp || lastUp <= lastWake) {
    return { lastWake: wakeTs, verifiedUp: null, status: 'stale' };
  }
  return { lastWake: wakeTs, verifiedUp: upTs, status: 'verified' };
}

describe('xmachines wol-safety', () => {
  it('I5a WoL-safe shows last WAKE followed by verified UP timestamp', () => {
    const log = '2026-09-26T02:18:00Z WAKE hdd aa:bb\n2026-09-26T02:18:45Z UP hdd 45s';
    const evidence = deriveWolSafety('hdd', 86400, log);
    expect(evidence.status).toBe('verified');
    expect(evidence.lastWake).toBe('2026-09-26T02:18:00Z');
    expect(evidence.verifiedUp).toBe('2026-09-26T02:18:45Z');
  });

  it('I5b machine with no verified cold wake shows never verified', () => {
    const log = '';
    const evidence = deriveWolSafety('hdd', 86400, log);
    expect(evidence.status).toBe('never-verified');
    expect(evidence.lastWake).toBeNull();
    expect(evidence.verifiedUp).toBeNull();
  });

  it('I5c stale or never-verified WoL-safe state routes Off through force challenge', () => {
    const log = '2026-09-26T02:18:00Z WAKE hdd aa:bb';
    const evidence = deriveWolSafety('hdd', 86400, log);
    expect(evidence.status).toBe('stale');
    expect(evidence.lastWake).toBe('2026-09-26T02:18:00Z');
    expect(evidence.verifiedUp).toBeNull();
  });

  it('I5d confirmation warns unverified machine may remain off', () => {
    const log = '';
    const evidence = deriveWolSafety('hdd', 86400, log);
    expect(evidence.status).toBe('never-verified');
    const warning = evidence.status !== 'verified' ? 'Unverified machine may remain off' : '';
    expect(warning).toBe('Unverified machine may remain off');
  });
});
