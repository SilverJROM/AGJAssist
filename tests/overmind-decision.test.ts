import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseService } from "../src/db/database.js";
import {
  BrainVerdict,
  DecisionInput,
  DecisionVerdict,
  OvermindBrain,
  StuckInput
} from "../src/services/overmind-brain.js";
import { OvermindService, OvermindWorkflow } from "../src/services/overmind-service.js";
import {
  FRONTLOAD_CORRECTION_NOTE,
  OvermindWatcher,
  hashPane
} from "../src/services/overmind-watcher.js";
import { TmuxService } from "../src/tmux/tmux-service.js";

const TEST_DB = path.join("data", "test-overmind-decision.sqlite");
const CHILD_PANE = "child pane is quiet";

class FakeDecisionBrain implements OvermindBrain {
  readonly decisionCalls: DecisionInput[] = [];

  constructor(
    private readonly verdict: DecisionVerdict,
    private readonly error?: Error
  ) {}

  async analyzeStuck(_input: StuckInput): Promise<BrainVerdict> {
    return { action: "false-alarm", reason: "not used" };
  }

  async answerDecision(input: DecisionInput): Promise<DecisionVerdict> {
    this.decisionCalls.push(input);
    if (this.error) throw this.error;
    return this.verdict;
  }
}

function cleanupDb(): void {
  for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

function makeRunDir(): string {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "overmind-decision-"));
  fs.mkdirSync(path.join(runDir, "decisions"));
  fs.writeFileSync(
    path.join(runDir, "decisions/targeted-vitest.md"),
    "JROM decision: targeted vitest is the default local test gate for a small overmind batch."
  );
  fs.writeFileSync(path.join(runDir, "north-star.md"), "Use targeted vitest when a batch asks for a test gate.");
  fs.writeFileSync(path.join(runDir, "progress.md"), "progress");
  fs.writeFileSync(path.join(runDir, "callbacks.md"), "callbacks");
  fs.writeFileSync(path.join(runDir, "queue.md"), "queue");
  return runDir;
}

function makeDecisionPane(question: string): string {
  return [
    "projcore asks:",
    question,
    "1. Use targeted vitest",
    "2. Stop and ask JROM",
    "Type something or Enter to select"
  ].join("\n");
}

