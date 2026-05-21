import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseService } from "../src/db/database.js";
import { OvermindBrain, BrainVerdict, StuckInput } from "../src/services/overmind-brain.js";
import { OvermindService, OvermindWorkflow } from "../src/services/overmind-service.js";
import { OvermindWatcher, hashPane } from "../src/services/overmind-watcher.js";
import { TmuxService } from "../src/tmux/tmux-service.js";

const TEST_DB = path.join("data", "test-overmind-brain.sqlite");
const QUIET_PANE = Array.from({ length: 45 }, (_, i) => `quiet coordinator line ${i + 1}`).join("\n");
const CHILD_PANE = "child quiet pane";
const POST_BRAIN_NUDGE_PANE = `${QUIET_PANE}\nOvermind Tier 3 nudge`;

class FakeBrain implements OvermindBrain {
  readonly calls: StuckInput[] = [];

  constructor(
    private readonly verdict?: BrainVerdict,
    private readonly error?: Error
  ) {}

  async analyzeStuck(input: StuckInput): Promise<BrainVerdict> {
    this.calls.push(input);
    if (this.error) throw this.error;
    return this.verdict ?? { action: "false-alarm", reason: "test" };
  }
}

function cleanupDb(): void {
  for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

function makeRunDir(): string {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "overmind-brain-"));
  fs.writeFileSync(
    path.join(runDir, "progress.md"),
    Array.from({ length: 90 }, (_, i) => `progress line ${i + 1}`).join("\n")
  );
  fs.writeFileSync(
    path.join(runDir, "callbacks.md"),
    Array.from({ length: 90 }, (_, i) => `callback line ${i + 1}`).join("\n")
  );
  return runDir;
}

function makeTmuxMock(
  panes: Record<string, string>,
  afterSendPane: string = panes["coord-1"] ?? ""
) {
  const captures: Record<string, number> = {};
  return {
    capturePane: vi.fn(async (target: string) => {
      captures[target] = (captures[target] ?? 0) + 1;
      if (target === "coord-1" && captures[target] > 1) return afterSendPane;
      return panes[target] ?? "";
    }),
    sendCommand: vi.fn(async () => ({ message: "sent", blocked: false }))
  } as unknown as TmuxService & {
    capturePane: ReturnType<typeof vi.fn>;
    sendCommand: ReturnType<typeof vi.fn>;
  };
}

let db: DatabaseService;
let service: OvermindService;
let runDirs: string[];

beforeEach(() => {
  cleanupDb();
  db = new DatabaseService(TEST_DB);
  db.ensureOwner(111222);
  service = new OvermindService(db);
  runDirs = [];
});

