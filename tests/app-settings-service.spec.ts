import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  AppSettingsService,
  DEFAULT_ASK_UPDATE_COOLDOWN_MIN,
  DEFAULT_IDLE_NUDGE_COOLDOWN_MIN,
  DEFAULT_TASK_STALE_ASK_COOLDOWN_MIN,
  DEFAULT_TASK_STALE_RECENT_UPDATE_GRACE_MIN
} from "../src/services/app-settings-service.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agj-settings-test-"));
  // Point the service at our temp dir by overriding process.cwd.
  vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
  // Create the data/ directory under tmpDir so the service can read/write there.
  fs.mkdirSync(path.join(tmpDir, "data"), { recursive: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeService(): AppSettingsService {
  // Import fresh: re-use the class; the constructor reads DATA_DIR from process.cwd() at module load.
  // Since we mock process.cwd before instantiation the path is resolved correctly.
  return new AppSettingsService();
}

describe("AppSettingsService", () => {
  it("returns defaults when the settings file is missing", async () => {
    const svc = makeService();
    await svc.load(); // creates the file with defaults

    const overmind = svc.get();
    expect(overmind.idle_nudge_cooldown_minutes).toBe(DEFAULT_IDLE_NUDGE_COOLDOWN_MIN);
    expect(overmind.task_stale_ask_cooldown_minutes).toBe(DEFAULT_TASK_STALE_ASK_COOLDOWN_MIN);
    expect(overmind.ask_update_cooldown_minutes).toBe(DEFAULT_ASK_UPDATE_COOLDOWN_MIN);
    expect(overmind.task_stale_recent_update_grace_minutes).toBe(DEFAULT_TASK_STALE_RECENT_UPDATE_GRACE_MIN);
  });

  it("writes atomically and the new value is immediately visible via get()", async () => {
    const svc = makeService();
    await svc.load();

    await svc.setOvermindCooldown("idle_nudge_cooldown_minutes", 10);
    const overmind = svc.get();
    expect(overmind.idle_nudge_cooldown_minutes).toBe(10);

    // Verify the file on disk matches.
    const raw = JSON.parse(fs.readFileSync(path.join(tmpDir, "data", "app-settings.json"), "utf-8"));
    expect(raw.overmind.idle_nudge_cooldown_minutes).toBe(10);
  });

  it("rejects negative values with an error", async () => {
    const svc = makeService();
    await svc.load();

    await expect(svc.setOvermindCooldown("idle_nudge_cooldown_minutes", -1)).rejects.toThrow(
      /non-negative/i
    );
  });

  it("rejects NaN with an error", async () => {
    const svc = makeService();
    await svc.load();

    await expect(svc.setOvermindCooldown("task_stale_ask_cooldown_minutes", NaN)).rejects.toThrow(
      /non-negative/i
    );
  });

  it("cache returns the new value immediately after set (no need to reload)", async () => {
    const svc = makeService();
    await svc.load();

    await svc.setOvermindCooldown("task_stale_recent_update_grace_minutes", 60);
    expect(svc.get().task_stale_recent_update_grace_minutes).toBe(60);

    // Write a second time — should override the first.
    await svc.setOvermindCooldown("task_stale_recent_update_grace_minutes", 90);
    expect(svc.get().task_stale_recent_update_grace_minutes).toBe(90);
  });

  it("round-trips ask_update_cooldown_minutes with default 45", async () => {
    const svc = makeService();
    await svc.load();

    expect(svc.get().ask_update_cooldown_minutes).toBe(DEFAULT_ASK_UPDATE_COOLDOWN_MIN);
    await svc.setOvermindCooldown("ask_update_cooldown_minutes", 65);
    expect(svc.get().ask_update_cooldown_minutes).toBe(65);

    const onDisk = JSON.parse(fs.readFileSync(path.join(tmpDir, "data", "app-settings.json"), "utf-8"));
    expect(onDisk.overmind.ask_update_cooldown_minutes).toBe(65);
  });

  it("reads fresh values from disk after cache expires", async () => {
    const svc = makeService();
    await svc.load();

    // Directly modify the file on disk.
    const settingsPath = path.join(tmpDir, "data", "app-settings.json");
    const onDisk = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    onDisk.overmind.idle_nudge_cooldown_minutes = 99;
    fs.writeFileSync(settingsPath, JSON.stringify(onDisk, null, 2));

    // Expire the cache by backdating cachedAt.
    (svc as any).cachedAt = Date.now() - 10_000; // 10 s ago — past the 5 s TTL.
    // A new load picks it up.
    await svc.load();

    expect(svc.get().idle_nudge_cooldown_minutes).toBe(99);
  });

  it("accepts zero as a valid cooldown value", async () => {
    const svc = makeService();
    await svc.load();

    await svc.setOvermindCooldown("idle_nudge_cooldown_minutes", 0);
    expect(svc.get().idle_nudge_cooldown_minutes).toBe(0);
  });
});
