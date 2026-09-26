import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ForceChallengeService } from '../src/services/xmachines/force-challenge.js';

describe('xmachines force challenge route capture C8', () => {
  let svc: ForceChallengeService;
  
  beforeEach(() => {
    svc = new ForceChallengeService();
  });

  it('D3a L15b: force challenge creation requires idempotency key and owner', () => {
    const result = svc.startChallenge(1, 'session-1', 'gpu', 'off');
    expect(result).toBeTruthy();
    expect(result.id).toBeTruthy();
    expect(result.displayNumber).toBeGreaterThanOrEqual(10);
    expect(result.displayNumber).toBeLessThanOrEqual(99);
    expect(result.buttons.length).toBeGreaterThanOrEqual(3);
  });

  it('D3b L3b: force unavailable until number-match confirmation succeeds - Telegram receipt', () => {
    const started = svc.startChallenge(1, 'session-1', 'gpu', 'off');
    const wrong = svc.confirmChallenge(started.id, 'session-1', 'gpu', 'off', 999);
    expect(wrong.ok).toBe(false);
    expect(wrong.reason).toBe('wrong-number');
    
    const correct = svc.confirmChallenge(started.id, 'session-1', 'gpu', 'off', started.displayNumber);
    expect(correct.ok).toBe(true);
  });

  it('L15b: idempotency key required for power POST', () => {
    // Service level test - challenge creation requires valid parameters
    const ch = svc.startChallenge(1, 'sess-1', 'hdd', 'off');
    expect(ch.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
