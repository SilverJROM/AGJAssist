import { describe, expect, it, vi } from "vitest";
import { OvermindWatcher } from "../src/services/overmind-watcher.js";
import { hashPane } from "../src/services/overmind/pane-utils.js";
import {
  SUBAGENT_PATTERNS,
  SUBAGENT_APPARENT_IDLE_BEFORE_ASK_MS,
  SUBAGENT_REASK_GRACE_MS,
  SUBAGENT_DURATION_GRACE_MS,
  subAgentInFlight,
  paneShowsSubagentDone,
  parseSubagentAckFromPane
} from "../src/services/overmind/subagent-detection.js";
import { OvermindService, OvermindWorkflow } from "../src/services/overmind-service.js";
import { TmuxService } from "../src/tmux/tmux-service.js";

// ─── Minimal workflow factory ────────────────────────────────────────────────
function wf(overrides: Partial<OvermindWorkflow> = {}): OvermindWorkflow {
  return {
    id: 1,
    label: "projcore-sa-test",
    display_name: null,
    coordinator_session: "coord-sa",
    child_sessions: ["child-sa"],
    child_roles: [],
    run_dir: "/tmp/sa-test",
    status: "working",
    current_task: "B1",
    tasks: [{ id: "B1", label: "batch-1", state: "processing" }],
    pending_decision: null,
    active_session: null,
    active_role: null,
    ended_at: null,
    task_log: [],
    last_pane_hash: null,
    last_activity_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    stuck_since: "2000-01-01T00:00:00.000Z",
    nudge_count: 0,
    tier: 0,
    last_notified_transition: null,
    run_started_at: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
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
    created_at: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides
  };
}

// Minimal service stub for watcher integration tests.
function makeService(workflow: OvermindWorkflow) {
  const store = { ...workflow };
  return {
    list: vi.fn(() => [store]),
    update: vi.fn((id: number, fields: Partial<OvermindWorkflow>) => {
      Object.assign(store, fields);
    }),
    get: vi.fn(() => store),
    _store: store
  } as unknown as OvermindService & { _store: OvermindWorkflow };
}

