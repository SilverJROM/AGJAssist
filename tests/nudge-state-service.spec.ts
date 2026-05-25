import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { NudgeStateService } from "../src/services/nudge-state-service.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agj-nudge-state-test-"));
  vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
  fs.mkdirSync(path.join(tmpDir, "data"), { recursive: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeService(): NudgeStateService {
  return new NudgeStateService();
}

const stateFilePath = () => path.join(tmpDir, "data", "overmind-cooldown-state.json");

describe("NudgeStateService", () => {
  it("defaults to {} when the backing file is missing", async () => {
    const svc = makeService();
    await svc.load();
    expect(svc.getLastUnifiedIdleNudge(1)).toBe(0);
    expect(svc.getLastUnifiedIdleNudge(999)).toBe(0);
  });

  it("setLastUnifiedIdleNudge writes atomically; a fresh load on a new instance reads it back", async () => {
    const svc = makeService();
    await svc.load();

    const ts = 1_700_000_000_000;
    svc.setLastUnifiedIdleNudge(42, ts);

    // Verify file on disk was created.
    const raw = JSON.parse(fs.readFileSync(stateFilePath(), "utf-8"));
    expect(raw.workflows["42"].lastUnifiedIdleNudgeAt).toBe(ts);

    // Fresh instance, same file.
    const svc2 = makeService();
    await svc2.load();
    expect(svc2.getLastUnifiedIdleNudge(42)).toBe(ts);
  });

  it("clearWorkflow deletes the entry; a fresh load sees no entry", async () => {
    const svc = makeService();
    await svc.load();

    svc.setLastUnifiedIdleNudge(7, 123456);
    expect(svc.getLastUnifiedIdleNudge(7)).toBe(123456);

    svc.clearWorkflow(7);
    expect(svc.getLastUnifiedIdleNudge(7)).toBe(0);

    // Persist verified by fresh load.
    const svc2 = makeService();
    await svc2.load();
    expect(svc2.getLastUnifiedIdleNudge(7)).toBe(0);
  });

  it("malformed JSON on disk loads as {} and does not throw", async () => {
    fs.writeFileSync(stateFilePath(), "{ not valid json @@@ }");

    const svc = makeService();
    await expect(svc.load()).resolves.toBeUndefined();
    expect(svc.getLastUnifiedIdleNudge(1)).toBe(0);
  });

  it("clearWorkflow on a non-existent key is a no-op (no throw)", async () => {
    const svc = makeService();
    await svc.load();
    expect(() => svc.clearWorkflow(9999)).not.toThrow();
  });

  it("concurrent writes do not corrupt the file — last write wins", async () => {
    const svc = makeService();
    await svc.load();

    // Simulate rapid sequential writes (within the same tick).
    const tsA = 1_000;
    const tsB = 2_000;
    svc.setLastUnifiedIdleNudge(1, tsA);
    svc.setLastUnifiedIdleNudge(1, tsB);

    // In-memory should reflect B.
    expect(svc.getLastUnifiedIdleNudge(1)).toBe(tsB);

    // On-disk should also reflect B.
    const svc2 = makeService();
    await svc2.load();
    expect(svc2.getLastUnifiedIdleNudge(1)).toBe(tsB);
  });

  it("multiple workflows are stored independently", async () => {
    const svc = makeService();
    await svc.load();

    svc.setLastUnifiedIdleNudge(1, 100);
    svc.setLastUnifiedIdleNudge(2, 200);
    svc.setLastUnifiedIdleNudge(3, 300);

    expect(svc.getLastUnifiedIdleNudge(1)).toBe(100);
    expect(svc.getLastUnifiedIdleNudge(2)).toBe(200);
    expect(svc.getLastUnifiedIdleNudge(3)).toBe(300);

    svc.clearWorkflow(2);
    expect(svc.getLastUnifiedIdleNudge(2)).toBe(0);
    // Others unaffected.
    expect(svc.getLastUnifiedIdleNudge(1)).toBe(100);
    expect(svc.getLastUnifiedIdleNudge(3)).toBe(300);
  });

  it("legacy idle and ask-update setters feed the unified timestamp", async () => {
    const svc = makeService();
    await svc.load();

    svc.setLastIdleNudge(1, 100);
    expect(svc.getLastUnifiedIdleNudge(1)).toBe(100);
    svc.setLastAskUpdateNudge(1, 200);
    expect(svc.getLastUnifiedIdleNudge(1)).toBe(200);
  });
});
