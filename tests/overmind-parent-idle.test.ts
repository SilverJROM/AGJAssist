import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OvermindService, OvermindWorkflow } from "../src/services/overmind-service.js";
import {
  OvermindWatcher,
  PARENT_IDLE_THRESHOLD_MS,
  PARENT_IDLE_RENUDGE_MS
} from "../src/services/overmind-watcher.js";
import { TmuxService } from "../src/tmux/tmux-service.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Minimal OvermindWorkflow factory. Only the fields tickWorkflow() cares about
 * need to be set — the rest are safe defaults.
 */
function workflow(overrides: Partial<OvermindWorkflow> = {}): OvermindWorkflow {
  return {
    id: 1,
    label: "hris-run",
    display_name: null,
    coordinator_session: "coord-parent-idle",
    child_sessions: ["hris-codex55-a6sweep"],
    child_roles: [],
    run_dir: "/tmp",
    status: "working",
    current_task: "B1",
    tasks: [{ id: "B1", label: "batch-1", state: "processing" }],
    pending_decision: null,
    active_session: null,
    active_role: null,
    ended_at: null,
    task_log: [],
    last_pane_hash: null,
    last_activity_at: new Date().toISOString(),
    stuck_since: null,
    nudge_count: 0,
    tier: 0,
    last_notified_transition: null,
    run_started_at: new Date().toISOString(),
    accumulated_ms: 0,
    completion_check: null,
    parent_status: null,
    child_statuses: [],
    info_request: null,
    info_check: null,
    monitoring_paused: false,
    paused_at: null,
    paused_by: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides
  };
}

/**
 * Minimal OvermindService stub — tick only reads list() + calls update()/get().
 * We don't stub every method, just what tickWorkflow() touches.
 */
function makeServiceStub(wf: OvermindWorkflow): OvermindService {
  return {
    list: vi.fn(() => [wf]),
    update: vi.fn(),
    get: vi.fn(() => wf),
    markNotificationTransition: vi.fn(() => false)
  } as unknown as OvermindService;
}

/**
 * Build a TmuxService mock where capturePane returns a fixed pane content per
 * session, sendAndSubmit is a vi.fn(), and sessionExists always returns true.
 *
 * The PARENT pane is idle (empty prompt ❯, no spinner, no hash change) so
 * classifyParentSession() returns "idle".
 *
 * The CHILD pane carries an active turn ("esc to interrupt") so
 * classifyChildSessionStatus() returns "working".
 */
