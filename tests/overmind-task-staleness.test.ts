import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  deriveTaskStateFromText,
  invokeJudgeWithFallback,
  OvermindWatcher,
  TASK_STALE_NAG_COOLDOWN_MS,
  TASK_RECENT_UPDATE_GRACE_MS
} from "../src/services/overmind-watcher.js";
import { OvermindService, OvermindWorkflow } from "../src/services/overmind-service.js";
import { TmuxService } from "../src/tmux/tmux-service.js";

const FIXTURES_DIR = path.resolve(fileURLToPath(import.meta.url), "../fixtures");
// node <script> — no spaces in paths so the cmd.split(/\s+/) in the helper works correctly.
const EMIT_JSON_CMD = `node ${path.join(FIXTURES_DIR, "emit-json.js")}`;
const EMIT_BAD_JSON_CMD = `node ${path.join(FIXTURES_DIR, "emit-bad-json.js")}`;

// Fixtures — a few simple task stubs.
const tasks = [
  { id: "B1" },
  { id: "B2" },
  { id: "B3" },
  { id: "A1" },
  { id: "B12" }
];

describe("deriveTaskStateFromText", () => {
  // ── Done patterns ───────────────────────────────────────────────────────────

  it('flags done when "<id> PASS" appears', () => {
    const result = deriveTaskStateFromText("B2 PASS", tasks);
    expect(result.get("B2")).toBe("done");
  });

  it('flags done when "<id> done" appears (case-insensitive)', () => {
    const result = deriveTaskStateFromText("B2 done — moving on", tasks);
    expect(result.get("B2")).toBe("done");
  });

  it('flags done when "<id> merged" appears', () => {
    const result = deriveTaskStateFromText("B3 merged into main", tasks);
    expect(result.get("B3")).toBe("done");
  });

  it('flags done when "<id> VERIFIED" appears (case-insensitive)', () => {
    const result = deriveTaskStateFromText("b1 verified by QA", tasks);
    expect(result.get("B1")).toBe("done");
  });

  it('flags done when "✓ <id>" appears', () => {
    const result = deriveTaskStateFromText("✓ B1", tasks);
    expect(result.get("B1")).toBe("done");
  });

  it('flags done when "✔ <id>" appears', () => {
    const result = deriveTaskStateFromText("✔ B2 some trailing text", tasks);
    expect(result.get("B2")).toBe("done");
  });

  it('flags done when "[x] <id>" appears', () => {
    const result = deriveTaskStateFromText("[x] B1 the label here", tasks);
    expect(result.get("B1")).toBe("done");
  });

  it('flags done when "<id> ✓" appears', () => {
    const result = deriveTaskStateFromText("B3 ✓", tasks);
    expect(result.get("B3")).toBe("done");
  });

  it('flags done when "<id> done" (suffix form)', () => {
    const result = deriveTaskStateFromText("B2 done", tasks);
    expect(result.get("B2")).toBe("done");
  });

  it('flags done when "<id> PASS" (suffix form, uppercase)', () => {
    const result = deriveTaskStateFromText("A1 PASS", tasks);
    expect(result.get("A1")).toBe("done");
  });

  // ── In-progress patterns ────────────────────────────────────────────────────

  it('flags in-progress when "<id> REVISE" appears', () => {
    const result = deriveTaskStateFromText("B3 REVISE — fix the tests", tasks);
    expect(result.get("B3")).toBe("in-progress");
  });

  it('flags in-progress when "<id> in-flight" appears', () => {
    const result = deriveTaskStateFromText("B2 in-flight", tasks);
    expect(result.get("B2")).toBe("in-progress");
  });

  it('flags in-progress when "<id> in progress" appears (space variant)', () => {
    const result = deriveTaskStateFromText("B1 in progress now", tasks);
    expect(result.get("B1")).toBe("in-progress");
  });

  it('flags in-progress when "<id> processing" appears', () => {
    const result = deriveTaskStateFromText("B1 processing", tasks);
    expect(result.get("B1")).toBe("in-progress");
  });

  it('flags in-progress when "<id> iter 2" appears', () => {
    const result = deriveTaskStateFromText("B2 iter 2", tasks);
    expect(result.get("B2")).toBe("in-progress");
  });

  it('flags in-progress when "<id> FAIL" appears (recovery still in-progress)', () => {
    const result = deriveTaskStateFromText("B3 FAIL retrying", tasks);
    expect(result.get("B3")).toBe("in-progress");
  });

  // ── No-match cases — unmentioned ids must NOT appear in result ──────────────

  it("does not include ids that have no mention in the text", () => {
    const result = deriveTaskStateFromText("B2 PASS", tasks);
    expect(result.has("B1")).toBe(false);
    expect(result.has("B3")).toBe(false);
    expect(result.has("A1")).toBe(false);
    expect(result.has("B12")).toBe(false);
  });

  it("returns an empty map for text with no task-id signals", () => {
    const result = deriveTaskStateFromText("all is quiet on the western front", tasks);
    expect(result.size).toBe(0);
  });

  // ── Word-boundary: B1 must NOT fire when B12 is mentioned ──────────────────

  it("does not false-positive B1 when only B12 appears (word boundary)", () => {
    const result = deriveTaskStateFromText("B12 PASS", tasks);
    // B12 matches but B1 must NOT.
    expect(result.get("B12")).toBe("done");
    expect(result.has("B1")).toBe(false);
  });

  it("does not false-positive B1 for text containing B12 in-progress", () => {
    const result = deriveTaskStateFromText("B12 in-flight", tasks);
    expect(result.get("B12")).toBe("in-progress");
    expect(result.has("B1")).toBe(false);
  });

  // ── Multiple ids in one text blob ───────────────────────────────────────────

  it("handles multiple task ids in one blob", () => {
    const text = [
      "B1 PASS",
      "B2 REVISE — retry the unit tests",
      "B3 merged into main"
    ].join("\n");
    const result = deriveTaskStateFromText(text, tasks);
    expect(result.get("B1")).toBe("done");
    expect(result.get("B2")).toBe("in-progress");
    expect(result.get("B3")).toBe("done");
  });

  // ── Case-insensitive ────────────────────────────────────────────────────────

  it("is case-insensitive for task id references", () => {
    const result = deriveTaskStateFromText("b2 pass", tasks);
    expect(result.get("B2")).toBe("done");
  });

  it("is case-insensitive for in-progress keywords", () => {
    const result = deriveTaskStateFromText("B1 In-Flight", tasks);
    expect(result.get("B1")).toBe("in-progress");
  });

  // ── Done takes priority ─────────────────────────────────────────────────────

  it("done pattern takes priority when done appears first on the line", () => {
    // Both patterns match different occurrences; done should win.
    const result = deriveTaskStateFromText("B1 PASS\nB1 REVISE", tasks);
    // done pattern matches the first line; result is done (first match wins in regex).
    expect(result.get("B1")).toBe("done");
  });

  // ── Empty task list ─────────────────────────────────────────────────────────

  it("handles an empty task list gracefully", () => {
    const result = deriveTaskStateFromText("B1 PASS B2 done", []);
    expect(result.size).toBe(0);
  });

  // ── Spacing variants for checkbox ───────────────────────────────────────────

  it('flags done for "[x]  B2" with extra space', () => {
    const result = deriveTaskStateFromText("[x]  B2 label", tasks);
    expect(result.get("B2")).toBe("done");
  });
});

