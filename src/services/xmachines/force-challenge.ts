import crypto from 'node:crypto';

/**
 * Force challenge service satisfying L3 acceptance criteria.
 *
 * Number-match step-up challenge:
 * - Single use
 * - ≤60s expiry
 * - Bound to web session, machine, action
 * - Confirmation text includes live process/lease probe
 * Service creates no force gateway path by itself.
 */

export type ForceAction = 'off' | 'force';

export interface Challenge {
  id: string;
  ownerId: number;
  sessionId: string;
  machine: string;
  action: ForceAction;
  number: number;
  expiresAt: number;
  consumed: boolean;
}

export interface StartChallengeResult {
  id: string;
  displayNumber: number;
  buttons: number[];
  expiresAt: number;
}

export interface ConfirmResult {
  ok: boolean;
  reason?: string;
  challenge?: Challenge;
}

/** Current process/pid and lease/holder text from a probe path outside this service. */
export interface ForceProbeSnapshot {
  processesText: string;
  leasesText: string;
  leaseHolders?: string[];
}

export type ForceProbe = (machine: string) => Promise<ForceProbeSnapshot>;

export class ForceChallengeService {
  private challenges = new Map<string, Challenge>();
  private readonly TTL_MS = 60_000;

  constructor(private readonly getForceProbe?: ForceProbe) {}

  startChallenge(ownerId: number, sessionId: string, machine: string, action: ForceAction): StartChallengeResult {
    const id = crypto.randomUUID();
    const displayNumber = 10 + Math.floor(Math.random() * 90);
    const buttons = new Set<number>([displayNumber]);
    while (buttons.size < 3) buttons.add(10 + Math.floor(Math.random() * 90));
    const expiresAt = Date.now() + this.TTL_MS;
    const ch: Challenge = {
      id,
      ownerId,
      sessionId,
      machine,
      action,
      number: displayNumber,
      expiresAt,
      consumed: false,
    };
    this.challenges.set(id, ch);
    // Cleanup expired challenges periodically
    this.prune();
    return {
      id,
      displayNumber,
      buttons: [...buttons].sort(() => Math.random() - 0.5),
      expiresAt,
    };
  }

  confirmChallenge(
    challengeId: string,
    sessionId: string,
    machine: string,
    action: ForceAction,
    selectedNumber: number,
  ): ConfirmResult {
    const ch = this.challenges.get(challengeId);
    if (!ch) {
      return { ok: false, reason: 'unknown-challenge' };
    }
    if (ch.consumed) {
      return { ok: false, reason: 'already-consumed' };
    }
    if (Date.now() >= ch.expiresAt) {
      ch.consumed = true;
      this.challenges.delete(challengeId);
      return { ok: false, reason: 'expired' };
    }
    if (ch.sessionId !== sessionId) {
      return { ok: false, reason: 'session-mismatch' };
    }
    if (ch.machine !== machine) {
      return { ok: false, reason: 'machine-mismatch' };
    }
    if (ch.action !== action) {
      return { ok: false, reason: 'action-mismatch' };
    }
    if (selectedNumber !== ch.number) {
      // A wrong pick is not consumption. The same challenge stays open until the
      // returned display number is submitted or the challenge expires.
      return { ok: false, reason: 'wrong-number' };
    }
    ch.consumed = true;
    // Keep for audit briefly, then prune
    setTimeout(() => this.challenges.delete(challengeId), 5_000);
    return { ok: true, challenge: ch };
  }

  async buildConfirmationText(machine: string, action: ForceAction): Promise<string> {
    if (!this.getForceProbe) {
      throw new Error('force-probe-missing');
    }
    const probe = await this.getForceProbe(machine);
    const holders = probe.leaseHolders ?? [];
    return [
      `Force confirmation for ${machine} ${action}`,
      probe.processesText,
      probe.leasesText,
      ...holders,
    ].join('\n');
  }

  private prune() {
    const now = Date.now();
    for (const [id, ch] of this.challenges.entries()) {
      if (ch.consumed || now > ch.expiresAt) {
        this.challenges.delete(id);
      }
    }
  }
}