function makeTmuxMock(panes: Record<string, string>) {
  return {
    capturePane: vi.fn(async (target: string) => panes[target] ?? ""),
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

function registerDecisionWorkflow(decisionPane: string): OvermindWorkflow {
  const runDir = makeRunDir();
  runDirs.push(runDir);
  const workflow = service.register({
    label: "projcore A6b",
    coordinator_session: "coord-1",
    child_sessions: ["child-1"],
    run_dir: runDir
  });
  service.update(workflow.id, {
    status: "working",
    last_pane_hash: hashPane(decisionPane),
    last_activity_at: "2999-01-01T00:00:00.000Z",
    nudge_count: 0,
    tier: 0
  });
  return service.get(workflow.id)!;
}

describe("Overmind decision interception", () => {
  it("answers a north-star-covered safe decision to the coordinator and logs the R16 correction", async () => {
    const decisionPane = makeDecisionPane("Which local test gate should A6b run?");
    const workflow = registerDecisionWorkflow(decisionPane);
    const brain = new FakeDecisionBrain({
      action: "answer",
      answerText: "Use targeted vitest for this batch.",
      reason: "The north-star covers targeted vitest for touched scope."
    });
    const tmux = makeTmuxMock({ "coord-1": decisionPane, "child-1": CHILD_PANE });
    const watcher = new OvermindWatcher(service, tmux, undefined, brain);

    await watcher.tick();
    const updated = service.get(workflow.id)!;
    const correctionLog = fs.readFileSync(
      path.join(workflow.run_dir, "corrections/overmind-decision-corrections.md"),
      "utf-8"
    );

    expect(brain.decisionCalls).toHaveLength(1);
    expect(brain.decisionCalls[0].northStar).toContain("targeted vitest");
    expect(brain.decisionCalls[0].priorDecisions).toContain("targeted vitest");
    expect(tmux.sendCommand).toHaveBeenCalledTimes(2);
    expect(tmux.sendCommand).toHaveBeenNthCalledWith(
      1,
      "coord-1",
      "Use targeted vitest for this batch.",
      true,
      true
    );
    expect(tmux.sendCommand).toHaveBeenNthCalledWith(2, "coord-1", FRONTLOAD_CORRECTION_NOTE, true, true);
    expect(tmux.sendCommand.mock.calls.every((call) => call[0] === "coord-1")).toBe(true);
    expect(updated.status).toBe("awaiting_decision");
    expect(updated.pending_decision).toContain("Which local test gate");
    expect(updated.tier).toBeGreaterThanOrEqual(4);
    expect(correctionLog).toContain("should have been frontloaded (§1.4a)");
    expect(correctionLog).toContain("Verdict: answer");
  });

  it("force-escalates merge to master even when the fake brain returns answer", async () => {
    const decisionPane = makeDecisionPane("Should I merge to master now?");
    const workflow = registerDecisionWorkflow(decisionPane);
    const brain = new FakeDecisionBrain({
      action: "answer",
      answerText: "Yes, merge to master.",
      reason: "Fake brain says answer."
    });
    const notify = vi.fn(async () => {});
    const tmux = makeTmuxMock({ "coord-1": decisionPane, "child-1": CHILD_PANE });
    const watcher = new OvermindWatcher(service, tmux, notify, brain);

    await watcher.tick();
    const updated = service.get(workflow.id)!;

    expect(brain.decisionCalls).toHaveLength(1);
    expect(tmux.sendCommand).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toContain("🚨 URGENT · AGJAssist · overmind");
    expect(notify.mock.calls[0][0]).toContain("Should I merge to master now?");
    expect(notify.mock.calls[0][0]).toContain("ALWAYS_ESCALATE_KEYWORDS");
    expect(updated.status).toBe("awaiting_decision");
    expect(updated.tier).toBeGreaterThanOrEqual(4);
  });

  it("escalates uncovered decisions to JROM and leaves the coordinator waiting", async () => {
    const decisionPane = makeDecisionPane("Which undocumented scope expansion should I accept?");
    const workflow = registerDecisionWorkflow(decisionPane);
    const brain = new FakeDecisionBrain({
      action: "escalate",
      reason: "The north-star does not cover this decision."
    });
    const notify = vi.fn(async () => {});
    const tmux = makeTmuxMock({ "coord-1": decisionPane, "child-1": CHILD_PANE });
    const watcher = new OvermindWatcher(service, tmux, notify, brain);

    await watcher.tick();
    const updated = service.get(workflow.id)!;

    expect(tmux.sendCommand).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toContain("🚨 URGENT · AGJAssist · overmind");
    expect(notify.mock.calls[0][0]).toContain("Which undocumented scope expansion");
    expect(notify.mock.calls[0][0]).toContain("north-star does not cover");
    expect(updated.status).toBe("awaiting_decision");
    expect(updated.pending_decision).toContain("Which undocumented scope expansion");
  });

  it("handles the same awaiting_decision episode once, not on every tick", async () => {
    const decisionPane = makeDecisionPane("Which local test gate should A6b run?");
    registerDecisionWorkflow(decisionPane);
    const brain = new FakeDecisionBrain({
      action: "answer",
      answerText: "Use targeted vitest for this batch.",
      reason: "The north-star covers targeted vitest."
    });
    const tmux = makeTmuxMock({ "coord-1": decisionPane, "child-1": CHILD_PANE });
    const watcher = new OvermindWatcher(service, tmux, undefined, brain);

    await watcher.tick();
    await watcher.tick();

    expect(brain.decisionCalls).toHaveLength(1);
    expect(tmux.sendCommand).toHaveBeenCalledTimes(2);
  });

  it("never sends an auto-answer or correction note to a child session", async () => {
    const decisionPane = makeDecisionPane("Which local test gate should A6b run?");
    registerDecisionWorkflow(decisionPane);
    const brain = new FakeDecisionBrain({
      action: "answer",
      answerText: "Use targeted vitest for this batch.",
      reason: "The north-star covers targeted vitest."
    });
    const tmux = makeTmuxMock({ "coord-1": decisionPane, "child-1": CHILD_PANE });
    const watcher = new OvermindWatcher(service, tmux, undefined, brain);

    await watcher.tick();

    expect(tmux.sendCommand.mock.calls.length).toBeGreaterThan(0);
    expect(tmux.sendCommand.mock.calls.every((call) => call[0] === "coord-1")).toBe(true);
    expect(tmux.sendCommand.mock.calls.some((call) => call[0] === "child-1")).toBe(false);
  });
});