// ─── invokeJudgeWithFallback ─────────────────────────────────────────────────
// Uses real fixture scripts so no spawn mocking is needed:
//   primary = "false"         → always exits non-zero (simulates spark unavailable)
//   fallback = EMIT_JSON_CMD  → emits valid JSON and exits 0
//   both-fail = "false"/"false"
describe("invokeJudgeWithFallback", () => {
  it("returns primary result when primary succeeds", async () => {
    const result = await invokeJudgeWithFallback("prompt", EMIT_JSON_CMD, "false", 10_000);
    expect(result).not.toBeNull();
    expect(result!.model).toBe("primary");
    expect((result!.json as { sessions: unknown[] }).sessions).toHaveLength(1);
  });

  it("falls back to fallback when primary fails (non-zero exit)", async () => {
    const result = await invokeJudgeWithFallback("prompt", "false", EMIT_JSON_CMD, 10_000);
    expect(result).not.toBeNull();
    expect(result!.model).toBe("fallback");
    expect((result!.json as { sessions: unknown[] }).sessions).toHaveLength(1);
  });

  it("returns null when both primary and fallback fail", async () => {
    const result = await invokeJudgeWithFallback("prompt", "false", "false", 10_000);
    expect(result).toBeNull();
  });

  it("falls back when primary emits invalid JSON", async () => {
    const result = await invokeJudgeWithFallback("prompt", EMIT_BAD_JSON_CMD, EMIT_JSON_CMD, 10_000);
    expect(result).not.toBeNull();
    expect(result!.model).toBe("fallback");
  });
});

// ─── assessTaskStaleness throttle gates ─────────────────────────────────────
// Tests for the two cheap pre-I/O guards added to assessTaskStaleness:
//   1. Recent-update grace: task_log last entry within 45 min → return undefined
//   2. Nag cooldown: lastTaskStaleNudgeAt within 30 min → return undefined
//   3. Both clear (old task_log, no recent nag) → proceed to file I/O and derivation
//
// assessTaskStaleness is private; accessed via `(watcher as any)` to keep the
// test self-contained without modifying production visibility.

