import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseService } from "../../src/db/database.js";
import { AgentWakeupService } from "../../src/services/agent-wakeup-service.js";
import { SafetyService } from "../../src/services/safety-service.js";
import { AuditService } from "../../src/services/audit-service.js";
import { TmuxService } from "../../src/tmux/tmux-service.js";

let tmpDir: string;
let db: DatabaseService;
let safety: SafetyService;
let audit: AuditService;
let tmux: TmuxService;
let service: AgentWakeupService;

const past = new Date(Date.now() - 60_000).toISOString();
const future = new Date(Date.now() + 60_000).toISOString();

describe("AgentWakeupService", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agj-wakeup-"));
    db = new DatabaseService(path.join(tmpDir, "wakeup.sqlite"));
    safety = new SafetyService(db);
    audit = new AuditService(db);
    tmux = new TmuxService();
    // Spy on tmux sendCommand to avoid real tmux
    vi.spyOn(tmux, "sendCommand").mockResolvedValue({ message: "sent", blocked: false });
    service = new AgentWakeupService(db, safety, tmux, audit);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("create inserts a pending wakeup", () => {
    const w = service.create({ paneTarget: "sess:0.0", manualFireTime: past, action: "echo hello" });
    expect(w.pane_target).toBe("sess:0.0");
    expect(w.action).toBe("echo hello");
    expect(w.status).toBe("pending");
    const fetched = service.getById(w.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.status).toBe("pending");
  });

  it("cancel marks pending wakeup as cancelled", () => {
    const w = service.create({ paneTarget: "sess:0.0", manualFireTime: past, action: "echo hi" });
    const ok = service.cancel(w.id);
    expect(ok).toBe(true);
    const fetched = service.getById(w.id);
    expect(fetched!.status).toBe("cancelled");
  });

  it("cancel does nothing if already fired", async () => {
    const w = service.create({ paneTarget: "sess:0.0", manualFireTime: past, action: "echo hi" });
    await service.fire(w.id);
    const ok = service.cancel(w.id);
    expect(ok).toBe(false);
  });

  it("fire processes due wakeup, sends via tmux, audits, and marks fired", async () => {
    const w = service.create({ paneTarget: "sess:0.0", manualFireTime: past, action: "echo due" });
    const sentSpy = vi.spyOn(tmux, "sendCommand");
    const ok = await service.fire(w.id);
    expect(ok).toBe(true);
    expect(sentSpy).toHaveBeenCalledWith("sess:0.0", "echo due", true, false);
    const fetched = service.getById(w.id);
    expect(fetched!.status).toBe("fired");
    const logs = audit.query({ actionType: "agent_wakeup_fired" });
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0].resource_id).toBe(String(w.id));
  });

  it("fire does not process future wakeup", async () => {
    const w = service.create({ paneTarget: "sess:0.0", manualFireTime: future, action: "echo future" });
    const ok = await service.fire(w.id);
    expect(ok).toBe(false);
    const fetched = service.getById(w.id);
    expect(fetched!.status).toBe("pending");
  });

  it("fire is fire-once", async () => {
    const w = service.create({ paneTarget: "sess:0.0", manualFireTime: past, action: "echo once" });
    const first = await service.fire(w.id);
    const second = await service.fire(w.id);
    expect(first).toBe(true);
    expect(second).toBe(false);
    const fetched = service.getById(w.id);
    expect(fetched!.status).toBe("fired");
  });

  it("fire respects safety block", async () => {
    // Add a safety pattern that blocks rm -rf
    safety.addPattern("rm -rf", "test", false);
    const w = service.create({ paneTarget: "sess:0.0", manualFireTime: past, action: "rm -rf /" });
    const ok = await service.fire(w.id);
    expect(ok).toBe(false);
    const fetched = service.getById(w.id);
    expect(fetched!.status).toBe("cancelled");
    const logs = audit.query({ actionType: "agent_wakeup_blocked" });
    expect(logs.length).toBeGreaterThan(0);
  });

  it("fireDue processes all due pending wakeups", async () => {
    const w1 = service.create({ paneTarget: "sess:0.0", manualFireTime: past, action: "echo 1" });
    const w2 = service.create({ paneTarget: "sess:0.0", manualFireTime: past, action: "echo 2" });
    const w3 = service.create({ paneTarget: "sess:0.0", manualFireTime: future, action: "echo future" });
    const count = await service.fireDue();
    expect(count).toBe(2);
    expect(service.getById(w1.id)!.status).toBe("fired");
    expect(service.getById(w2.id)!.status).toBe("fired");
    expect(service.getById(w3.id)!.status).toBe("pending");
  });
});
