import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseService } from "../src/db/database.js";
import {
  OvermindBrain,
  BrainVerdict,
  CompletionInput,
  CompletionVerdict,
  DecisionInput,
  DecisionVerdict,
  SonnetOvermindBrain,
  StuckInput
} from "../src/services/overmind-brain.js";
import { ChatMessage, LlmProvider } from "../src/llm/base-provider.js";
import { OvermindService, OvermindWorkflow } from "../src/services/overmind-service.js";
import { OvermindWatcher } from "../src/services/overmind-watcher.js";
import { hashPane } from "../src/services/overmind/pane-utils.js";
import { TmuxService } from "../src/tmux/tmux-service.js";
import { registerAttachedWorkflowFixture } from "./overmind-fixtures.js";

const isAgentPaneMock = vi.hoisted(() => vi.fn());

vi.mock("../src/services/overmind/agent-pane.js", () => ({
  isAgentPane: isAgentPaneMock
}));

const TEST_DB = path.join("data", "test-overmind-brain.sqlite");
const QUIET_PANE = Array.from({ length: 45 }, (_, i) => `quiet coordinator line ${i + 1}`).join("\n");
const CHILD_PANE = "child quiet pane";
const POST_BRAIN_NUDGE_PANE = `${QUIET_PANE}\nOvermind Tier 3 nudge`;
const STALE_ISO = "2000-01-01T00:00:00.000Z";

class FakeBrain implements OvermindBrain {
  readonly calls: StuckInput[] = [];
  readonly decisionCalls: DecisionInput[] = [];
  readonly completionCalls: CompletionInput[] = [];

  constructor(
    private readonly verdict?: BrainVerdict,
    private readonly error?: Error,
    private readonly completionVerdict?: CompletionVerdict
  ) {}

  async analyzeStuck(input: StuckInput): Promise<BrainVerdict> {
    this.calls.push(input);
    if (this.error) throw this.error;
    return this.verdict ?? { action: "false-alarm", reason: "test" };
  }

  async answerDecision(input: DecisionInput): Promise<DecisionVerdict> {
    this.decisionCalls.push(input);
    return { action: "escalate", reason: "test" };
  }

  async verifyCompletion(input: CompletionInput): Promise<CompletionVerdict> {
    this.completionCalls.push(input);
    return this.completionVerdict ?? {
      action: "consult",
      consultText: "Confirm done + POST /complete, or tell me what remains.",
      reason: "test"
    };
  }
}

function cleanupDb(): void {
  for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

function makeRunDir(): string {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "overmind-brain-"));
  fs.mkdirSync(path.join(runDir, "decisions"));
  fs.writeFileSync(
    path.join(runDir, "decisions/quiet-coordinator.md"),
    "JROM decision: if a quiet coordinator is only missing a callback check, nudge the coordinator first."
  );
  fs.writeFileSync(path.join(runDir, "north-star.md"), "Resolve quiet coordinator stalls before escalating.");
  fs.writeFileSync(
    path.join(runDir, "progress.md"),
    Array.from({ length: 90 }, (_, i) => `progress line ${i + 1}`).join("\n")
  );
  fs.writeFileSync(
    path.join(runDir, "callbacks.md"),
    Array.from({ length: 90 }, (_, i) => `callback line ${i + 1}`).join("\n")
  );
  const staleDate = new Date(STALE_ISO);
  fs.utimesSync(path.join(runDir, "progress.md"), staleDate, staleDate);
  fs.utimesSync(path.join(runDir, "callbacks.md"), staleDate, staleDate);
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
    sendCommand: vi.fn(async () => ({ message: "sent", blocked: false })),
    sendAndSubmit: vi.fn(async () => true)
  } as unknown as TmuxService & {
    capturePane: ReturnType<typeof vi.fn>;
    sendCommand: ReturnType<typeof vi.fn>;
    sendAndSubmit: ReturnType<typeof vi.fn>;
  };
}

let db: DatabaseService;
let service: OvermindService;
let runDirs: string[];

