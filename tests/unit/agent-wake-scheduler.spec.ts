import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseService } from "../../src/db/database.js";
import { AgentEventsService } from "../../src/services/agent-events-service.js";
import { AgentWakeScheduler } from "../../src/services/agent-wake-scheduler.js";
import { TmuxService } from "../../src/tmux/tmux-service.js";

let tmpDir: string;
let db: DatabaseService;
let tmux: TmuxService;
let events: AgentEventsService;
let scheduler: AgentWakeScheduler;

const now = new Date("2026-06-13T12:00:00.000Z");
const dueAt = "2026-06-13T11:59:00.000Z";
const futureAt = "2026-06-13T12:01:00.000Z";

describe("AgentWakeScheduler", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agj-wake-scheduler-"));
    db = new DatabaseService(path.join(tmpDir, "wake.sqlite"));
    tmux = new TmuxService();
    events = new AgentEventsService(db);
    scheduler = new AgentWakeScheduler(db, tmux, events, { now: () => now });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("fires a due poke-pane wake, invokes tmux, and stamps fired_at", async () => {
    vi.spyOn(tmux, "sessionExists").mockResolvedValue(true);
    vi.spyOn(tmux, "capturePane").mockResolvedValue("idle pane");
    const send = vi.spyOn(tmux, "sendAndSubmit").mockResolvedValue(true);
    const wake = scheduler.requestWake("run-a3", "A3b", "agent:0.0", "poke-pane", dueAt);

    const processed = await scheduler.tick();

    expect(send).toHaveBeenCalledWith(
      "agent:0.0",
      "Scheduled wake is due for batch A3b. Report STATUS or continue the current task."
    );
    expect(processed).toHaveLength(1);
    const row = getWake(wake.id);
    expect(row.fired_at).toBe(now.toISOString());
    expect(row.outcome).toBe("fired");
    expect(row.body).toMatchObject({ target_session: "agent:0.0", sent: true });
  });

  it("does not fire a wake that is not yet due", async () => {
    const send = vi.spyOn(tmux, "sendAndSubmit").mockResolvedValue(true);
    const wake = scheduler.requestWake("run-a3", "A3b", "agent:0.0", "poke-pane", futureAt);

    const processed = await scheduler.tick();

    expect(processed).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
    const row = getWake(wake.id);
    expect(row.fired_at).toBeNull();
    expect(row.outcome).toBeNull();
  });

  it("does not double-fire a wake that already has fired_at", async () => {
    vi.spyOn(tmux, "sessionExists").mockResolvedValue(true);
    vi.spyOn(tmux, "capturePane").mockResolvedValue("idle pane");
    const send = vi.spyOn(tmux, "sendAndSubmit").mockResolvedValue(true);
    scheduler.requestWake("run-a3", "A3b", "agent:0.0", "poke-pane", dueAt);

    await scheduler.tick();
    await scheduler.tick();

    expect(send).toHaveBeenCalledTimes(1);
    const rows = db
      .prepare("SELECT fired_at, outcome FROM agent_wake_schedule")
      .all() as { fired_at: string | null; outcome: string | null }[];
    expect(rows).toEqual([{ fired_at: now.toISOString(), outcome: "fired" }]);
  });

  it("records a coordinator signal for wake-coordinator", async () => {
    const wake = scheduler.requestWake(
      "run-a3",
      "A3b",
      "coordinator:0.0",
      "wake-coordinator",
      dueAt
    );

    await scheduler.tick();

    const row = getWake(wake.id);
    expect(row.fired_at).toBe(now.toISOString());
    expect(row.outcome).toBe("coordinator-signaled");
    const eventRows = events.listEvents("run-a3");
    expect(eventRows).toHaveLength(1);
    expect(eventRows[0]).toMatchObject({
      run_id: "run-a3",
      role: "coordinator",
      batch_id: "A3b",
      session: "coordinator:0.0",
      type: "status",
      state: "WAKE",
      source: "post",
      correlation_id: `wake:${wake.id}`
    });
    expect(eventRows[0].body).toMatchObject({
      wake_id: wake.id,
      kind: "wake-coordinator",
      due_at: dueAt
    });
  });

  it("stamps skipped outcomes so missing or busy targets do not retry forever", async () => {
    vi.spyOn(tmux, "sessionExists").mockResolvedValue(false);
    const send = vi.spyOn(tmux, "sendAndSubmit").mockResolvedValue(true);
    const wake = scheduler.requestWake("run-a3", "A3b", "missing:0.0", "poke-pane", dueAt);

    await scheduler.tick();
    await scheduler.tick();

    expect(send).not.toHaveBeenCalled();
    const row = getWake(wake.id);
    expect(row.fired_at).toBe(now.toISOString());
    expect(row.outcome).toBe("skipped-target-missing");
  });
});

function getWake(id: number): {
  fired_at: string | null;
  outcome: string | null;
  body: Record<string, unknown>;
} {
  const row = db
    .prepare("SELECT fired_at, outcome, body FROM agent_wake_schedule WHERE id = ?")
    .get(id) as { fired_at: string | null; outcome: string | null; body: string };
  return {
    fired_at: row.fired_at,
    outcome: row.outcome,
    body: JSON.parse(row.body) as Record<string, unknown>
  };
}
