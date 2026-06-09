import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { OvermindService, OvermindWorkflow } from "../src/services/overmind-service.js";
import { OvermindWatcher, RECONCILE_MS } from "../src/services/overmind-watcher.js";
import { TmuxService } from "../src/tmux/tmux-service.js";
import { resetAllConsecutiveDeadCounts } from "../src/services/overmind/parent-nudge-guard.js";

const isAgentPaneMock = vi.hoisted(() => vi.fn());

vi.mock("../src/services/overmind/agent-pane.js", () => ({
  isAgentPane: isAgentPaneMock
}));

// Minimal OvermindWorkflow factory — only the fields reconcile() and tick() care about.
function workflow(overrides: Partial<OvermindWorkflow> = {}): OvermindWorkflow {
  return {
    id: 1,
    label: "projcore-run",
    display_name: null,
    coordinator_session: "coord-reconcile",
    child_sessions: ["child-1"],
    child_roles: [],
    run_dir: "/tmp/reconcile-run",
    status: "working",
    current_task: "B1",
    tasks: [{ id: "B1", label: "batch-1", state: "processing" }],
    pending_decision: null,
    active_session: null,
    active_role: null,
    ended_at: null,
    task_log: [],
    last_pane_hash: null,
    last_activity_at: "2026-05-22T00:00:00.000Z",
    stuck_since: null,
    nudge_count: 0,
    tier: 0,
    last_notified_transition: null,
    run_started_at: "2026-05-22T00:00:00.000Z",
    accumulated_ms: 0,
    completion_check: null,
    parent_status: null,
    child_statuses: [],
    info_request: null,
    info_check: null,
    monitoring_paused: false,
    paused_at: null,
    paused_by: null,
    last_parent_update_at: null,
    evidence_idle_threshold_override_minutes: null,
    orphaned: false,
    completion_nudge_count: 0,
    working_accepts: 0,
    completion_nudge_last_at: null,
    created_at: "2026-05-22T00:00:00.000Z",
    updated_at: "2026-05-22T00:00:00.000Z",
    ...overrides
  };
}

// Minimal OvermindService stub — reconcile only reads from the workflows list passed in.
function makeServiceStub(rows: OvermindWorkflow[]): OvermindService {
  return {
    list: vi.fn(() => rows),
    update: vi.fn(),
    get: vi.fn(),
    getParentSessionForWorkflow: vi.fn(() => null)
  } as unknown as OvermindService;
}

// Build a TmuxService mock where sessionExists is controllable per-target.
function makeTmuxMock(opts: {
  sessionAlive?: boolean;
  sessionAliveMap?: Record<string, boolean>;
}) {
  return {
    capturePane: vi.fn(async () => "quiet pane"),
    sendCommand: vi.fn(async () => ({ message: "sent", blocked: false })),
    sendAndSubmit: vi.fn(async () => true),
    sessionExists: vi.fn(async (target: string) => {
      if (opts.sessionAliveMap) return opts.sessionAliveMap[target] ?? false;
      return opts.sessionAlive ?? true;
    })
  } as unknown as TmuxService & {
    sendCommand: ReturnType<typeof vi.fn>;
    sendAndSubmit: ReturnType<typeof vi.fn>;
    sessionExists: ReturnType<typeof vi.fn>;
  };
}

