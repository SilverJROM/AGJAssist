import { describe, expect, it } from "vitest";
import { WatcherCooldowns } from "../src/services/overmind/cooldowns.js";

describe("WatcherCooldowns", () => {
  it("fires when a workflow/key has never fired", () => {
    const cooldowns = new WatcherCooldowns();

    expect(cooldowns.shouldFire(1, "idle_nudge", 60_000, 60_000)).toBe(true);
    expect(cooldowns.getLastFired(1, "idle_nudge")).toBe(0);
  });

  it("blocks within the cooldown and fires when elapsed", () => {
    const cooldowns = new WatcherCooldowns();

    cooldowns.recordFired(1, "idle_nudge", 10_000);

    expect(cooldowns.shouldFire(1, "idle_nudge", 60_000, 69_999)).toBe(false);
    expect(cooldowns.shouldFire(1, "idle_nudge", 60_000, 70_000)).toBe(true);
  });

  it("keeps keys and workflows isolated", () => {
    const cooldowns = new WatcherCooldowns();

    cooldowns.recordFired(1, "idle_nudge", 10_000);

    expect(cooldowns.getLastFired(1, "idle_nudge")).toBe(10_000);
    expect(cooldowns.getLastFired(1, "ask_update")).toBe(0);
    expect(cooldowns.getLastFired(2, "idle_nudge")).toBe(0);
  });

  it("forgets all keys for one workflow", () => {
    const cooldowns = new WatcherCooldowns();

    cooldowns.recordFired(1, "idle_nudge", 10_000);
    cooldowns.recordFired(1, "ask_update", 20_000);
    cooldowns.recordFired(2, "idle_nudge", 30_000);
    cooldowns.forget(1);

    expect(cooldowns.getLastFired(1, "idle_nudge")).toBe(0);
    expect(cooldowns.getLastFired(1, "ask_update")).toBe(0);
    expect(cooldowns.getLastFired(2, "idle_nudge")).toBe(30_000);
  });
});