beforeEach(() => {
  cleanupDb();
  isAgentPaneMock.mockReset();
  isAgentPaneMock.mockResolvedValue("codex");
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
  const workflow = registerAttachedWorkflowFixture(service, {
    label: "projcore A6a",
    coordinator_session: "coord-1",
    child_sessions: ["child-1"],
    run_dir: runDir
  });
  service.update(workflow.id, {
    status: "stuck",
    last_pane_hash: hashPane(pane),
    last_activity_at: STALE_ISO,
    stuck_since: STALE_ISO,
    nudge_count: 2,
    tier: 2
  });
  db.prepare("UPDATE overmind_workflows SET last_parent_update_at = ? WHERE id = ?")
    .run(STALE_ISO, workflow.id);
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
    const notify = vi.fn(async () => {});
    const watcher = new OvermindWatcher(service, tmux, notify, brain);

    await watcher.tick();
    const updated = service.get(workflow.id);

    expect(brain.calls).toHaveLength(1);
    expect(brain.calls[0].label).toBe("projcore A6a");
    expect(brain.calls[0].coordinatorPaneTail.split("\n")[0]).toBe("quiet coordinator line 6");
    expect(brain.calls[0].progressTail).toContain("progress line 90");
    expect(brain.calls[0].callbacksTail).toContain("callback line 90");
    expect(brain.calls[0].northStar).toContain("Resolve quiet coordinator stalls");
    expect(brain.calls[0].priorDecisions).toContain("quiet coordinator");
    expect(tmux.sendAndSubmit).toHaveBeenCalledTimes(1);
    expect(tmux.sendAndSubmit).toHaveBeenCalledWith(
      "coord-1",
      "overmind: Coordinator: inspect callbacks.md and report STATUS."
    );
    expect(tmux.sendAndSubmit.mock.calls.every((call: [string, string]) => call[0] === "coord-1")).toBe(true);
    expect(updated?.status).toBe("stuck");
    expect(updated?.nudge_count).toBe(2);
    expect(updated?.tier).toBe(3);
    expect(updated?.last_pane_hash).toBe(hashPane(POST_BRAIN_NUDGE_PANE));
    expect(notify).not.toHaveBeenCalled();

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
    expect(notify.mock.calls[0][0]).toContain("🛑 BLOCKED · AGJAssist · overmind");
    expect(notify.mock.calls[0][0]).toContain("⛔ projcore A6a is stopped and needs you.");
    expect(notify.mock.calls[0][0]).toContain("Checked: workflow north-star.md, trust-defaults.md, and relevance-filtered prior decisions");
    expect(notify.mock.calls[0][0]).toContain("Coordinator is blocked on a human decision.");
    expect(updated?.status).toBe("waiting_human");
    expect(updated?.stuck_since).toBeNull();
    expect(updated?.tier).toBe(3);
    expect(updated?.last_notified_transition).toMatch(/^blocked:/);
    expect(tmux.sendAndSubmit).not.toHaveBeenCalled();

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
    expect(tmux.sendAndSubmit).not.toHaveBeenCalled();
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
    expect(notify.mock.calls[0][0]).toContain("🛑 BLOCKED · AGJAssist · overmind");
    expect(notify.mock.calls[0][0]).toContain("Tier-3 Sonnet brain failed");
    expect(updated?.status).toBe("waiting_human");
    expect(updated?.tier).toBe(3);
    expect(tmux.sendAndSubmit).not.toHaveBeenCalled();
  });

  it("brain-gates waiting_human workflows and leaves awaiting_decision to decision interception", async () => {
    const waitingPane = "NEEDS-INFO: please confirm the next step.";
    const decisionPane = ["Which option?", "1. Continue", "2. Stop", "Enter to select"].join("\n");
    const waitingWorkflow = registerTier3Workflow(waitingPane);
    // Distinct on-disk run_dir per workflow — register conflict checks enforce one
    // workflow per project tree across coordinator sessions. makeRunDir() also seeds
    // the brain's expected file tree (decisions/, north-star.md, progress.md,
    // callbacks.md), without which completeness fails and decision interception
    // never fires.
    const decisionRunDir = makeRunDir();
    runDirs.push(decisionRunDir);
    const decisionWorkflow = registerAttachedWorkflowFixture(service, {
      label: "decision workflow",
      coordinator_session: "coord-2",
      child_sessions: ["child-2"],
      run_dir: decisionRunDir
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
      nudgeText: "Coordinator: resolve the human-waiting state from north-star context.",
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
    expect(service.get(waitingWorkflow.id)?.tier).toBe(3);
    expect(service.get(decisionWorkflow.id)?.status).toBe("awaiting_decision");
    expect(brain.calls).toHaveLength(1);
    expect(brain.decisionCalls).toHaveLength(1);
    expect(tmux.sendAndSubmit.mock.calls.every((call: [string, string]) => !call[0].startsWith("child-"))).toBe(true);
    expect(tmux.sendAndSubmit).toHaveBeenCalledWith(
      "coord-1",
      "overmind: Coordinator: resolve the human-waiting state from north-star context."
    );
  });
});