describe("OvermindWatcher.reconcile()", () => {
  beforeEach(() => {
    isAgentPaneMock.mockReset();
    isAgentPaneMock.mockResolvedValue("codex");
    resetAllConsecutiveDeadCounts();
  });

  afterEach(() => {
    resetAllConsecutiveDeadCounts();
  });

  it("sends a demand when parent alive and an unresolved gap exists (info_request set)", async () => {
    const wf = workflow({ info_request: "roster" });
    const service = makeServiceStub([wf]);
    const tmux = makeTmuxMock({ sessionAlive: true });
    const watcher = new OvermindWatcher(service, tmux);

    await watcher.reconcile([wf]);

    expect(tmux.sendAndSubmit).toHaveBeenCalledTimes(1);
    const [target, msg] = (tmux.sendAndSubmit as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string];
    expect(target).toBe("coord-reconcile");
    // Must mention the gap
    expect(msg).toContain("roster");
    // Must include child-roster update guidance on the project-model endpoint.
    expect(msg).toMatch(/POST \/api\/overmind\/children/);
    expect(msg).toMatch(/child-add|child-rm/);
    // Task-list reminder must be bundled in the SAME message
    expect(msg).toMatch(/POST \/api\/overmind\/tasks/);
  });

  it("does NOT send a demand when info_request is null (no gap)", async () => {
    const wf = workflow({ info_request: null });
    const service = makeServiceStub([wf]);
    const tmux = makeTmuxMock({ sessionAlive: true });
    const watcher = new OvermindWatcher(service, tmux);

    await watcher.reconcile([wf]);

    expect(tmux.sendAndSubmit).not.toHaveBeenCalled();
  });

  it("does NOT send a stale registration-gap demand after a healthy attached run clears the gap", async () => {
    const stale = workflow({
      id: 11,
      project_id: 4,
      coordinator_session: "AGJ-51",
      child_sessions: ["AGJ-codex55"],
      child_roles: ["implementer"],
      info_request: "roster",
      info_check: "dead_child"
    });
    const healthy = workflow({
      ...stale,
      info_request: null,
      info_check: null
    });
    const service = {
      ...makeServiceStub([healthy]),
      get: vi.fn(() => healthy)
    } as unknown as OvermindService;
    const tmux = makeTmuxMock({ sessionAlive: true });
    const watcher = new OvermindWatcher(service, tmux);

    await watcher.reconcile([stale]);

    expect(tmux.sendAndSubmit).not.toHaveBeenCalled();
  });

  it("does NOT send a demand when monitoring_paused is true, even with a gap", async () => {
    const wf = workflow({ info_request: "tasklist", monitoring_paused: true });
    const service = makeServiceStub([wf]);
    const tmux = makeTmuxMock({ sessionAlive: true });
    const watcher = new OvermindWatcher(service, tmux);

    await watcher.reconcile([wf]);

    expect(tmux.sendAndSubmit).not.toHaveBeenCalled();
  });

  it("H7: first dead-parent read (no-session) → one tolerated attempt; second consecutive → no send (orphaned)", async () => {
    const wf = workflow({ info_request: "run_dir" });
    const service = makeServiceStub([wf]);
    const tmux = makeTmuxMock({ sessionAlive: false });
    const watcher = new OvermindWatcher(service, tmux);
    isAgentPaneMock.mockResolvedValue("no-session");

    // First reconcile: count=1 < 2 → H7 downgrade to "unknown", one tolerated send attempt.
    await watcher.reconcile([wf]);
    expect(tmux.sendAndSubmit).toHaveBeenCalledTimes(1);

    // Second reconcile: count=2 = threshold → orphaned, no send.
    await watcher.reconcile([wf]);
    expect(tmux.sendAndSubmit).toHaveBeenCalledTimes(1); // no additional send
  });

  it("task-list reminder is ONLY sent as part of the registration-gap demand, never as a standalone call", async () => {
    const wf = workflow({ info_request: "roles" });
    const service = makeServiceStub([wf]);
    const tmux = makeTmuxMock({ sessionAlive: true });
    const watcher = new OvermindWatcher(service, tmux);

    await watcher.reconcile([wf]);

    // Exactly one sendAndSubmit call total — task-list ask is never a separate call
    expect(tmux.sendAndSubmit).toHaveBeenCalledTimes(1);
    const [, msg] = (tmux.sendAndSubmit as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string];
    // Must contain both the child-roster ask and the task-list ask in one message
    expect(msg).toContain("/api/overmind/children");
    expect(msg).toContain("/api/overmind/tasks");
  });

  it("reconcile() is triggered in tick() when RECONCILE_MS has elapsed", async () => {
    const wf = workflow({ info_request: "tasklist" });
    const rows = [wf];
    const service: OvermindService = {
      list: vi.fn(() => rows),
      update: vi.fn((id: number, fields: Partial<OvermindWorkflow>) => {
        const idx = rows.findIndex(r => r.id === id);
        if (idx >= 0) rows[idx] = { ...rows[idx], ...fields };
        return rows[idx] ?? null;
      }),
      get: vi.fn(() => rows[0])
    } as unknown as OvermindService;
    const tmux = makeTmuxMock({ sessionAlive: true });
    const watcher = new OvermindWatcher(service, tmux);

    // Force lastReconcileAt to "long ago" so the gate fires
    (watcher as unknown as { lastReconcileAt: number }).lastReconcileAt = Date.now() - RECONCILE_MS - 1000;

    await watcher.tick();

    // sendAndSubmit should have been called for the reconcile demand
    const calls = (tmux.sendAndSubmit as ReturnType<typeof vi.fn>).mock.calls as [string, string][];
    const reconcileCalls = calls.filter(([, msg]) => msg.includes("/api/overmind/children"));
    expect(reconcileCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("reconcile() is NOT triggered in tick() when RECONCILE_MS has NOT yet elapsed", async () => {
    const wf = workflow({ info_request: "tasklist", last_pane_hash: null });
    const rows = [wf];
    const service: OvermindService = {
      list: vi.fn(() => rows),
      update: vi.fn((id: number, fields: Partial<OvermindWorkflow>) => {
        const idx = rows.findIndex(r => r.id === id);
        if (idx >= 0) rows[idx] = { ...rows[idx], ...fields };
        return rows[idx] ?? null;
      }),
      get: vi.fn(() => rows[0])
    } as unknown as OvermindService;
    const tmux = makeTmuxMock({ sessionAlive: true });
    const watcher = new OvermindWatcher(service, tmux);

    // Set lastReconcileAt to NOW (gate should not fire)
    (watcher as unknown as { lastReconcileAt: number }).lastReconcileAt = Date.now();

    await watcher.tick();

    const calls = (tmux.sendAndSubmit as ReturnType<typeof vi.fn>).mock.calls as [string, string][];
    const reconcileCalls = calls.filter(([, msg]) => msg.includes("/api/overmind/children"));
    expect(reconcileCalls.length).toBe(0);
  });

  it("handles multiple workflows: demands only from those with a gap + alive parent (H7: dead parent gets one tolerated attempt)", async () => {
    const wfWithGap = workflow({ id: 1, coordinator_session: "coord-a", info_request: "tasklist" });
    const wfNoGap = workflow({ id: 2, coordinator_session: "coord-b", info_request: null });
    const wfPaused = workflow({ id: 3, coordinator_session: "coord-c", info_request: "run_dir", monitoring_paused: true });
    const wfDeadParent = workflow({ id: 4, coordinator_session: "coord-d", info_request: "roles" });

    const rows = [wfWithGap, wfNoGap, wfPaused, wfDeadParent];
    const service = makeServiceStub(rows);
    const tmux = makeTmuxMock({
      sessionAliveMap: {
        "coord-a": true,
        "coord-b": true,
        "coord-c": true,
        "coord-d": false
      }
    });
    const watcher = new OvermindWatcher(service, tmux);
    isAgentPaneMock.mockImplementation(async (target: string) =>
      target === "coord-d" ? "no-session" : "codex"
    );

    await watcher.reconcile(rows);

    // coord-a: gap + alive parent → demand sent.
    // coord-d: first consecutive no-session read (H7 threshold=2) → one tolerated attempt.
    // coord-b: no gap → no send.
    // coord-c: paused → no send.
    const calls = (tmux.sendAndSubmit as ReturnType<typeof vi.fn>).mock.calls as [string, string][];
    const coordACalls = calls.filter(([target]) => target === "coord-a");
    const coordDCalls = calls.filter(([target]) => target === "coord-d");
    expect(coordACalls.length).toBe(1);
    expect(coordACalls[0][1]).toContain("tasklist");
    expect(coordACalls[0][1]).toContain("/api/overmind/children");
    expect(coordACalls[0][1]).toContain("/api/overmind/tasks");
    // coord-d gets one tolerated send attempt (H7 first consecutive read).
    expect(coordDCalls.length).toBe(1);
  });

  // --- Dedupe tests ---

  it("same persistent gap: two reconcile() runs produce exactly ONE sendAndSubmit total", async () => {
    // Same info_request and info_check across both calls — unchanged gap.
    const wf = workflow({ info_request: "roster", info_check: "dead_child" });
    const service = makeServiceStub([wf]);
    const tmux = makeTmuxMock({ sessionAlive: true });
    const watcher = new OvermindWatcher(service, tmux);

    await watcher.reconcile([wf]);
    await watcher.reconcile([wf]); // second cycle, same gap signature

    // Must only have asked once — not nagged on the second cycle.
    expect(tmux.sendAndSubmit).toHaveBeenCalledTimes(1);
  });

  it("gap signature changes between runs: a second sendAndSubmit is sent", async () => {
    const wfFirst = workflow({ id: 1, info_request: "roster", info_check: "dead_child" });
    const service = makeServiceStub([wfFirst]);
    const tmux = makeTmuxMock({ sessionAlive: true });
    const watcher = new OvermindWatcher(service, tmux);

    // First reconcile — asks for 'dead_child' gap.
    await watcher.reconcile([wfFirst]);
    expect(tmux.sendAndSubmit).toHaveBeenCalledTimes(1);

    // Gap signature changes (e.g. child came back but now tasklist is also missing).
    const wfSecond = workflow({ id: 1, info_request: "tasklist", info_check: "tasklist|run_dir" });
    await watcher.reconcile([wfSecond]);

    // New signature → a second ask must be sent.
    expect(tmux.sendAndSubmit).toHaveBeenCalledTimes(2);
  });

  it("gap clears then recurs: asks again on recurrence", async () => {
    const wfGap = workflow({ id: 1, info_request: "roster", info_check: "dead_child" });
    const wfClear = workflow({ id: 1, info_request: null, info_check: null });
    const service = makeServiceStub([wfGap]);
    const tmux = makeTmuxMock({ sessionAlive: true });
    const watcher = new OvermindWatcher(service, tmux);

    // First reconcile — gap is asked.
    await watcher.reconcile([wfGap]);
    expect(tmux.sendAndSubmit).toHaveBeenCalledTimes(1);

    // Gap clears — dedupe entry should be removed.
    await watcher.reconcile([wfClear]);
    expect(tmux.sendAndSubmit).toHaveBeenCalledTimes(1); // still 1, no new ask

    // Gap recurs with the same signature — should ask again (fresh occurrence).
    await watcher.reconcile([wfGap]);
    expect(tmux.sendAndSubmit).toHaveBeenCalledTimes(2);
  });
});
