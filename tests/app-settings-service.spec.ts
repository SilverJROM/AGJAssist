import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  AppSettingsService,
  DEFAULT_EVIDENCE_IDLE_THRESHOLD_MIN,
  DEFAULT_EVIDENCE_READ_CADENCE_MIN,
  DEFAULT_STUCK_NUDGE_COOLDOWN_MIN,
  DEFAULT_UNIFIED_IDLE_THRESHOLD_MIN
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
    expect(overmind.stuck_nudge_cooldown_minutes).toBe(DEFAULT_STUCK_NUDGE_COOLDOWN_MIN);
    expect(overmind.evidence_read_cadence_minutes).toBe(DEFAULT_EVIDENCE_READ_CADENCE_MIN);
    expect(overmind.unified_idle_threshold_minutes).toBe(DEFAULT_UNIFIED_IDLE_THRESHOLD_MIN);
    expect(DEFAULT_EVIDENCE_IDLE_THRESHOLD_MIN).toBe(DEFAULT_UNIFIED_IDLE_THRESHOLD_MIN);
  });

  it("writes atomically and the new value is immediately visible via get()", async () => {
    const svc = makeService();
    await svc.load();

    await svc.setOvermindCooldown("stuck_nudge_cooldown_minutes", 10);
    const overmind = svc.get();
    expect(overmind.stuck_nudge_cooldown_minutes).toBe(10);

    // Verify the file on disk matches.
    const raw = JSON.parse(fs.readFileSync(path.join(tmpDir, "data", "app-settings.json"), "utf-8"));
    expect(raw.overmind.stuck_nudge_cooldown_minutes).toBe(10);
  });

  it("rejects negative values with an error", async () => {
    const svc = makeService();
    await svc.load();

    await expect(svc.setOvermindCooldown("stuck_nudge_cooldown_minutes", -1)).rejects.toThrow(
      /non-negative/i
    );
  });

  it("rejects NaN with an error", async () => {
    const svc = makeService();
    await svc.load();

    await expect(svc.setOvermindCooldown("evidence_read_cadence_minutes", NaN)).rejects.toThrow(
      /non-negative/i
    );
  });

  it("cache returns the new value immediately after set (no need to reload)", async () => {
    const svc = makeService();
    await svc.load();

    await svc.setOvermindCooldown("evidence_read_cadence_minutes", 5);
    expect(svc.get().evidence_read_cadence_minutes).toBe(5);

    // Write a second time — should override the first.
    await svc.setOvermindCooldown("evidence_read_cadence_minutes", 10);
    expect(svc.get().evidence_read_cadence_minutes).toBe(10);
  });

  it("round-trips unified_idle_threshold_minutes with default 30", async () => {
    const svc = makeService();
    await svc.load();

    expect(svc.get().unified_idle_threshold_minutes).toBe(DEFAULT_UNIFIED_IDLE_THRESHOLD_MIN);
    expect(DEFAULT_UNIFIED_IDLE_THRESHOLD_MIN).toBe(30);
    await svc.setOvermindCooldown("unified_idle_threshold_minutes", 65);
    expect(svc.get().unified_idle_threshold_minutes).toBe(65);

    const onDisk = JSON.parse(fs.readFileSync(path.join(tmpDir, "data", "app-settings.json"), "utf-8"));
    expect(onDisk.overmind.unified_idle_threshold_minutes).toBe(65);
  });

  it("backward-read: existing settings.json with `idle_nudge_cooldown_minutes` maps to `stuck_nudge_cooldown_minutes`", async () => {
    const settingsPath = path.join(tmpDir, "data", "app-settings.json");
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ overmind: { idle_nudge_cooldown_minutes: 60 } }, null, 2)
    );
    const svc = makeService();
    await svc.load();
    expect(svc.get().stuck_nudge_cooldown_minutes).toBe(60);
  });

  it("backward-read: existing settings.json with `evidence_idle_threshold_minutes` migrates to `unified_idle_threshold_minutes` on load", async () => {
    // Write a settings file with the OLD key (no new key) — simulates an
    // existing deploy that already had user-set value 60.
    const settingsPath = path.join(tmpDir, "data", "app-settings.json");
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ overmind: { evidence_idle_threshold_minutes: 60 } }, null, 2)
    );
    const svc = makeService();
    await svc.load();
    expect(svc.get().unified_idle_threshold_minutes).toBe(60);
  });

  it("reads fresh values from disk after cache expires", async () => {
    const svc = makeService();
    await svc.load();

    // Directly modify the file on disk.
    const settingsPath = path.join(tmpDir, "data", "app-settings.json");
    const onDisk = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    onDisk.overmind.stuck_nudge_cooldown_minutes = 99;
    fs.writeFileSync(settingsPath, JSON.stringify(onDisk, null, 2));

    // Expire the cache by backdating cachedAt.
    (svc as any).cachedAt = Date.now() - 10_000; // 10 s ago — past the 5 s TTL.
    // A new load picks it up.
    await svc.load();

    expect(svc.get().stuck_nudge_cooldown_minutes).toBe(99);
  });

  it("accepts zero as a valid cooldown value", async () => {
    const svc = makeService();
    await svc.load();

    await svc.setOvermindCooldown("stuck_nudge_cooldown_minutes", 0);
    expect(svc.get().stuck_nudge_cooldown_minutes).toBe(0);
  });
});