afterEach(() => {
  db.close();
  cleanupDb();
  for (const runDir of runDirs) {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
});

function registerTier3Workflow(pane: string = QUIET_PANE): OvermindWorkflow {
  const runDir = makeRunDir();
  runDirs.push(runDir);
  const workflow = service.register({
    label: "projcore A6a",
    coordinator_session: "coord-1",
    child_sessions: ["child-1"],
    run_dir: runDir
  });
  service.update(workflow.id, {
    status: "stuck",
    last_pane_hash: hashPane(pane),
    last_activity_at: "2999-01-01T00:00:00.000Z",
    stuck_since: "2000-01-01T00:00:00.000Z",
    nudge_count: 2,
    tier: 2
  });
  return service.get(workflow.id)!;
}

describe("Overmind Tier-3 Sonnet brain plumbing", () => {
  it("calls a fake brain once at Tier 3 and sends nudge text to the coordinator only", async () => {
    const workflow = registerTier3Workflow();
    const brain = new FakeBrain({
      action: "nudge",
      nudgeText: "Coordinator: inspect callbacks.md and report STATUS.",
      reason: "Coordinator pane is frozen after Tier 2."
    });
    const tmux = makeTmuxMock(
      { "coord-1": QUIET_PANE, "child-1": CHILD_PANE },
      POST_BRAIN_NUDGE_PANE
    );
    const watcher = new OvermindWatcher(service, tmux, undefined, brain);

    await watcher.tick();
    const updated = service.get(workflow.id);

    expect(brain.calls).toHaveLength(1);
    expect(brain.calls[0].label).toBe("projcore A6a");
    expect(brain.calls[0].coordinatorPaneTail.split("\n")[0]).toBe("quiet coordinator line 6");
    expect(brain.calls[0].progressTail).toContain("progress line 90");
    expect(brain.calls[0].callbacksTail).toContain("callback line 90");
    expect(tmux.sendCommand).toHaveBeenCalledTimes(1);
    expect(tmux.sendCommand).toHaveBeenCalledWith(
      "coord-1",
      "Coordinator: inspect callbacks.md and report STATUS.",
      true,
      true
    );
    expect(tmux.sendCommand.mock.calls.every((call) => call[0] === "coord-1")).toBe(true);
    expect(updated?.status).toBe("stuck");
    expect(updated?.nudge_count).toBe(2);
    expect(updated?.tier).toBe(3);
    expect(updated?.last_pane_hash).toBe(hashPane(POST_BRAIN_NUDGE_PANE));

    await watcher.tick();
    expect(brain.calls).toHaveLength(1);
  });

  it("escalates blocked verdicts to Telegram and marks the workflow waiting_human", async () => {
    const workflow = registerTier3Workflow();
    const brain = new FakeBrain({
      action: "escalate-blocked",
      reason: "Coordinator is blocked on a human decision."
    });
    const notify = vi.fn(async () => {});
    const tmux = makeTmuxMock({ "coord-1": QUIET_PANE, "child-1": CHILD_PANE });
    const watcher = new OvermindWatcher(service, tmux, notify, brain);

    await watcher.tick();
    const updated = service.get(workflow.id);

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      "BLOCKED · overmind · projcore A6a\nCoordinator is blocked on a human decision."
    );
    expect(updated?.status).toBe("waiting_human");
    expect(updated?.stuck_since).toBeNull();
    expect(updated?.tier).toBe(3);
    expect(tmux.sendCommand).not.toHaveBeenCalled();

    await watcher.tick();
    expect(brain.calls).toHaveLength(1);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("treats false alarms as working and resets the ladder", async () => {
    const workflow = registerTier3Workflow();
    const brain = new FakeBrain({
      action: "false-alarm",
      reason: "Pane is static but progress is visible in callbacks."
    });
    const tmux = makeTmuxMock({ "coord-1": QUIET_PANE, "child-1": CHILD_PANE });
    const watcher = new OvermindWatcher(service, tmux, undefined, brain);

    await watcher.tick();
    const updated = service.get(workflow.id);

    expect(updated?.status).toBe("working");
    expect(updated?.stuck_since).toBeNull();
    expect(updated?.nudge_count).toBe(0);
    expect(updated?.tier).toBe(0);
    expect(tmux.sendCommand).not.toHaveBeenCalled();
  });

  it("falls back to blocked escalation when the brain throws", async () => {
    const workflow = registerTier3Workflow();
    const brain = new FakeBrain(undefined, new Error("claude unavailable"));
    const notify = vi.fn(async () => {});
    const tmux = makeTmuxMock({ "coord-1": QUIET_PANE, "child-1": CHILD_PANE });
    const watcher = new OvermindWatcher(service, tmux, notify, brain);

    await watcher.tick();
    const updated = service.get(workflow.id);

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toContain("BLOCKED · overmind · projcore A6a");
    expect(notify.mock.calls[0][0]).toContain("Tier-3 Sonnet brain failed");
    expect(updated?.status).toBe("waiting_human");
    expect(updated?.tier).toBe(3);
    expect(tmux.sendCommand).not.toHaveBeenCalled();
  });

  it("does not nudge waiting_human or awaiting_decision workflows", async () => {
    const waitingPane = "NEEDS-INFO: please confirm the next step.";
    const decisionPane = ["Which option?", "1. Continue", "2. Stop", "Enter to select"].join("\n");
    const waitingWorkflow = registerTier3Workflow(waitingPane);
    const decisionWorkflow = service.register({
      label: "decision workflow",
      coordinator_session: "coord-2",
      child_sessions: ["child-2"],
      run_dir: waitingWorkflow.run_dir
    });
    service.update(decisionWorkflow.id, {
      status: "stuck",
      last_pane_hash: hashPane(decisionPane),
      last_activity_at: "2999-01-01T00:00:00.000Z",
      stuck_since: "2000-01-01T00:00:00.000Z",
      nudge_count: 2,
      tier: 2
    });

    const brain = new FakeBrain({
      action: "nudge",
      nudgeText: "This should not be sent.",
      reason: "test"
    });
    const tmux = makeTmuxMock({
      "coord-1": waitingPane,
      "child-1": CHILD_PANE,
      "coord-2": decisionPane,
      "child-2": CHILD_PANE
    });
    const watcher = new OvermindWatcher(service, tmux, undefined, brain);

    await watcher.tick();

    expect(service.get(waitingWorkflow.id)?.status).toBe("waiting_human");
    expect(service.get(decisionWorkflow.id)?.status).toBe("awaiting_decision");
    expect(brain.calls).toHaveLength(0);
    expect(tmux.sendCommand).not.toHaveBeenCalled();
  });
});
