export const HELM_LOGIN_TTL_MS = 120_000;

export interface HelmLoginChallenge {
  challengeId: string;
  displayNumber: number;
  callbackUrl: string;
  expiresAt: number;
  consumed: boolean;
}

export interface HelmLoginChallengeInput {
  challengeId: string;
  displayNumber: number;
  callbackUrl: string;
  ttlMs?: number;
}

export type HelmLoginConsumeResult =
  | { ok: true; challenge: HelmLoginChallenge }
  | { ok: false; reason: "missing" | "expired" | "consumed" };

type PutResult = { ok: true } | { ok: false; reason: "duplicate" };

class HelmLoginChallengeStore {
  private readonly challenges = new Map<string, HelmLoginChallenge>();

  put(input: HelmLoginChallengeInput): PutResult {
    const now = Date.now();
    this.sweep(now);

    if (this.challenges.has(input.challengeId)) {
      return { ok: false, reason: "duplicate" };
    }

    this.challenges.set(input.challengeId, {
      challengeId: input.challengeId,
      displayNumber: input.displayNumber,
      callbackUrl: input.callbackUrl,
      expiresAt: now + (input.ttlMs ?? HELM_LOGIN_TTL_MS),
      consumed: false
    });

    return { ok: true };
  }

  get(challengeId: string): HelmLoginChallenge | null {
    const entry = this.challenges.get(challengeId);
    if (!entry) return null;

    if (entry.expiresAt <= Date.now()) {
      this.challenges.delete(challengeId);
      return null;
    }

    if (entry.consumed) return null;
    return { ...entry };
  }

  consume(challengeId: string): HelmLoginConsumeResult {
    const entry = this.challenges.get(challengeId);
    if (!entry) return { ok: false, reason: "missing" };

    this.challenges.delete(challengeId);

    if (entry.expiresAt <= Date.now()) {
      return { ok: false, reason: "expired" };
    }

    if (entry.consumed) {
      return { ok: false, reason: "consumed" };
    }

    return {
      ok: true,
      challenge: {
        ...entry,
        consumed: true
      }
    };
  }

  sweep(now = Date.now()): void {
    for (const [challengeId, entry] of this.challenges) {
      if (entry.expiresAt <= now || entry.consumed) {
        this.challenges.delete(challengeId);
      }
    }
  }

  clear(): void {
    this.challenges.clear();
  }
}

export const helmLoginChallengeStore = new HelmLoginChallengeStore();