function makeMinimalWorkflow(overrides: Partial<OvermindWorkflow> = {}): OvermindWorkflow {
  return {
    id: 1,
    label: "test-run",
    display_name: null,
    coordinator_session: "coord-sess",
    child_sessions: [],
    child_roles: [],
    run_dir: "/tmp/stale-test",
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
    stuck_since: null,
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
    created_at: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides
  };
}

function makeWatcher(): OvermindWatcher {
  const serviceStub = {
    list: vi.fn(() => []),
    update: vi.fn(),
    get: vi.fn()
  } as unknown as OvermindService;
  const tmuxStub = {
    capturePane: vi.fn(async () => ""),
    sendAndSubmit: vi.fn(async () => true),
    sessionExists: vi.fn(async () => true)
  } as unknown as TmuxService;
  return new OvermindWatcher(serviceStub, tmuxStub);
}

describe("assessTaskStaleness throttle gates", () => {
  // (a) Recent task_log entry within 45 min → return undefined, no file I/O.
  it("returns undefined when last task_log entry is within 45 min (recent-update grace)", async () => {
    const watcher = makeWatcher();
    const recentAt = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min ago
    const workflow = makeMinimalWorkflow({
      task_log: [{ at: recentAt, current_task: "B1", done: 0, total: 1 }]
    });

    // Advance lastTaskStaleCheckAt to 0 so the 5-min gate would pass if not for the grace.
    // (By default Map returns undefined → 0, so check elapsed = now ≥ TASK_STALE_CHECK_MS → true)
    // The grace check must bail BEFORE any file I/O: confirm by passing a non-existent run_dir.
    const result = await (watcher as any).assessTaskStaleness(
      workflow,
      "pane text B1 PASS",
      "/nonexistent/run/dir/shouldnotberead",
      false
    );

    expect(result).toBeUndefined();
  });

  // (b) Nag cooldown active (lastTaskStaleNudgeAt = now - 15 min) → return undefined.
  it("returns undefined when nag cooldown is active (< 30 min since last tasks_stale ask)", async () => {
    const watcher = makeWatcher();
    const workflow = makeMinimalWorkflow({
      task_log: [] // empty → no recent-update grace applies
    });

    // Inject a recent nag timestamp (15 min ago — within the 30-min cooldown).
    (watcher as any).lastTaskStaleNudgeAt.set(workflow.id, Date.now() - 15 * 60 * 1000);

    const result = await (watcher as any).assessTaskStaleness(
      workflow,
      "pane text B1 PASS",
      "/nonexistent/run/dir/shouldnotberead",
      false
    );

    expect(result).toBeUndefined();
  });

  // (c) Both gates clear (old task_log, no recent nag) → proceeds past throttle.
  // We use a run_dir that doesn't exist so file reads return ""; the pane text alone
  // triggers Tier-1b derivation (pane > 200 chars with "B1 PASS").
  // But 5-min check gate may suppress it unless we pre-seed lastTaskStaleCheckAt to 0.
  // By default the Map has no entry → lastCheck=0, now-0 ≥ TASK_STALE_CHECK_MS (300000) → checkDue=true.
  it("proceeds past throttle gates when task_log is old and no nag cooldown", async () => {
    const watcher = makeWatcher();
    const oldAt = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 60 min ago — outside grace
    // Build a long pane that triggers Tier-1b (>200 chars) with a clear "B1 PASS" signal.
    const longPane = "B1 PASS — task completed successfully\n" + "x".repeat(200);
    const workflow = makeMinimalWorkflow({
      task_log: [{ at: oldAt, current_task: "B1", done: 0, total: 1 }]
    });

    // No nag cooldown set — lastTaskStaleNudgeAt Map has no entry.
    // The 5-min check gate: no prior check → checkDue=true.
    const result = await (watcher as any).assessTaskStaleness(
      workflow,
      longPane,
      "/nonexistent/run/dir",
      false
    );

    // Both grace checks pass; derivation runs; pane text yields B1=done.
    expect(result).toBeDefined();
    expect(result!["B1"]).toBe("done");
  });

  // (d) After a successful send, the cooldown is set; a subsequent call within 30 min → undefined.
  it("records nag timestamp after tasks_stale send; next call within 30 min returns undefined", async () => {
    const watcher = makeWatcher();
    const oldAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const workflow = makeMinimalWorkflow({
      task_log: [{ at: oldAt, current_task: "B1", done: 0, total: 1 }]
    });

    // Simulate that a tasks_stale nag was just sent (set timestamp to now).
    (watcher as any).lastTaskStaleNudgeAt.set(workflow.id, Date.now());

    // A second call right away should be blocked by the 30-min cooldown.
    const result = await (watcher as any).assessTaskStaleness(
      workflow,
      "B1 PASS " + "x".repeat(200),
      "/nonexistent/run/dir",
      false
    );

    expect(result).toBeUndefined();
  });
});