// Build a TmuxService mock with controllable pane responses.
function makeTmux(
  coordPane: string,
  childPane = "child idle quiet",
  opts: { sessionExists?: boolean } = {}
) {
  return {
    capturePane: vi.fn(async (target: string) =>
      target === "child-sa" ? childPane : coordPane
    ),
    sendAndSubmit: vi.fn(async () => true),
    sendCommand: vi.fn(async () => ({ message: "sent", blocked: false })),
    sessionExists: vi.fn(async () => opts.sessionExists ?? true),
    paneCurrentPath: vi.fn(async () => null)
  } as unknown as TmuxService & {
    sendAndSubmit: ReturnType<typeof vi.fn>;
    capturePane: ReturnType<typeof vi.fn>;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Pure function tests
// ─────────────────────────────────────────────────────────────────────────────
describe("SUBAGENT_PATTERNS export", () => {
  it("exports an array of RegExp", () => {
    expect(Array.isArray(SUBAGENT_PATTERNS)).toBe(true);
    expect(SUBAGENT_PATTERNS.length).toBeGreaterThan(0);
    for (const p of SUBAGENT_PATTERNS) {
      expect(p).toBeInstanceOf(RegExp);
    }
  });
});

describe("subAgentInFlight (pure)", () => {
  it("matches '● Task(' at start of line", () => {
    expect(subAgentInFlight("  ● Task(some-tool)")).toBe(true);
  });

  it("matches '⏺ Task(' at start of line", () => {
    expect(subAgentInFlight("  ⏺ Task(foo)")).toBe(true);
  });

  it("matches '● Agent(' at start of line", () => {
    expect(subAgentInFlight("  ● Agent(lead)")).toBe(true);
  });

  it("matches '⏺ Agent(' at start of line", () => {
    expect(subAgentInFlight("  ⏺ Agent(qa)")).toBe(true);
  });

  it("matches 'Running 'foo' agent'", () => {
    expect(subAgentInFlight("Running 'lead' agent")).toBe(true);
  });

  it("matches '[OVERMIND] subagent codex55' (explicit marker)", () => {
    expect(subAgentInFlight("[OVERMIND] subagent codex55")).toBe(true);
  });

  it("is case-insensitive for explicit marker", () => {
    expect(subAgentInFlight("[OVERMIND] Subagent lead")).toBe(true);
  });

  it("returns false for a plain quiet pane", () => {
    expect(subAgentInFlight("coordinator is just thinking\nno sub-agent")).toBe(false);
  });

  it("matches inside a multi-line pane", () => {
    const pane = ["line 1", "  ● Task(dev)", "some other line"].join("\n");
    expect(subAgentInFlight(pane)).toBe(true);
  });
});

describe("paneShowsSubagentDone (pure)", () => {
  it("matches '[OVERMIND] subagent done'", () => {
    expect(paneShowsSubagentDone("[OVERMIND] subagent done")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(paneShowsSubagentDone("[OVERMIND] Subagent Done")).toBe(true);
  });

  it("does NOT match '[OVERMIND] subagent codex55' (not done)", () => {
    expect(paneShowsSubagentDone("[OVERMIND] subagent codex55")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(paneShowsSubagentDone("")).toBe(false);
  });
});

describe("parseSubagentAckFromPane (pure)", () => {
  it("extracts name without minutes", () => {
    const r = parseSubagentAckFromPane("[OVERMIND] subagent codex55");
    expect(r).not.toBeNull();
    expect(r!.name).toBe("codex55");
    expect(r!.expectedMinutes).toBeUndefined();
  });

  it("extracts name with tilde-minutes syntax", () => {
    const r = parseSubagentAckFromPane("[OVERMIND] subagent lead ~20min");
    expect(r!.name).toBe("lead");
    expect(r!.expectedMinutes).toBe(20);
  });

  it("extracts name with bare minutes (no tilde)", () => {
    const r = parseSubagentAckFromPane("[OVERMIND] subagent dev 45min");
    expect(r!.name).toBe("dev");
    expect(r!.expectedMinutes).toBe(45);
  });

  it("returns last match when multiple markers present", () => {
    const pane = [
      "[OVERMIND] subagent first ~10min",
      "some output",
      "[OVERMIND] subagent second ~30min"
    ].join("\n");
    const r = parseSubagentAckFromPane(pane);
    expect(r!.name).toBe("second");
    expect(r!.expectedMinutes).toBe(30);
  });

  it("returns null for pane with no marker", () => {
    expect(parseSubagentAckFromPane("nothing here")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseSubagentAckFromPane("")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Tier-1 integration: TUI indicator → no nudge, status stays working
// ─────────────────────────────────────────────────────────────────────────────
describe("Tier-1: TUI indicator suppresses nudge and keeps status working", () => {
  it("does not fire nudge when pane shows '● Task(...)' and stuck_since is in the past", async () => {
    // Pane has a Task indicator AND the workflow is ostensibly "stuck" (stuck_since in past).
    const pane = [
      "some coordinator output",
      "  ● Task(dev)",
      "Building feature X..."
    ].join("\n");

    const workflow = wf({
      last_pane_hash: hashPane(pane),
      stuck_since: "2000-01-01T00:00:00.000Z"
    });
    const service = makeService(workflow);
    const tmux = makeTmux(pane);

    const watcher = new OvermindWatcher(service, tmux);
    await watcher.tick();

    // sendAndSubmit must NOT have been called (nudge suppressed).
    expect((tmux as any).sendAndSubmit).not.toHaveBeenCalled();

    // status must be "working" (not "stuck").
    const updated = (service as any)._store;
    expect(updated.status).toBe("working");
  });

  it("multiple ticks with indicator present: suppression persists", async () => {
    const pane = "  ⏺ Agent(qa)\nrunning tests...";
    const workflow = wf({
      last_pane_hash: hashPane(pane),
      stuck_since: "2000-01-01T00:00:00.000Z"
    });
    const service = makeService(workflow);
    const tmux = makeTmux(pane);
    const watcher = new OvermindWatcher(service, tmux);

    await watcher.tick();
    await watcher.tick();
    await watcher.tick();

    expect((tmux as any).sendAndSubmit).not.toHaveBeenCalled();
    expect((service as any)._store.status).toBe("working");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Tier-2 integration: apparent-idle >10min → ONE ask, re-ask gated by 2h
// ─────────────────────────────────────────────────────────────────────────────
describe("Tier-2: apparent-idle >10 min → one ask, then 2h re-ask grace", () => {
  it("fires ONE ask after apparent-idle exceeds 10 min threshold", async () => {
    // Parent is idle (stuck_since in past, pane unchanged), child is idle too.
    // No Tier-1 indicator in pane.
    const pane = "coordinator idle recap";
    const workflow = wf({
      last_pane_hash: hashPane(pane),
      stuck_since: "2000-01-01T00:00:00.000Z"
    });
    const service = makeService(workflow);
    const tmux = makeTmux(pane);
    const watcher = new OvermindWatcher(service, tmux);

    // Pre-seed apparentIdleSince to >10 min ago so the threshold fires immediately.
    (watcher as any).apparentIdleSince.set(workflow.id, Date.now() - SUBAGENT_APPARENT_IDLE_BEFORE_ASK_MS - 5_000);

    await watcher.tick();

    // The sub-agent ask must have been sent exactly once.
    const calls = (tmux as any).sendAndSubmit.mock.calls as [string, string][];
    const subagentAsk = calls.filter(([, msg]) => msg.includes("[OVERMIND] subagent"));
    expect(subagentAsk).toHaveLength(1);
    expect(subagentAsk[0][0]).toBe("coord-sa");
    expect(subagentAsk[0][1]).toContain("in-process sub-agent");
  });

  it("does NOT re-ask within the 2h grace window", async () => {
    const pane = "coordinator idle recap";
    const workflow = wf({
      last_pane_hash: hashPane(pane),
      stuck_since: "2000-01-01T00:00:00.000Z"
    });
    const service = makeService(workflow);
    const tmux = makeTmux(pane);
    const watcher = new OvermindWatcher(service, tmux);

    // Pre-seed: apparent idle was set long ago AND last ask was just now (within 2h grace).
    (watcher as any).apparentIdleSince.set(workflow.id, Date.now() - SUBAGENT_APPARENT_IDLE_BEFORE_ASK_MS - 5_000);
    (watcher as any).lastSubagentAskAt.set(workflow.id, Date.now() - 1_000); // 1s ago

    await watcher.tick();
    await watcher.tick();

    const calls = (tmux as any).sendAndSubmit.mock.calls as [string, string][];
    const subagentAsk = calls.filter(([, msg]) => msg.includes("[OVERMIND] subagent"));
    // Must not ask again within 2h grace.
    expect(subagentAsk).toHaveLength(0);
  });

  it("does NOT ask when apparent-idle time is below 10 min threshold", async () => {
    const pane = "coordinator idle recap";
    const workflow = wf({
      last_pane_hash: hashPane(pane),
      stuck_since: "2000-01-01T00:00:00.000Z"
    });
    const service = makeService(workflow);
    const tmux = makeTmux(pane);
    const watcher = new OvermindWatcher(service, tmux);

    // Idle only for 5 min — below threshold.
    (watcher as any).apparentIdleSince.set(workflow.id, Date.now() - 5 * 60 * 1000);

    await watcher.tick();

    const calls = (tmux as any).sendAndSubmit.mock.calls as [string, string][];
    const subagentAsk = calls.filter(([, msg]) => msg.includes("[OVERMIND] subagent"));
    expect(subagentAsk).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Ack flow: parent replies with marker → suppression, then "done" clears it
// ─────────────────────────────────────────────────────────────────────────────
describe("Ack flow", () => {
  it("sets subagentInFlight with name + expectedEndAt from ack marker", async () => {
    const pane = "[OVERMIND] subagent codex55 ~20min";
    const workflow = wf({ last_pane_hash: null });
    const service = makeService(workflow);
    const tmux = makeTmux(pane);
    const watcher = new OvermindWatcher(service, tmux);

    await watcher.tick();

    const entry = (watcher as any).subagentInFlight.get(workflow.id);
    expect(entry).toBeDefined();
    expect(entry.source).toBe("ack");
    expect(entry.name).toBe("codex55");
    // expectedEndAt should be approximately now + 20 min.
    const approxEnd = Date.now() + 20 * 60_000;
    expect(entry.expectedEndAt).toBeGreaterThan(approxEnd - 5_000);
    expect(entry.expectedEndAt).toBeLessThan(approxEnd + 5_000);
  });

  it("suppresses nudges while subagentInFlight is set via ack", async () => {
    const pane = "[OVERMIND] subagent lead ~30min";
    const workflow = wf({
      last_pane_hash: hashPane(pane),
      stuck_since: "2000-01-01T00:00:00.000Z"
    });
    const service = makeService(workflow);
    const tmux = makeTmux(pane);
    const watcher = new OvermindWatcher(service, tmux);

    // First tick: ack detected, suppression active.
    await watcher.tick();
    expect((tmux as any).sendAndSubmit).not.toHaveBeenCalled();
    expect((service as any)._store.status).toBe("working");

    // Second tick: still suppressed (no "done" marker yet).
    await watcher.tick();
    expect((tmux as any).sendAndSubmit).not.toHaveBeenCalled();
    expect((service as any)._store.status).toBe("working");
  });

  it("clears suppression when pane shows '[OVERMIND] subagent done'", async () => {
    const workflow = wf({
      last_pane_hash: null,
      stuck_since: "2000-01-01T00:00:00.000Z"
    });
    const service = makeService(workflow);

    // Two-phase pane: first tick has ack, second tick has done marker.
    let tickCount = 0;
    const tmux = {
      capturePane: vi.fn(async (target: string) => {
        if (target === "child-sa") return "child idle";
        tickCount++;
        if (tickCount <= 2) return "[OVERMIND] subagent lead ~5min";
        return "[OVERMIND] subagent done\nnormal output";
      }),
      sendAndSubmit: vi.fn(async () => true),
      sendCommand: vi.fn(async () => ({ message: "sent", blocked: false })),
      sessionExists: vi.fn(async () => true),
      paneCurrentPath: vi.fn(async () => null)
    } as unknown as TmuxService;

    const watcher = new OvermindWatcher(service, tmux);

    // Tick 1 + 2: ack detected, suppressed.
    await watcher.tick();
    await watcher.tick();
    expect((watcher as any).subagentInFlight.has(workflow.id)).toBe(true);

    // Tick 3: "done" marker clears suppression — nudge ladder can run now.
    await watcher.tick();
    expect((watcher as any).subagentInFlight.has(workflow.id)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Duration grace: expectedEndAt + 10 min elapsed → entry cleared
// ─────────────────────────────────────────────────────────────────────────────
describe("Duration grace resolution", () => {
  it("clears subagentInFlight entry when expectedEndAt + grace has elapsed", async () => {
    const pane = "coordinator output, no sub-agent marker";
    const workflow = wf({ last_pane_hash: hashPane(pane) });
    const service = makeService(workflow);
    const tmux = makeTmux(pane);
    const watcher = new OvermindWatcher(service, tmux);

    // Pre-inject an ack entry whose expectedEndAt + grace has already passed.
    const expiredEnd = Date.now() - SUBAGENT_DURATION_GRACE_MS - 1_000;
    (watcher as any).subagentInFlight.set(workflow.id, {
      source: "ack",
      since: Date.now() - 40 * 60_000,
      name: "lead",
      expectedEndAt: expiredEnd
    });

    await watcher.tick();

    // Entry should be cleared.
    expect((watcher as any).subagentInFlight.has(workflow.id)).toBe(false);
  });

  it("clears lastSubagentAskAt when duration grace expires (allowing fresh ask)", async () => {
    const pane = "coordinator output";
    const workflow = wf({ last_pane_hash: hashPane(pane) });
    const service = makeService(workflow);
    const tmux = makeTmux(pane);
    const watcher = new OvermindWatcher(service, tmux);

    const expiredEnd = Date.now() - SUBAGENT_DURATION_GRACE_MS - 1_000;
    (watcher as any).subagentInFlight.set(workflow.id, {
      source: "ack",
      since: Date.now() - 40 * 60_000,
      name: "dev",
      expectedEndAt: expiredEnd
    });
    // Set a prior ask timestamp — it should be cleared on expiry.
    (watcher as any).lastSubagentAskAt.set(workflow.id, Date.now() - 60_000);

    await watcher.tick();

    expect((watcher as any).lastSubagentAskAt.has(workflow.id)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Pane-substance resolution: Tier-1 entry, indicator gone + hash changed
// ─────────────────────────────────────────────────────────────────────────────
describe("Pane-substance resolution (Tier-1 entry)", () => {
  it("clears TUI entry when indicator is gone AND hash changed since entry was set", async () => {
    const oldPane = "  ● Task(dev)\nworking...";
    const newPane = "new substantial output — task complete";

    // workflow.last_pane_hash is based on the OLD pane (so hash-changed fires).
    const workflow = wf({ last_pane_hash: hashPane(oldPane) });
    const service = makeService(workflow);
    const tmux = makeTmux(newPane); // current pane is new (no indicator)
    const watcher = new OvermindWatcher(service, tmux);

    // Pre-inject a TUI sub-agent entry.
    (watcher as any).subagentInFlight.set(workflow.id, {
      source: "tui",
      since: Date.now() - 5 * 60_000
    });

    await watcher.tick();

    // Entry should be cleared: indicator gone + hash changed.
    expect((watcher as any).subagentInFlight.has(workflow.id)).toBe(false);
  });

  it("does NOT clear TUI entry when indicator is gone but hash is unchanged", async () => {
    const pane = "quiet pane, no sub-agent indicator";
    const workflow = wf({ last_pane_hash: hashPane(pane) }); // same hash as current
    const service = makeService(workflow);
    const tmux = makeTmux(pane);
    const watcher = new OvermindWatcher(service, tmux);

    (watcher as any).subagentInFlight.set(workflow.id, {
      source: "tui",
      since: Date.now() - 5 * 60_000
    });

    await watcher.tick();

    // Entry persists: hash unchanged, so no substance resolution.
    expect((watcher as any).subagentInFlight.has(workflow.id)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. monitoring_paused: no crash, no asks, no suppression triggered
// ─────────────────────────────────────────────────────────────────────────────
describe("monitoring_paused: no interaction from sub-agent logic", () => {
  it("does not crash and does not set subagentInFlight when monitoring is paused", async () => {
    const pane = "  ● Task(dev)\nsome work";
    const workflow = wf({ monitoring_paused: true, last_pane_hash: hashPane(pane) });
    const service = makeService(workflow);
    const tmux = makeTmux(pane);
    const watcher = new OvermindWatcher(service, tmux);

    await watcher.tick();

    // No sub-agent entry should be set (paused branch exits early).
    expect((watcher as any).subagentInFlight.has(workflow.id)).toBe(false);
    // No sendAndSubmit calls.
    expect((tmux as any).sendAndSubmit).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Constants are exported with expected values
// ─────────────────────────────────────────────────────────────────────────────
describe("Sub-agent suppression constants", () => {
  it("SUBAGENT_APPARENT_IDLE_BEFORE_ASK_MS is 10 min", () => {
    expect(SUBAGENT_APPARENT_IDLE_BEFORE_ASK_MS).toBe(10 * 60 * 1000);
  });

  it("SUBAGENT_REASK_GRACE_MS is 2 hours", () => {
    expect(SUBAGENT_REASK_GRACE_MS).toBe(2 * 60 * 60 * 1000);
  });

  it("SUBAGENT_DURATION_GRACE_MS is 10 min", () => {
    expect(SUBAGENT_DURATION_GRACE_MS).toBe(10 * 60 * 1000);
  });
});
