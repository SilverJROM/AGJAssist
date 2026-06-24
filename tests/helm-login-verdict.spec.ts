import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decideHelmLoginVerdict } from "../src/bot/helm-login-verdict.js";
import { helmLoginChallengeStore } from "../src/bot/helm-login-store.js";

describe("Helm login verdict", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-24T00:00:00.000Z"));
    helmLoginChallengeStore.clear();
  });

  afterEach(() => {
    helmLoginChallengeStore.clear();
    vi.useRealTimers();
  });

  it("passes when the selected number matches the display number", () => {
    expect(decideHelmLoginVerdict({ displayNumber: 42 }, 42)).toBe("pass");
  });

  it("fails when the selected number does not match the display number", () => {
    expect(decideHelmLoginVerdict({ displayNumber: 42 }, 17)).toBe("fail");
  });

  it("treats expired challenges as no verdict and no reusable challenge", () => {
    helmLoginChallengeStore.put({
      challengeId: "challenge-expired",
      displayNumber: 42,
      callbackUrl: "http://127.0.0.1:3110/api/auth/tg-callback",
      ttlMs: 1_000
    });

    vi.advanceTimersByTime(1_001);

    expect(helmLoginChallengeStore.consume("challenge-expired")).toEqual({
      ok: false,
      reason: "expired"
    });
    expect(helmLoginChallengeStore.consume("challenge-expired")).toEqual({
      ok: false,
      reason: "missing"
    });
  });
});