function makeTmuxMock(opts: {
  parentPane?: string;
  childPane?: string;
} = {}) {
  const parentPane = opts.parentPane ?? "❯ ";          // idle — no spinner/activity
  const childPane  = opts.childPane  ?? "Working (3s)\nesc to interrupt"; // child working

  return {
    capturePane: vi.fn(async (target: string) => {
      if (target === "hris-codex55-a6sweep") return childPane;
      return parentPane;
    }),
    sendCommand: vi.fn(async () => ({ message: "sent", blocked: false })),
    sendAndSubmit: vi.fn(async () => true),
    sessionExists: vi.fn(async () => true)
  } as unknown as TmuxService & {
    capturePane: ReturnType<typeof vi.fn>;
    sendCommand: ReturnType<typeof vi.fn>;
    sendAndSubmit: ReturnType<typeof vi.fn>;
    sessionExists: ReturnType<typeof vi.fn>;
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Overmind parent-idle-while-child-working detector", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // (a) parent idle + child working + >15min → ONE sendAndSubmit fires naming the child
  it("(a) nudges coordinator when parent has been idle >15min and a child is still working", async () => {
    const t0 = Date.now();
    // last_pane_hash: null → coordinatorHashChanged = false on first tick → parent is idle.
    // Service stub is a no-op for update() so last_pane_hash stays null every tick.
    const wf = workflow({ last_pane_hash: null });
    const service = makeServiceStub(wf);
    const tmux = makeTmuxMock();
    const watcher = new OvermindWatcher(service, tmux);

    // First tick: record parentIdleSince = t0 (under threshold — no nudge yet).
    await watcher.tick();
    expect(tmux.sendAndSubmit).not.toHaveBeenCalled();

    // Advance time past the 15-min threshold.
    vi.setSystemTime(t0 + PARENT_IDLE_THRESHOLD_MS + 60_000);

    // Second tick: over threshold, child working → nudge MUST fire.
    await watcher.tick();
    expect(tmux.sendAndSubmit).toHaveBeenCalledTimes(1);

    const [target, msg] = tmux.sendAndSubmit.mock.calls[0] as [string, string];
    expect(target).toBe("coord-parent-idle");
    expect(msg).toContain("hris-codex55-a6sweep");
    // Should mention elapsed minutes as an integer ≥ 15.
    const minuteMatch = msg.match(/~(\d+)min/);
    expect(minuteMatch).not.toBeNull();
    expect(parseInt(minuteMatch![1], 10)).toBeGreaterThanOrEqual(15);
  });

  // (b) parent idle + NO child working → no nudge
  it("(b) does NOT nudge when parent is idle but no child is working", async () => {
    const t0 = Date.now();
    const wf = workflow({ last_pane_hash: "HASH", child_sessions: ["child-idle"] });
    const service = makeServiceStub(wf);

    // Both parent and child panes are static/idle.
    const tmux = {
      capturePane: vi.fn(async () => "❯ "),
      sendCommand: vi.fn(async () => ({ message: "sent", blocked: false })),
      sendAndSubmit: vi.fn(async () => true),
      sessionExists: vi.fn(async () => true)
    } as unknown as TmuxService & { sendAndSubmit: ReturnType<typeof vi.fn> };

    const watcher = new OvermindWatcher(service, tmux);
    await watcher.tick();

    // Advance past threshold.
    vi.setSystemTime(t0 + PARENT_IDLE_THRESHOLD_MS + 60_000);
    await watcher.tick();

    // sendAndSubmit may be called for OTHER reasons (completeness etc.), but NOT
    // for a parent-idle nudge message. We verify no call contains the idle keyword.
    const parentIdleCalls = (tmux.sendAndSubmit.mock.calls as [string, string][]).filter(
      ([, m]) => m.includes("idle for")
    );
    expect(parentIdleCalls).toHaveLength(0);
  });

  // (c) parent working → no nudge + map cleared
  it("(c) does NOT nudge and clears idle clock when parent is working", async () => {
    const t0 = Date.now();
    // Give the workflow a DIFFERENT hash from current pane so classifyParentSession sees activity.
    const wf = workflow({ last_pane_hash: "OLD_HASH" });
    const service = makeServiceStub(wf);
    // Parent pane has a different hash → parentStatus = working.
    const tmux = makeTmuxMock({ parentPane: "NEW pane content for working parent" });
    const watcher = new OvermindWatcher(service, tmux);

    // Seed the idle clock artificially by calling tick once with idle pane first,
    // then swap to working pane.
    await watcher.tick();

    vi.setSystemTime(t0 + PARENT_IDLE_THRESHOLD_MS + 60_000);

    // Now use a working-parent tmux.
    // Replace capturePane to return active-turn pane for coordinator.
    (tmux.capturePane as ReturnType<typeof vi.fn>).mockImplementation(async (target: string) => {
      if (target === "hris-codex55-a6sweep") return "Working (3s)\nesc to interrupt";
      return "Working (2s)\nesc to interrupt"; // parent active turn
    });

    await watcher.tick();

    // No parent-idle nudge should have been sent (parent was working on second tick).
    const idleNudgeCalls = (tmux.sendAndSubmit.mock.calls as [string, string][]).filter(
      ([, m]) => m.includes("idle for")
    );
    expect(idleNudgeCalls).toHaveLength(0);
  });

  // (d) re-nudge cap: two ticks within 30min → only 1 sendAndSubmit (dedupe)
  it("(d) re-nudge cap: second tick within 30min after first nudge does NOT send a second nudge", async () => {
    const t0 = Date.now();
    const wf = workflow({ last_pane_hash: null });
    const service = makeServiceStub(wf);
    const tmux = makeTmuxMock();
    const watcher = new OvermindWatcher(service, tmux);

    // First tick — record idle.
    await watcher.tick();

    // Advance past 15-min threshold → nudge fires.
    vi.setSystemTime(t0 + PARENT_IDLE_THRESHOLD_MS + 60_000);
    await watcher.tick();

    const nudgesAfterFirst = (tmux.sendAndSubmit.mock.calls as [string, string][]).filter(
      ([, m]) => m.includes("idle for")
    ).length;
    expect(nudgesAfterFirst).toBe(1);

    // Advance only 5 more minutes (still within the 30-min re-nudge cap).
    vi.setSystemTime(t0 + PARENT_IDLE_THRESHOLD_MS + 60_000 + 5 * 60_000);
    await watcher.tick();

    const nudgesAfterSecond = (tmux.sendAndSubmit.mock.calls as [string, string][]).filter(
      ([, m]) => m.includes("idle for")
    ).length;
    // Still only 1 — the re-nudge cap prevents a second send within 30min.
    expect(nudgesAfterSecond).toBe(1);
  });

  // (e) parent becomes working then idle again → fresh cycle
  it("(e) fresh cycle after parent returns to working: nudges again once idle >15min", async () => {
    const t0 = Date.now();
    const wf = workflow({ last_pane_hash: null });
    const service = makeServiceStub(wf);
    const tmux = makeTmuxMock();
    const watcher = new OvermindWatcher(service, tmux);

    // Phase 1: go idle, advance past threshold, get nudge.
    await watcher.tick();
    vi.setSystemTime(t0 + PARENT_IDLE_THRESHOLD_MS + 60_000);
    await watcher.tick();
    const nudgesPhase1 = (tmux.sendAndSubmit.mock.calls as [string, string][]).filter(
      ([, m]) => m.includes("idle for")
    ).length;
    expect(nudgesPhase1).toBe(1);

    // Phase 2: parent "comes back" — make parent pane active.
    (tmux.capturePane as ReturnType<typeof vi.fn>).mockImplementation(async (target: string) => {
      if (target === "hris-codex55-a6sweep") return "Working (3s)\nesc to interrupt";
      return "Working (2s)\nesc to interrupt"; // parent active
    });
    vi.setSystemTime(t0 + PARENT_IDLE_THRESHOLD_MS + 2 * 60_000);
    await watcher.tick();
    // idle clock should have been cleared (no second nudge yet).

    // Phase 3: parent goes idle again, advance past 15min from NOW.
    (tmux.capturePane as ReturnType<typeof vi.fn>).mockImplementation(async (target: string) => {
      if (target === "hris-codex55-a6sweep") return "Working (3s)\nesc to interrupt";
      return "❯ "; // idle again
    });
    const t1 = Date.now();
    // First idle tick — records new idleSince.
    await watcher.tick();
    // Advance past threshold from t1.
    vi.setSystemTime(t1 + PARENT_IDLE_THRESHOLD_MS + 60_000);
    await watcher.tick();

    // Should now have a SECOND nudge (fresh cycle).
    const nudgesPhase3 = (tmux.sendAndSubmit.mock.calls as [string, string][]).filter(
      ([, m]) => m.includes("idle for")
    ).length;
    expect(nudgesPhase3).toBe(2);
  });

  // (f) monitoring_paused → no nudge
  it("(f) does NOT nudge when monitoring_paused is true", async () => {
    const t0 = Date.now();
    const wf = workflow({ last_pane_hash: null, monitoring_paused: true });
    const service = makeServiceStub(wf);
    const tmux = makeTmuxMock();
    const watcher = new OvermindWatcher(service, tmux);

    await watcher.tick();
    vi.setSystemTime(t0 + PARENT_IDLE_THRESHOLD_MS + 60_000);
    await watcher.tick();

    const idleNudgeCalls = (tmux.sendAndSubmit.mock.calls as [string, string][]).filter(
      ([, m]) => m.includes("idle for")
    );
    expect(idleNudgeCalls).toHaveLength(0);
  });
});
