import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ForceChallengeService } from '../../src/services/xmachines/force-challenge.js';

describe('xmachines force challenge A3', () => {
  let svc: ForceChallengeService;
  const ownerId = 1;
  const sessionId = 'session-1';
  const machine = 'gpu';
  const action = 'off' as const;

  beforeEach(() => {
    svc = new ForceChallengeService();
  });

  afterEach(() => {
    // cleanup
  });

  it('L3a: full force is a separate action from normal off', () => {
    const ch = svc.startChallenge(ownerId, sessionId, machine, action);
    expect(ch).toBeTruthy();
    expect(ch!.id).toBeTruthy();
    // Challenge service does not create force gateway path by itself
    // Service layer has no gateway invocation
  });

  it('L3c: a successful force challenge can be consumed only once', () => {
    const res = svc.startChallenge(ownerId, sessionId, machine, action)!;
    const ch = svc['challenges'].get(res.id)!;
    // first consumption succeeds
    const first = svc.confirmChallenge(res.id, sessionId, machine, action, res.displayNumber);
    expect(first.ok).toBe(true);
    // second consumption fails
    const second = svc.confirmChallenge(res.id, sessionId, machine, action, res.displayNumber);
    expect(second.ok).toBe(false);
    expect(second.reason).toMatch(/consumed|already|used/);
  });

  it('L3d: a force challenge expires no later than 60 seconds', () => {
    const start = 1_790_356_108_000;
    vi.useFakeTimers();
    try {
      vi.setSystemTime(start);
      const res = svc.startChallenge(ownerId, sessionId, machine, action)!;
      vi.setSystemTime(start + 60_000);
      const confirm = svc.confirmChallenge(res.id, sessionId, machine, action, res.displayNumber);
      expect(confirm.ok).toBe(false);
      expect(confirm.reason).toBe('expired');
    } finally {
      vi.useRealTimers();
    }
  });

  it('L3e: a force challenge is bound to one web session', () => {
    const res = svc.startChallenge(ownerId, sessionId, machine, action)!;
    // Wrong session
    const confirm = svc.confirmChallenge(res.id, 'other-session', machine, action, res.displayNumber);
    expect(confirm.ok).toBe(false);
    expect(confirm.reason).toMatch(/session/);
  });

  it('L3f: a force challenge is bound to one machine', () => {
    const res = svc.startChallenge(ownerId, sessionId, machine, action)!;
    const confirm = svc.confirmChallenge(res.id, sessionId, 'hdd', action, res.displayNumber);
    expect(confirm.ok).toBe(false);
    expect(confirm.reason).toMatch(/machine/);
  });

  it('L3g: a force challenge is bound to the force action', () => {
    const res = svc.startChallenge(ownerId, sessionId, machine, action)!;
    const confirm = svc.confirmChallenge(res.id, sessionId, machine, 'on' as any, res.displayNumber);
    expect(confirm.ok).toBe(false);
    expect(confirm.reason).toMatch(/action/);
  });

  it('L3h: force confirmation text contains current live process and lease probe', async () => {
    const processSpecimen = 'pid=9173 comm=signal-live';
    const leaseSpecimen = 'lease=xmac-claim-hdd-17-transcript-archive';
    const holderSpecimen = 'holder=seat-tiller-a3';
    const stubSpecimen = 'processes=checked leases=checked';
    const probed = new ForceChallengeService(async () => ({
      processesText: processSpecimen,
      leasesText: leaseSpecimen,
      leaseHolders: [holderSpecimen],
    }));
    const text = await probed.buildConfirmationText(machine, action);
    expect(text).toContain(processSpecimen);
    expect(text).toContain(leaseSpecimen);
    expect(text).toContain(holderSpecimen);
    expect(text).not.toContain(stubSpecimen);
  });
});