class FakeLlm implements LlmProvider {
  readonly messages: ChatMessage[][] = [];
  constructor(private readonly reply: string) {}
  async chat(messages: ChatMessage[]): Promise<string> {
    this.messages.push(messages);
    return this.reply;
  }
}

function registerAllDoneWorkflow(): OvermindWorkflow {
  const runDir = makeRunDir();
  runDirs.push(runDir);
  const workflow = registerAttachedWorkflowFixture(service, {
    label: "projcore lkvc",
    coordinator_session: "coord-1",
    child_sessions: ["child-1"],
    run_dir: runDir,
    current_task: "all batches done — idle"
  });
  service.setTasks(workflow.id, "all batches done — idle", [
    { id: "b1", label: "B1", state: "done" },
    { id: "b2", label: "B2", state: "done" }
  ]);
  return service.get(workflow.id)!;
}

describe("Overmind completion-edge verification (all tasks done, no /complete)", () => {
  it("consults projcore once (Sonnet), records all-done, then auto-completes without re-running Sonnet", async () => {
    registerAllDoneWorkflow();
    const notify = vi.fn(async () => {});
    const brain = new FakeBrain(undefined, undefined, {
      action: "consult",
      consultText: "Overmind: list shows all done — POST /complete if finished, else update it.",
      reason: "Unreported all-done."
    });
    const tmux = makeTmuxMock(
      { "coord-1": QUIET_PANE, "child-1": CHILD_PANE },
      `${QUIET_PANE}\nconsult sent`
    );
    const watcher = new OvermindWatcher(service, tmux, notify, brain);

    await watcher.tick();
    let after = service.getBySession("coord-1");
    expect(after?.status).not.toBe("completed");
    expect(after?.completion_check).toBe("2/2");
    expect(after?.last_notified_transition).toBeNull();
    expect(brain.completionCalls).toHaveLength(1);
    expect(tmux.sendAndSubmit).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();

    // Same all-done signature closes without a second Sonnet call or token spend.
    await watcher.tick();
    after = service.getBySession("coord-1");
    expect(brain.completionCalls).toHaveLength(1);
    expect(tmux.sendAndSubmit).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(after?.status).toBe("completed");
    expect(after?.last_notified_transition).toBe("done:completed");
  });

  it("on a 'working' false-alarm verdict it sends no nudge and keeps monitoring", async () => {
    registerAllDoneWorkflow();
    const brain = new FakeBrain(undefined, undefined, {
      action: "working",
      reason: "Coordinator still actively running the capstone."
    });
    const tmux = makeTmuxMock({ "coord-1": QUIET_PANE, "child-1": CHILD_PANE });
    const watcher = new OvermindWatcher(service, tmux, undefined, brain);

    await watcher.tick();
    expect(brain.completionCalls).toHaveLength(1);
    expect(tmux.sendAndSubmit).not.toHaveBeenCalled();
    expect(service.getBySession("coord-1")?.completion_check).toBe("2/2");
  });

  it("SonnetOvermindBrain.verifyCompletion parses a consult verdict from JSON", async () => {
    const llm = new FakeLlm('{"action":"consult","consult_text":"Confirm + POST /complete.","reason":"unreported"}');
    const brain = new SonnetOvermindBrain(1000, llm);
    const verdict = await brain.verifyCompletion({
      label: "x",
      tasksSummary: "- [done] b1: B1",
      coordinatorPaneTail: "idle",
      progressTail: "done",
      callbacksTail: "done",
      northStar: "ship it",
      priorDecisions: "<none matched>"
    });
    expect(verdict.action).toBe("consult");
    expect(verdict.consultText).toBe("Confirm + POST /complete.");
  });
});
