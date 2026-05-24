import { describe, expect, it, vi } from "vitest";
import { OvermindService, OvermindWorkflow } from "../src/services/overmind-service.js";
import { OvermindWatcher, RECONCILE_MS } from "../src/services/overmind-watcher.js";
import { TmuxService } from "../src/tmux/tmux-service.js";

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
    get: vi.fn()
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
    // Must include re-register ask
    expect(msg).toMatch(/re-register/i);
    expect(msg).toMatch(/POST \/api\/overmind\/register/);
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

  it("does NOT send a demand when monitoring_paused is true, even with a gap", async () => {
    const wf = workflow({ info_request: "tasklist", monitoring_paused: true });
    const service = makeServiceStub([wf]);
    const tmux = makeTmuxMock({ sessionAlive: true });
    const watcher = new OvermindWatcher(service, tmux);

    await watcher.reconcile([wf]);

    expect(tmux.sendAndSubmit).not.toHaveBeenCalled();
  });

  it("does NOT send a demand when parent session is dead (sessionExists → false)", async () => {
    const wf = workflow({ info_request: "run_dir" });
    const service = makeServiceStub([wf]);
    const tmux = makeTmuxMock({ sessionAlive: false });
    const watcher = new OvermindWatcher(service, tmux);

    await watcher.reconcile([wf]);

    expect(tmux.sendAndSubmit).not.toHaveBeenCalled();
  });

  it("task-list reminder is ONLY sent as part of the re-register demand, never as a standalone call", async () => {
    const wf = workflow({ info_request: "roles" });
    const service = makeServiceStub([wf]);
    const tmux = makeTmuxMock({ sessionAlive: true });
    const watcher = new OvermindWatcher(service, tmux);

    await watcher.reconcile([wf]);

    // Exactly one sendAndSubmit call total — task-list ask is never a separate call
    expect(tmux.sendAndSubmit).toHaveBeenCalledTimes(1);
    const [, msg] = (tmux.sendAndSubmit as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string];
    // Must contain both the register ask and the task-list ask in one message
    expect(msg).toContain("/api/overmind/register");
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
    const reconcileCalls = calls.filter(([, msg]) => msg.includes("/api/overmind/register"));
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
    const reconcileCalls = calls.filter(([, msg]) => msg.includes("/api/overmind/register"));
    expect(reconcileCalls.length).toBe(0);
  });

  it("handles multiple workflows: demands only from those with a gap + alive parent", async () => {
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

    await watcher.reconcile(rows);

    // Only coord-a should have received a demand
    const calls = (tmux.sendAndSubmit as ReturnType<typeof vi.fn>).mock.calls as [string, string][];
    expect(calls.length).toBe(1);
    expect(calls[0][0]).toBe("coord-a");
    expect(calls[0][1]).toContain("tasklist");
    expect(calls[0][1]).toContain("/api/overmind/register");
    expect(calls[0][1]).toContain("/api/overmind/tasks");
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
