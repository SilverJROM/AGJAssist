import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HELM_LOGIN_TTL_MS, helmLoginChallengeStore } from "../src/bot/helm-login-store.js";

describe("Helm login challenge store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-24T00:00:00.000Z"));
    helmLoginChallengeStore.clear();
  });

  afterEach(() => {
    helmLoginChallengeStore.clear();
    vi.useRealTimers();
  });

  it("stores challenges with the default two-minute TTL", () => {
    const now = Date.now();

    const result = helmLoginChallengeStore.put({
      challengeId: "challenge-1",
      displayNumber: 42,
      callbackUrl: "http://127.0.0.1:3110/api/auth/tg-callback"
    });

    expect(result).toEqual({ ok: true });
    expect(helmLoginChallengeStore.get("challenge-1")).toMatchObject({
      challengeId: "challenge-1",
      displayNumber: 42,
      callbackUrl: "http://127.0.0.1:3110/api/auth/tg-callback",
      expiresAt: now + HELM_LOGIN_TTL_MS,
      consumed: false
    });
  });

  it("sweeps expired challenges on access", () => {
    helmLoginChallengeStore.put({
      challengeId: "challenge-1",
      displayNumber: 42,
      callbackUrl: "http://127.0.0.1:3110/api/auth/tg-callback",
      ttlMs: 1_000
    });

    vi.advanceTimersByTime(1_001);

    expect(helmLoginChallengeStore.get("challenge-1")).toBeNull();
    expect(helmLoginChallengeStore.consume("challenge-1")).toEqual({
      ok: false,
      reason: "missing"
    });
  });

  it("consumes a challenge once", () => {
    helmLoginChallengeStore.put({
      challengeId: "challenge-1",
      displayNumber: 42,
      callbackUrl: "http://127.0.0.1:3110/api/auth/tg-callback"
    });

    expect(helmLoginChallengeStore.consume("challenge-1")).toMatchObject({
      ok: true,
      challenge: {
        challengeId: "challenge-1",
        displayNumber: 42,
        consumed: true
      }
    });
    expect(helmLoginChallengeStore.consume("challenge-1")).toEqual({
      ok: false,
      reason: "missing"
    });
  });

  it("rejects duplicate unexpired challenge IDs", () => {
    helmLoginChallengeStore.put({
      challengeId: "challenge-1",
      displayNumber: 42,
      callbackUrl: "http://127.0.0.1:3110/api/auth/tg-callback"
    });

    expect(helmLoginChallengeStore.put({
      challengeId: "challenge-1",
      displayNumber: 17,
      callbackUrl: "http://127.0.0.1:3110/api/auth/tg-callback"
    })).toEqual({ ok: false, reason: "duplicate" });
  });
});
