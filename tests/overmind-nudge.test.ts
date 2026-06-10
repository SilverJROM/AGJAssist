import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseService } from "../src/db/database.js";
import { AuthService } from "../src/auth/auth-service.js";
import { AppConfig } from "../src/config/config.js";
import { registerOvermindRoutes } from "../src/api/routes/overmind-routes.js";
import { OvermindService } from "../src/services/overmind-service.js";
import {
  CANNED_NUDGE,
  OvermindWatcher
} from "../src/services/overmind-watcher.js";
import type { OvermindBrain } from "../src/services/overmind-brain.js";
import { hashPane } from "../src/services/overmind/pane-utils.js";
import { TmuxService } from "../src/tmux/tmux-service.js";
import type { AppSettingsService, OvermindCooldowns } from "../src/services/app-settings-service.js";
import { NudgeStateService } from "../src/services/nudge-state-service.js";
import { registerAttachedWorkflowFixture } from "./overmind-fixtures.js";
import { buildCompletionPrompt } from "../src/services/overmind/completion-detector.js";
import { resetAllConsecutiveDeadCounts } from "../src/services/overmind/parent-nudge-guard.js";

const isAgentPaneMock = vi.hoisted(() => vi.fn());

vi.mock("../src/services/overmind/agent-pane.js", () => ({
  isAgentPane: isAgentPaneMock
}));

const TEST_DB = path.join("data", "test-overmind-nudge.sqlite");
const BOT_TOKEN = "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11";
const JWT_SECRET = "test-secret";
const OVERMIND_TOKEN = "ovm-test-token";
const QUIET_PANE = "same quiet pane";
const NUDGED_PANE = `${QUIET_PANE}\n${CANNED_NUDGE}\n-bash: Overmind:: command not found`;

function cleanup(): void {
  for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

function testConfig(): AppConfig {
  return {
    telegram: {
      botToken: BOT_TOKEN,
      authorizedUserId: 111222,
      testMode: true
    },
    runtime: {
      workspaceRoot: "/tmp",
      allowedCommandPrefixes: [],
      maxToolIterations: 1,
      defaultTimeoutMinutes: 1
    },
    api: {
      port: 0,
      host: "127.0.0.1",
      jwtSecret: JWT_SECRET,
      sessionExpiryHours: 24
    },
    db: {
      path: TEST_DB
    },
    projects: {
      root: "/tmp"
    },
    tmux: {
      historyRetentionDays: 7,
      outputBufferLines: 5000,
      streamIntervalMs: 100
    },
    overmind: {
      token: OVERMIND_TOKEN
    }
  };
}

function makeTmuxMock(panes: Record<string, string>, sessionAlive?: Record<string, boolean>) {
  return {
    capturePane: vi.fn(async (target: string) => panes[target] ?? ""),
    sendCommand: vi.fn(async () => ({ message: "sent", blocked: false })),
    sendAndSubmit: vi.fn(async () => true),
    sessionExists: vi.fn(async (target: string) => sessionAlive?.[target] ?? true)
  } as unknown as TmuxService & {
    capturePane: ReturnType<typeof vi.fn>;
    sendCommand: ReturnType<typeof vi.fn>;
    sendAndSubmit: ReturnType<typeof vi.fn>;
    sessionExists: ReturnType<typeof vi.fn>;
  };
}

let db: DatabaseService;
let service: OvermindService;

beforeEach(() => {
  cleanup();
  isAgentPaneMock.mockReset();
  isAgentPaneMock.mockResolvedValue("codex");
  resetAllConsecutiveDeadCounts();
  // The fixtures use this run_dir; it must exist on disk so the registration-completeness
  // layer treats them as complete and the nudge ladder is exercised in isolation.
  fs.mkdirSync("/tmp/overmind-nudge", { recursive: true });
  db = new DatabaseService(TEST_DB);
  db.ensureOwner(111222);
  service = new OvermindService(db);
});

afterEach(() => {
  db.close();
  cleanup();
});

describe("Overmind watcher nudge ladder", () => {
  it("does NOT nudge a stuck workflow whose monitoring is paused, then resumes nudging", async () => {
    const staleIso = "2000-01-01T00:00:00.000Z";
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "agj-paused-stuck-"));
    const workflow = registerAttachedWorkflowFixture(service, {
      label: "hris",
      coordinator_session: "coord-paused",
      child_sessions: ["child-paused"],
      run_dir: runDir
    });
    try {
      service.update(workflow.id, {
        last_pane_hash: hashPane(QUIET_PANE),
        last_activity_at: staleIso,
        stuck_since: staleIso
      });
      setWorkflowParentUpdate(workflow.id, staleIso);
      service.setMonitoringPaused(workflow.id, true, "jrom");

      const tmux = makeTmuxMock({
        "coord-paused": QUIET_PANE,
        "child-paused": "child quiet pane"
      });
      const watcher = new OvermindWatcher(service, tmux);

      // Paused: status display still refreshes, but NO nudge is sent.
      await watcher.tick();
      let updated = service.get(workflow.id);
      expect(updated?.monitoring_paused).toBe(true);
      expect(updated?.nudge_count).toBe(0);
      expect(tmux.sendAndSubmit).not.toHaveBeenCalled();

      // Resume: the next stuck tick nudges normally.
      service.setMonitoringPaused(workflow.id, false, null);
      setWorkflowParentUpdate(workflow.id, staleIso);
      await watcher.tick();
      updated = service.get(workflow.id);
      expect(updated?.monitoring_paused).toBe(false);
      expect(updated?.nudge_count).toBe(1);
      expect(tmux.sendAndSubmit).toHaveBeenCalledTimes(1);
      expect(tmux.sendAndSubmit).toHaveBeenLastCalledWith("coord-paused", CANNED_NUDGE);
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  });

  it("sends Tier 1 and Tier 2 nudges to the coordinator only, then stops", async () => {
    const staleIso = "2000-01-01T00:00:00.000Z";
    const workflow = registerAttachedWorkflowFixture(service, {
      label: "hris",
      coordinator_session: "coord-1",
      child_sessions: ["child-1"],
      run_dir: "/tmp/overmind-nudge"
    });
    service.update(workflow.id, {
      last_pane_hash: hashPane(QUIET_PANE),
      last_activity_at: staleIso,
      stuck_since: staleIso
    });
    setWorkflowParentUpdate(workflow.id, staleIso);

    const tmux = makeTmuxMock({
      "coord-1": QUIET_PANE,
      "child-1": "child quiet pane"
    });
    const watcher = new OvermindWatcher(service, tmux);

    await watcher.tick();
    let updated = service.get(workflow.id);
    expect(updated?.status).toBe("stuck");
    expect(updated?.nudge_count).toBe(1);
    expect(updated?.tier).toBe(1);
    expect(tmux.sendAndSubmit).toHaveBeenCalledTimes(1);
    expect(tmux.sendAndSubmit).toHaveBeenLastCalledWith("coord-1", CANNED_NUDGE);

    await watcher.tick();
    updated = service.get(workflow.id);
    expect(updated?.nudge_count).toBe(2);
    expect(updated?.tier).toBe(2);
    expect(tmux.sendAndSubmit).toHaveBeenCalledTimes(2);
    expect(tmux.sendAndSubmit).toHaveBeenLastCalledWith("coord-1", CANNED_NUDGE);

    await watcher.tick();
    updated = service.get(workflow.id);
    expect(updated?.nudge_count).toBe(2);
    expect(updated?.tier).toBe(2);
    expect(tmux.sendAndSubmit).toHaveBeenCalledTimes(2);
    expect(tmux.sendAndSubmit.mock.calls.every((call: [string, string]) => call[0] === "coord-1")).toBe(true);
  });

  it("nudges the live owner once for an all-done run and never auto-completes it", async () => {
    const notify = vi.fn(async () => {});
    const workflow = registerAttachedWorkflowFixture(service, {
      label: "lkvc",
      coordinator_session: "coord-done",
      child_sessions: ["child-done"],
      run_dir: "/tmp/overmind-nudge"
    });
    service.setTasks(workflow.id, "all batches done — idle", [
      { id: "b1", label: "B1", state: "done" },
      { id: "b2", label: "B2", state: "done" }
    ]);

    // Pane keeps churning (idle recap chatter) — same hash each tick (no real activity).
    const tmux = makeTmuxMock({
      "coord-done": "✻ Cooked for 2m · recap: queue empty",
      "child-done": "child idle"
    });
    const watcher = new OvermindWatcher(service, tmux, notify);

    await watcher.tick();
    let updated = service.get(workflow.id);
    // R3: status is "stuck" after sending the proven completion prompt.
    expect(updated?.status).toBe("stuck");
    expect(updated?.completion_check).toBe("2/2");
    // R3: completion_nudge_count incremented to 1 after first nudge.
    expect(updated?.completion_nudge_count).toBe(1);
    expect(updated?.orphaned).toBe(false);
    expect(updated?.last_notified_transition).toBeNull();
    expect(tmux.sendAndSubmit).toHaveBeenCalledTimes(1);
    expect(tmux.sendAndSubmit.mock.calls[0][0]).toBe("coord-done");
    // R3: proven completion prompt must name the run label + the exact overmind.sh command.
    expect(tmux.sendAndSubmit.mock.calls[0][1]).toContain('"lkvc"');
    expect(tmux.sendAndSubmit.mock.calls[0][1]).toContain("overmind.sh complete --run-dir");
    expect(tmux.sendAndSubmit.mock.calls[0][1]).toContain("2/2 tasks DONE but is");
    expect(notify).not.toHaveBeenCalled();

    // R1: second tick within cooldown — no additional nudge sent (cooldown gate).
    await watcher.tick();
    updated = service.get(workflow.id);
    // OVM never auto-completes — status stays stuck, not "completed".
    expect(updated?.status).toBe("stuck");
    expect(updated?.ended_at).not.toBeNull();
    expect(updated?.last_notified_transition).toBeNull();
    expect(tmux.sendAndSubmit).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
  });

  it("keeps all-done workflows parked without per-tick nudge spam once the ladder is exhausted", async () => {
    const notify = vi.fn(async () => {});
    const workflow = registerAttachedWorkflowFixture(service, {
      label: "parked-done",
      coordinator_session: "coord-parked-done",
      child_sessions: ["child-parked-done"],
      run_dir: "/tmp/overmind-nudge"
    });
    service.setTasks(workflow.id, "all batches done — parked", [
      { id: "b1", label: "B1", state: "done" },
      { id: "b2", label: "B2", state: "done" }
    ]);
    // Simulate ladder exhausted: completion_nudge_count = MAX_COMPLETION_NUDGES (4).
    // Set completion_nudge_last_at to NOW so the hourly backoff gate is within cooldown.
    service.update(workflow.id, {
      status: "stuck",
      completion_check: "2/2",
      stuck_since: "2000-01-01T00:00:00.000Z",
      completion_nudge_count: 4,
      completion_nudge_last_at: new Date().toISOString()
    });

    const tmux = makeTmuxMock({
      "coord-parked-done": "still parked after all tasks done",
      "child-parked-done": "child idle"
    });
    const watcher = new OvermindWatcher(service, tmux, notify);

    await watcher.tick();
    const updated = service.get(workflow.id);
    // R5: run stays visible (not auto-completed), not orphaned.
    expect(updated?.status).toBe("stuck");
    expect(updated?.completion_nudge_count).toBe(4);
    expect(updated?.orphaned).toBe(false);
    expect(updated?.last_notified_transition).toBeNull();
    expect(tmux.sendAndSubmit).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();

    await watcher.tick();
    expect(tmux.sendAndSubmit).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("marks all-done runs orphaned when the parent and children are dead, without nudging or completing", async () => {
    const notify = vi.fn(async () => {});
    const workflow = registerAttachedWorkflowFixture(service, {
      label: "dead-owner-done",
      coordinator_session: "coord-dead-done",
      child_sessions: ["child-dead-done"],
      run_dir: "/tmp/overmind-nudge"
    });
    service.setTasks(workflow.id, "all batches done — owner gone", [
      { id: "b1", label: "B1", state: "done" },
      { id: "b2", label: "B2", state: "done" }
    ]);

    const tmux = makeTmuxMock(
      {
        "coord-dead-done": "",
        "child-dead-done": ""
      },
      {
        "coord-dead-done": false,
        "child-dead-done": false
      }
    );
    const watcher = new OvermindWatcher(service, tmux, notify);

    await watcher.tick();
    const updated = service.get(workflow.id);
    expect(updated?.status).not.toBe("completed");
    expect(updated?.orphaned).toBe(true);
    expect(updated?.parent_status).toBe("no-session");
    expect(updated?.completion_check).toBe("2/2");
    expect(tmux.sendAndSubmit).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("clears orphaned when the parent session becomes alive again", async () => {
    const workflow = registerAttachedWorkflowFixture(service, {
      label: "orphan-recovers",
      coordinator_session: "coord-recovers",
      child_sessions: ["child-recovers"],
      run_dir: "/tmp/overmind-nudge"
    });
    service.update(workflow.id, {
      orphaned: true,
      parent_status: "no-session",
      status: "stuck"
    });

    const tmux = makeTmuxMock(
      {
        "coord-recovers": "owner resumed",
        "child-recovers": ""
      },
      {
        "coord-recovers": true,
        "child-recovers": false
      }
    );
    const watcher = new OvermindWatcher(service, tmux);

    await watcher.tick();
    const updated = service.get(workflow.id);
    expect(updated?.orphaned).toBe(false);
    expect(updated?.parent_status).not.toBe("no-session");
  });

  it("all-done run: first tick with pane change → 'working' (observed activity); second tick static pane → completion prompt sent", async () => {
    const notify = vi.fn(async () => {});
    const workflow = registerAttachedWorkflowFixture(service, {
      label: "parked-working",
      coordinator_session: "coord-parked-working",
      child_sessions: ["child-parked-working"],
      run_dir: "/tmp/overmind-nudge"
    });
    service.setTasks(workflow.id, "all batches done but more work confirmed", [
      { id: "b1", label: "B1", state: "done" },
      { id: "b2", label: "B2", state: "done" }
    ]);
    service.update(workflow.id, {
      status: "working",
      completion_check: "2/2",
      last_pane_hash: hashPane("previous coordinator pane"),
      stuck_since: "2000-01-01T00:00:00.000Z",
      nudge_count: 1,
      tier: 1
    });

    const tmux = makeTmuxMock({
      "coord-parked-working": "flapping idle prompt redraw",
      "child-parked-working": "child idle"
    });
    const watcher = new OvermindWatcher(service, tmux, notify);

    // Tick 1: pane changed (different hash) → observed activity → accept "working", no nudge.
    await watcher.tick();
    let updated = service.get(workflow.id);
    expect(updated?.status).toBe("working");
    expect(updated?.stuck_since).toBeNull();
    expect(updated?.nudge_count).toBe(0);
    expect(updated?.tier).toBe(0);
    expect(updated?.orphaned).toBe(false);
    expect(updated?.last_notified_transition).toBeNull();
    expect(tmux.sendAndSubmit).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();

    // Tick 2: pane is now static (same hash), no observed activity, no brain.
    // No brain → falls through to completion prompt ladder → status = "stuck" + prompt sent.
    await watcher.tick();
    updated = service.get(workflow.id);
    expect(updated?.status).toBe("stuck");
    expect(updated?.completion_nudge_count).toBe(1);
    expect(tmux.sendAndSubmit).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
    // OVM must never auto-complete.
    expect(updated?.status).not.toBe("completed");
  });

  it("keeps all-done workflows visible even when subagentInFlight is set", async () => {
    const notify = vi.fn(async () => {});
    const workflow = registerAttachedWorkflowFixture(service, {
      label: "subagent-all-done",
      coordinator_session: "coord-subagent-done",
      child_sessions: ["child-subagent-done"],
      run_dir: "/tmp/overmind-nudge"
    });
    service.setTasks(workflow.id, "all batches done with old subagent marker", [
      { id: "b1", label: "B1", state: "done" },
      { id: "b2", label: "B2", state: "done" }
    ]);
    service.update(workflow.id, {
      status: "working",
      completion_check: "2/2"
    });

    const tmux = makeTmuxMock({
      "coord-subagent-done": "[OVERMIND] subagent lead ~30min\nidle prompt",
      "child-subagent-done": "child idle"
    });
    const watcher = new OvermindWatcher(service, tmux, notify);

    await watcher.tick();
    const updated = service.get(workflow.id);
    expect(updated?.status).toBe("working");
    expect(updated?.last_notified_transition).toBeNull();
    expect(tmux.sendAndSubmit).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("keeps subagentInFlight workflows with remaining tasks working", async () => {
    const notify = vi.fn(async () => {});
    const workflow = registerAttachedWorkflowFixture(service, {
      label: "subagent-remaining",
      coordinator_session: "coord-subagent-remaining",
      child_sessions: ["child-subagent-remaining"],
      run_dir: "/tmp/overmind-nudge",
      tasks: [
        { id: "b1", label: "B1", state: "done" },
        { id: "b2", label: "B2", state: "processing" }
      ]
    });

    const tmux = makeTmuxMock({
      "coord-subagent-remaining": "[OVERMIND] subagent lead ~30min\nidle prompt",
      "child-subagent-remaining": "child idle"
    });
    const watcher = new OvermindWatcher(service, tmux, notify);

    await watcher.tick();
    const updated = service.get(workflow.id);
    expect(updated?.status).toBe("working");
    expect(updated?.last_notified_transition).toBeNull();
    expect(updated?.completion_check).toBeNull();
    expect(tmux.sendAndSubmit).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("keeps brain-working all-done workflows active without auto-completing on later ticks", async () => {
    const workflow = registerAttachedWorkflowFixture(service, {
      label: "lkvc",
      coordinator_session: "coord-working",
      child_sessions: ["child-working"],
      run_dir: "/tmp/overmind-nudge"
    });
    service.setTasks(workflow.id, "all batches done but follow-up in progress", [
      { id: "b1", label: "B1", state: "done" },
      { id: "b2", label: "B2", state: "done" }
    ]);

    const tmux = makeTmuxMock({
      "coord-working": "Running post-completion verification",
      "child-working": "child idle"
    });
    const notify = vi.fn(async () => {});
    const brain = {
      verifyCompletion: vi.fn(async () => ({
        action: "working",
        reason: "Coordinator is still performing verification."
      }))
    } as unknown as OvermindBrain;
    const watcher = new OvermindWatcher(service, tmux, notify, brain);

    await watcher.tick();

    const updated = service.get(workflow.id);
    expect(updated?.status).toBe("working");
    expect(updated?.last_notified_transition).toBeNull();
    expect(updated?.completion_check).toBe("2/2");
    expect(tmux.sendAndSubmit).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();

    await watcher.tick();
    const stillWorking = service.get(workflow.id);
    expect(stillWorking?.status).toBe("working");
    expect(stillWorking?.last_notified_transition).toBeNull();
    expect(tmux.sendAndSubmit).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("resets nudge count and tier when the workflow returns to working", async () => {
    const workflow = registerAttachedWorkflowFixture(service, {
      label: "lkcamp",
      coordinator_session: "coord-2",
      child_sessions: ["child-2"],
      run_dir: "/tmp/overmind-nudge"
    });
    service.update(workflow.id, {
      last_pane_hash: hashPane("previous pane"),
      stuck_since: "2000-01-01T00:00:00.000Z",
      nudge_count: 2,
      tier: 2
    });

    const tmux = makeTmuxMock({
      "coord-2": "new coordinator output",
      "child-2": "child quiet pane"
    });
    const watcher = new OvermindWatcher(service, tmux);

    await watcher.tick();

    const updated = service.get(workflow.id);
    expect(updated?.status).toBe("working");
    expect(updated?.stuck_since).toBeNull();
    expect(updated?.nudge_count).toBe(0);
    expect(updated?.tier).toBe(0);
    expect(tmux.sendAndSubmit).not.toHaveBeenCalled();
  });

  it("persists parent active-session attribution when the coordinator pane is busy", async () => {
    const workflow = registerAttachedWorkflowFixture(service, {
      label: "parent-active",
      coordinator_session: "coord-parent",
      child_sessions: ["child-parent"],
      run_dir: "/tmp/overmind-nudge"
    });

    const tmux = makeTmuxMock({
      "coord-parent": "Working (4s)\nesc to interrupt",
      "child-parent": "child quiet pane"
    });
    const watcher = new OvermindWatcher(service, tmux);

    await watcher.tick();

    const updated = service.get(workflow.id);
    expect(updated?.active_session).toBe("coord-parent");
    expect(updated?.active_role).toBe("parent");
    expect(updated?.status).toBe("working");
  });

  it("persists child active-session attribution when only a child pane is busy", async () => {
    const workflow = registerAttachedWorkflowFixture(service, {
      label: "child-active",
      coordinator_session: "coord-child",
      child_sessions: ["child-a", "child-b"],
      run_dir: "/tmp/overmind-nudge"
    });

    const tmux = makeTmuxMock({
      "coord-child": "coordinator idle",
      "child-a": "child quiet pane",
      "child-b": "Thinking\nesc to interrupt"
    });
    const watcher = new OvermindWatcher(service, tmux);

    await watcher.tick();

    const updated = service.get(workflow.id);
    expect(updated?.active_session).toBe("child-b");
    expect(updated?.active_role).toBe("child");
    expect(updated?.status).toBe("working");
  });

  it("persists null active-session attribution when no pane is busy", async () => {
    const workflow = registerAttachedWorkflowFixture(service, {
      label: "none-active",
      coordinator_session: "coord-none",
      child_sessions: ["child-none"],
      run_dir: "/tmp/overmind-nudge"
    });
    service.update(workflow.id, {
      active_session: "child-none",
      active_role: "child",
      last_pane_hash: hashPane("coordinator idle")
    });

    const tmux = makeTmuxMock({
      "coord-none": "coordinator idle",
      "child-none": "child quiet pane"
    });
    const watcher = new OvermindWatcher(service, tmux);

    await watcher.tick();

    const updated = service.get(workflow.id);
    expect(updated?.active_session).toBeNull();
    expect(updated?.active_role).toBeNull();
    expect(updated?.status).toBe("working");
  });

  it("nudges a frozen coordinator with stale Waiting for recap text after the stuck threshold", async () => {
    const staleIso = "2000-01-01T00:00:00.000Z";
    const staleWaitingPane = [
      "Recap:",
      "Waiting for codex proposal review from earlier.",
      "Composer is empty."
    ].join("\n");
    const workflow = registerAttachedWorkflowFixture(service, {
      label: "lkcamp",
      coordinator_session: "coord-lkcamp",
      child_sessions: ["child-lkcamp"],
      run_dir: "/tmp/overmind-nudge"
    });
    service.update(workflow.id, {
      last_pane_hash: hashPane(staleWaitingPane),
      last_activity_at: staleIso,
      stuck_since: staleIso
    });
    setWorkflowParentUpdate(workflow.id, staleIso);

    const tmux = makeTmuxMock({
      "coord-lkcamp": staleWaitingPane,
      "child-lkcamp": "child quiet pane"
    });
    const watcher = new OvermindWatcher(service, tmux);

    await watcher.tick();

    const updated = service.get(workflow.id);
    expect(updated?.status).toBe("stuck");
    expect(updated?.nudge_count).toBe(1);
    expect(updated?.tier).toBe(1);
    expect(tmux.sendAndSubmit).toHaveBeenCalledTimes(1);
    expect(tmux.sendAndSubmit).toHaveBeenLastCalledWith("coord-lkcamp", CANNED_NUDGE);
  });

  it("treats Overmind's own nudge text as the stuck baseline so the next tick escalates", async () => {
    const staleIso = "2000-01-01T00:00:00.000Z";
    const workflow = registerAttachedWorkflowFixture(service, {
      label: "self-nudge",
      coordinator_session: "coord-4",
      child_sessions: ["child-4"],
      run_dir: "/tmp/overmind-nudge"
    });
    service.update(workflow.id, {
      last_pane_hash: hashPane(QUIET_PANE),
      last_activity_at: staleIso,
      stuck_since: staleIso
    });
    setWorkflowParentUpdate(workflow.id, staleIso);

    let coordinatorCaptures = 0;
    const tmux = {
      capturePane: vi.fn(async (target: string) => {
        if (target === "child-4") return "child quiet pane";
        coordinatorCaptures += 1;
        if (coordinatorCaptures === 1) return QUIET_PANE;
        return NUDGED_PANE;
      }),
      sendCommand: vi.fn(async () => ({ message: "sent", blocked: false })),
      sendAndSubmit: vi.fn(async () => true)
    } as unknown as TmuxService & {
      capturePane: ReturnType<typeof vi.fn>;
      sendCommand: ReturnType<typeof vi.fn>;
      sendAndSubmit: ReturnType<typeof vi.fn>;
    };
    const watcher = new OvermindWatcher(service, tmux);

    await watcher.tick();
    let updated = service.get(workflow.id);
    expect(updated?.status).toBe("stuck");
    expect(updated?.stuck_since).toBe("2000-01-01T00:00:00.000Z");
    expect(updated?.nudge_count).toBe(1);
    expect(updated?.tier).toBe(1);
    expect(updated?.last_pane_hash).toBe(hashPane(NUDGED_PANE));

    await watcher.tick();
    updated = service.get(workflow.id);
    expect(updated?.status).toBe("stuck");
    expect(updated?.stuck_since).toBe("2000-01-01T00:00:00.000Z");
    expect(updated?.nudge_count).toBe(2);
    expect(updated?.tier).toBe(2);
    expect(tmux.sendAndSubmit).toHaveBeenCalledTimes(2);
    expect(tmux.sendAndSubmit.mock.calls.every((call: [string, string]) => call[0] === "coord-4")).toBe(true);
  });
});

// ─── Idle-nudge cooldown tests ───────────────────────────────────────────────

function makeSettingsStub(
  stuck_nudge_cooldown_minutes: number,
  unified_idle_threshold_minutes = 30,
  evidence_read_cadence_minutes = 3
): AppSettingsService {
  return {
    get: () => ({
      stuck_nudge_cooldown_minutes,
      evidence_read_cadence_minutes,
      unified_idle_threshold_minutes
    } satisfies OvermindCooldowns),
    load: async () => {},
    setOvermindCooldown: async () => {}
  } as unknown as AppSettingsService;
}

function setWorkflowParentUpdate(workflowId: number, iso: string): void {
  db.prepare("UPDATE overmind_workflows SET last_parent_update_at = ? WHERE id = ?").run(iso, workflowId);
}

describe("Idle-nudge cooldown", () => {
  it("sends ONE nudge on first stuck tick, then skips the second tick within cooldown (nudge_count unchanged)", async () => {
    const staleIso = "2000-01-01T00:00:00.000Z";
    const workflow = registerAttachedWorkflowFixture(service, {
      label: "cooldown-test",
      coordinator_session: "coord-cd",
      child_sessions: ["child-cd"],
      run_dir: "/tmp/overmind-nudge"
    });
    service.update(workflow.id, {
      last_pane_hash: hashPane(QUIET_PANE),
      last_activity_at: staleIso,
      stuck_since: staleIso
    });
    setWorkflowParentUpdate(workflow.id, staleIso);

    const tmux = makeTmuxMock({ "coord-cd": QUIET_PANE, "child-cd": "child quiet pane" });
    // 20-minute cooldown (default).
    const watcher = new OvermindWatcher(service, tmux, undefined, undefined, undefined, makeSettingsStub(20));

    // Tick 1: first nudge should go out.
    await watcher.tick();
    let updated = service.get(workflow.id);
    expect(updated?.nudge_count).toBe(1);
    expect(tmux.sendAndSubmit).toHaveBeenCalledTimes(1);
    expect(tmux.sendAndSubmit).toHaveBeenLastCalledWith("coord-cd", CANNED_NUDGE);

    // Tick 2: 1 minute later — still within the 20-min cooldown.
    // Simulate time passing: override the shared unified idle cooldown to 1 min ago.
    (watcher as any).cooldowns.recordFired(workflow.id, "unified_idle_nudge", Date.now() - 1 * 60 * 1000);

    await watcher.tick();
    updated = service.get(workflow.id);
    // nudge_count must NOT increment — cooldown suppressed the send.
    expect(updated?.nudge_count).toBe(1);
    expect(tmux.sendAndSubmit).toHaveBeenCalledTimes(1); // no additional send
  });

  it("sends a second nudge once the cooldown window has elapsed", async () => {
    const staleIso = "2000-01-01T00:00:00.000Z";
    const workflow = registerAttachedWorkflowFixture(service, {
      label: "cooldown-expire",
      coordinator_session: "coord-ce",
      child_sessions: ["child-ce"],
      run_dir: "/tmp/overmind-nudge"
    });
    service.update(workflow.id, {
      last_pane_hash: hashPane(QUIET_PANE),
      last_activity_at: staleIso,
      stuck_since: staleIso
    });
    setWorkflowParentUpdate(workflow.id, staleIso);

    const tmux = makeTmuxMock({ "coord-ce": QUIET_PANE, "child-ce": "child quiet pane" });
    // 5-minute cooldown so we can easily "expire" it without waiting.
    const watcher = new OvermindWatcher(service, tmux, undefined, undefined, undefined, makeSettingsStub(5));

    // Tick 1: sends the first nudge.
    await watcher.tick();
    expect(service.get(workflow.id)?.nudge_count).toBe(1);
    expect(tmux.sendAndSubmit).toHaveBeenCalledTimes(1);

    // Simulate last nudge was sent 6 minutes ago — cooldown expired.
    (watcher as any).cooldowns.recordFired(workflow.id, "unified_idle_nudge", Date.now() - 6 * 60 * 1000);

    // Tick 2: cooldown expired → second nudge goes out.
    await watcher.tick();
    expect(service.get(workflow.id)?.nudge_count).toBe(2);
    expect(tmux.sendAndSubmit).toHaveBeenCalledTimes(2);
  });
});

describe("All-sessions idle nudge", () => {
  it("fires the unified all-idle message after the apparent-idle grace without incrementing nudge_count", async () => {
    const staleIso = new Date(Date.now() - 90 * 60 * 1000).toISOString();
    const workflow = registerAttachedWorkflowFixture(service, {
      label: "path2-idle",
      coordinator_session: "coord-path2",
      child_sessions: ["child-path2"],
      run_dir: "/tmp/overmind-nudge"
    });
    service.update(workflow.id, {
      last_pane_hash: hashPane(QUIET_PANE),
      last_activity_at: staleIso
    });
    setWorkflowParentUpdate(workflow.id, staleIso);

    const tmux = makeTmuxMock({
      "coord-path2": QUIET_PANE,
      "child-path2": "child quiet pane"
    });
    const watcher = new OvermindWatcher(service, tmux, undefined, undefined, undefined, makeSettingsStub(20));
    (watcher as any).apparentIdleSince.set(workflow.id, Date.now() - 11 * 60 * 1000);

    await watcher.tick();

    const updated = service.get(workflow.id);
    expect(updated?.nudge_count).toBe(0);
    expect(tmux.sendAndSubmit).toHaveBeenCalledTimes(1);
    expect(tmux.sendAndSubmit.mock.calls[0][1]).toContain("all sessions appear idle");
    expect(tmux.sendAndSubmit.mock.calls[0][1]).toContain("[OVERMIND] subagent <name> ~<N>min");
  });

  it("does not fire when the coordinator is static but a registered child is busy", async () => {
    const staleIso = new Date(Date.now() - 90 * 60 * 1000).toISOString();
    const workflow = registerAttachedWorkflowFixture(service, {
      label: "path2-child-busy",
      coordinator_session: "coord-child-busy",
      child_sessions: ["child-busy"],
      run_dir: "/tmp/overmind-nudge"
    });
    service.update(workflow.id, {
      last_pane_hash: hashPane(QUIET_PANE),
      last_activity_at: staleIso,
      stuck_since: staleIso
    });
    setWorkflowParentUpdate(workflow.id, staleIso);

    const tmux = makeTmuxMock({
      "coord-child-busy": QUIET_PANE,
      "child-busy": "Working (9s)\nesc to interrupt"
    });
    const watcher = new OvermindWatcher(service, tmux, undefined, undefined, undefined, makeSettingsStub(20));
    (watcher as any).apparentIdleSince.set(workflow.id, Date.now() - 11 * 60 * 1000);

    await watcher.tick();

    const updated = service.get(workflow.id);
    expect(updated?.status).toBe("working");
    expect(updated?.stuck_since).toBeNull();
    expect(updated?.child_statuses).toEqual([{ session: "child-busy", status: "working" }]);
    expect(tmux.sendAndSubmit).not.toHaveBeenCalled();
  });

  it("does not fire when tracked artifacts are fresh within the idle threshold", async () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "agj-path2-fresh-progress-"));
    const staleIso = new Date(Date.now() - 90 * 60 * 1000).toISOString();
    try {
      fs.writeFileSync(path.join(runDir, "progress.md"), "B9c still running\n");
      const workflow = registerAttachedWorkflowFixture(service, {
        label: "path2-fresh-progress",
        coordinator_session: "coord-fresh-progress",
        child_sessions: ["child-fresh-progress"],
        run_dir: runDir
      });
      service.update(workflow.id, {
        last_pane_hash: hashPane(QUIET_PANE),
        last_activity_at: staleIso,
        stuck_since: staleIso
      });
      setWorkflowParentUpdate(workflow.id, staleIso);

      const tmux = makeTmuxMock({
        "coord-fresh-progress": QUIET_PANE,
        "child-fresh-progress": "child quiet pane"
      });
      const watcher = new OvermindWatcher(service, tmux, undefined, undefined, undefined, makeSettingsStub(20, 45));
      (watcher as any).apparentIdleSince.set(workflow.id, Date.now() - 11 * 60 * 1000);

      await watcher.tick();

      const updated = service.get(workflow.id);
      expect(updated?.status).toBe("working");
      expect(updated?.stuck_since).toBeNull();
      expect(tmux.sendAndSubmit).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  });

  it("does not fire within the shared cooldown after a stuck nudge", async () => {
    const staleIso = "2000-01-01T00:00:00.000Z";
    const workflow = registerAttachedWorkflowFixture(service, {
      label: "path1-blocks-path2",
      coordinator_session: "coord-path12",
      child_sessions: ["child-path12"],
      run_dir: "/tmp/overmind-nudge"
    });
    service.update(workflow.id, {
      last_pane_hash: hashPane(QUIET_PANE),
      last_activity_at: staleIso,
      stuck_since: staleIso
    });
    setWorkflowParentUpdate(workflow.id, staleIso);

    const tmux = makeTmuxMock({
      "coord-path12": QUIET_PANE,
      "child-path12": "child quiet pane"
    });
    const watcher = new OvermindWatcher(service, tmux, undefined, undefined, undefined, makeSettingsStub(20));

    await watcher.tick();
    expect(service.get(workflow.id)?.nudge_count).toBe(1);
    expect(tmux.sendAndSubmit).toHaveBeenCalledTimes(1);
    expect(tmux.sendAndSubmit.mock.calls[0][1]).toBe(CANNED_NUDGE);

    (watcher as any).apparentIdleSince.set(workflow.id, Date.now() - 11 * 60 * 1000);
    await watcher.tick();

    expect(service.get(workflow.id)?.nudge_count).toBe(1);
    expect(tmux.sendAndSubmit).toHaveBeenCalledTimes(1);
  });
});

describe("Artifact fail-safe idle nudge", () => {
  const ARTIFACT_FAILSAFE_TEXT = "no tracked artifact has advanced";

  function setLastParentUpdate(workflowId: number, iso: string): void {
    db.prepare("UPDATE overmind_workflows SET last_parent_update_at = ? WHERE id = ?").run(iso, workflowId);
  }

  it("fires despite a working pane when tracked artifacts are older than the effective threshold", async () => {
    const staleIso = new Date(Date.now() - 70 * 60 * 1000).toISOString();
    const workflow = registerAttachedWorkflowFixture(service, {
      label: "ask-update-once",
      coordinator_session: "coord-ask-once",
      child_sessions: ["child-ask-once"],
      child_roles: ["coder"],
      run_dir: "/tmp/overmind-nudge",
      current_task: "A1",
      tasks: [{ id: "A1", label: "Work", state: "processing" }]
    });
    service.update(workflow.id, {
      last_pane_hash: hashPane("old coordinator pane"),
      last_activity_at: staleIso
    });
    setLastParentUpdate(workflow.id, staleIso);

    const tmux = makeTmuxMock({
      "coord-ask-once": "new coordinator pane output",
      "child-ask-once": "child quiet pane"
    });
    const watcher = new OvermindWatcher(service, tmux, undefined, undefined, undefined, makeSettingsStub(20, 45));

    await watcher.tick();
    const askCalls = tmux.sendAndSubmit.mock.calls.filter((call: [string, string]) => call[1].includes(ARTIFACT_FAILSAFE_TEXT));
    expect(askCalls).toHaveLength(1);
    expect(askCalls[0][0]).toBe("coord-ask-once");
  });

  it("re-arms once the in-memory cooldown elapses", async () => {
    const staleIso = new Date(Date.now() - 90 * 60 * 1000).toISOString();
    const workflow = registerAttachedWorkflowFixture(service, {
      label: "ask-update-rearm",
      coordinator_session: "coord-ask-rearm",
      child_sessions: ["child-ask-rearm"],
      child_roles: ["coder"],
      run_dir: "/tmp/overmind-nudge",
      current_task: "A1",
      tasks: [{ id: "A1", label: "Work", state: "processing" }]
    });
    service.update(workflow.id, {
      last_pane_hash: hashPane("old rearm pane"),
      last_activity_at: staleIso
    });
    setLastParentUpdate(workflow.id, staleIso);

    const tmux = makeTmuxMock({
      "coord-ask-rearm": "new rearm pane output",
      "child-ask-rearm": "child quiet pane"
    });
    const watcher = new OvermindWatcher(service, tmux, undefined, undefined, undefined, makeSettingsStub(20, 10));

    await watcher.tick();
    expect(tmux.sendAndSubmit.mock.calls.filter((call: [string, string]) => call[1].includes(ARTIFACT_FAILSAFE_TEXT))).toHaveLength(1);

    await watcher.tick();
    expect(tmux.sendAndSubmit.mock.calls.filter((call: [string, string]) => call[1].includes(ARTIFACT_FAILSAFE_TEXT))).toHaveLength(1);

    (watcher as any).cooldowns.recordFired(workflow.id, "unified_idle_nudge", Date.now() - 11 * 60 * 1000);
    service.update(workflow.id, { last_activity_at: staleIso });
    await watcher.tick();
    expect(tmux.sendAndSubmit.mock.calls.filter((call: [string, string]) => call[1].includes(ARTIFACT_FAILSAFE_TEXT))).toHaveLength(2);
  });

  it("respects per-workflow override (override cooldown beats system default)", async () => {
    const staleIso = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const workflow = registerAttachedWorkflowFixture(service, {
      label: "ask-update-override",
      coordinator_session: "coord-ask-override",
      child_sessions: ["child-ask-override"],
      child_roles: ["coder"],
      run_dir: "/tmp/overmind-nudge",
      current_task: "A1",
      tasks: [{ id: "A1", label: "Work", state: "processing" }]
    });
    service.update(workflow.id, {
      last_pane_hash: hashPane("old override pane"),
      last_activity_at: staleIso
    });
    service.setEvidenceIdleThresholdOverride(workflow.id, 5);
    setLastParentUpdate(workflow.id, staleIso);

    const tmux = makeTmuxMock({
      "coord-ask-override": "new override pane output",
      "child-ask-override": "child quiet pane"
    });
    const watcher = new OvermindWatcher(service, tmux, undefined, undefined, undefined, makeSettingsStub(20, 45));

    await watcher.tick();
    const askCalls = tmux.sendAndSubmit.mock.calls.filter((call: [string, string]) => call[1].includes(ARTIFACT_FAILSAFE_TEXT));
    expect(askCalls).toHaveLength(1);
    expect(askCalls[0][0]).toBe("coord-ask-override");
  });

  it("does NOT fire for paused or terminal workflows", async () => {
    fs.mkdirSync("/tmp/overmind-nudge/paused", { recursive: true });
    fs.mkdirSync("/tmp/overmind-nudge/completed", { recursive: true });

    const pausedWorkflow = registerAttachedWorkflowFixture(service, {
      label: "ask-update-paused",
      coordinator_session: "coord-ask-paused",
      child_sessions: ["child-ask-paused"],
      child_roles: ["coder"],
      run_dir: "/tmp/overmind-nudge/paused"
    });
    service.update(pausedWorkflow.id, { last_pane_hash: hashPane("old paused pane") });
    service.setMonitoringPaused(pausedWorkflow.id, true, "jrom");
    setLastParentUpdate(pausedWorkflow.id, new Date(Date.now() - 90 * 60 * 1000).toISOString());

    const completedWorkflow = registerAttachedWorkflowFixture(service, {
      label: "ask-update-completed",
      coordinator_session: "coord-ask-completed",
      child_sessions: ["child-ask-completed"],
      child_roles: ["coder"],
      run_dir: "/tmp/overmind-nudge/completed"
    });
    service.update(completedWorkflow.id, { last_pane_hash: hashPane("old completed pane") });
    service.setStatus(completedWorkflow.id, "completed");
    setLastParentUpdate(completedWorkflow.id, new Date(Date.now() - 90 * 60 * 1000).toISOString());

    const tmux = makeTmuxMock({
      "coord-ask-paused": "quiet paused pane",
      "child-ask-paused": "child quiet pane",
      "coord-ask-completed": "quiet completed pane",
      "child-ask-completed": "child quiet pane"
    });
    const watcher = new OvermindWatcher(service, tmux, undefined, undefined, undefined, makeSettingsStub(20, 10));

    await watcher.tick();
    expect(tmux.sendAndSubmit.mock.calls.filter((call: [string, string]) => call[1].includes(ARTIFACT_FAILSAFE_TEXT))).toHaveLength(0);
  });

  // ── JROM 2026-05-24 v2: MAX-of-three freshness + new message text ──────────

  it("MAX-of-three: progress.md mtime recent → no nag even when last_parent_update_at is stale", async () => {
    // Set up a real run_dir with a freshly-written progress.md
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "agj-nudge-v2-progress-"));
    fs.writeFileSync(path.join(runDir, "progress.md"), "B1 done — fresh\n");
    try {
      const workflow = registerAttachedWorkflowFixture(service, {
        label: "v2-progress-fresh",
        coordinator_session: "coord-v2-pf",
        child_sessions: ["child-v2-pf"],
        child_roles: ["coder"],
        run_dir: runDir,
        current_task: "B1",
        tasks: [{ id: "B1", label: "Work", state: "processing" }]
      });
      service.update(workflow.id, {
        last_pane_hash: hashPane("old pane"),
        last_activity_at: new Date(Date.now() - 90 * 60 * 1000).toISOString()
      });
      // last_parent_update_at = 90min ago (stale by itself), but progress.md was
      // just written (current mtime) so MAX-of-three = now → no nag.
      setLastParentUpdate(workflow.id, new Date(Date.now() - 90 * 60 * 1000).toISOString());

      const tmux = makeTmuxMock({
        "coord-v2-pf": "fresh pane output",
        "child-v2-pf": "child quiet pane"
      });
      const watcher = new OvermindWatcher(service, tmux, undefined, undefined, undefined, makeSettingsStub(20, 45));
      await watcher.tick();
      const asks = tmux.sendAndSubmit.mock.calls.filter((call: [string, string]) => call[1].includes(ARTIFACT_FAILSAFE_TEXT));
      expect(asks).toHaveLength(0);
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  });

  it("MAX-of-three: ALL signals stale → nag fires with new message mentioning progress.md and callbacks.md", async () => {
    // run_dir exists but progress.md / callbacks.md are old (created and back-dated)
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "agj-nudge-v2-all-stale-"));
    fs.writeFileSync(path.join(runDir, "progress.md"), "old work\n");
    fs.writeFileSync(path.join(runDir, "callbacks.md"), "old callback\n");
    const oldDate = new Date(Date.now() - 90 * 60 * 1000);
    fs.utimesSync(path.join(runDir, "progress.md"), oldDate, oldDate);
    fs.utimesSync(path.join(runDir, "callbacks.md"), oldDate, oldDate);
    try {
      const workflow = registerAttachedWorkflowFixture(service, {
        label: "v2-all-stale",
        coordinator_session: "coord-v2-as",
        child_sessions: ["child-v2-as"],
        child_roles: ["coder"],
        run_dir: runDir,
        current_task: "B1",
        tasks: [{ id: "B1", label: "Work", state: "processing" }]
      });
      service.update(workflow.id, {
        last_pane_hash: hashPane("old pane"),
        last_activity_at: oldDate.toISOString()
      });
      setLastParentUpdate(workflow.id, oldDate.toISOString());

      const tmux = makeTmuxMock({
        "coord-v2-as": "new pane output",
        "child-v2-as": "child quiet pane"
      });
      const watcher = new OvermindWatcher(service, tmux, undefined, undefined, undefined, makeSettingsStub(20, 45));
      await watcher.tick();
      const asks = tmux.sendAndSubmit.mock.calls.filter((call: [string, string]) => call[1].includes(ARTIFACT_FAILSAFE_TEXT));
      expect(asks).toHaveLength(1);
      const msg = asks[0][1];
      expect(msg).toContain("progress.md");
      expect(msg).toContain("callbacks.md");
      expect(msg).toContain("queue.md");
      expect(msg).toContain("POST /api/overmind/complete");
      // The legacy "POST /api/overmind/tasks" wording is GONE in v2.
      expect(msg).not.toContain("POST /api/overmind/tasks");
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  });

  it("Files-missing fallback: progress.md/callbacks.md absent → use last_parent_update_at alone", async () => {
    // run_dir exists but neither evidence file does — fileMtimeMsBestEffort
    // returns 0 for both, so MAX falls back to last_parent_update_at.
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "agj-nudge-v2-no-files-"));
    try {
      const workflow = registerAttachedWorkflowFixture(service, {
        label: "v2-no-files",
        coordinator_session: "coord-v2-nf",
        child_sessions: ["child-v2-nf"],
        child_roles: ["coder"],
        run_dir: runDir,
        current_task: "B1",
        tasks: [{ id: "B1", label: "Work", state: "processing" }]
      });
      const staleIso = new Date(Date.now() - 90 * 60 * 1000).toISOString();
      service.update(workflow.id, {
        last_pane_hash: hashPane("old pane"),
        last_activity_at: staleIso
      });
      setLastParentUpdate(workflow.id, staleIso);

      const tmux = makeTmuxMock({
        "coord-v2-nf": "new pane output",
        "child-v2-nf": "child quiet pane"
      });
      const watcher = new OvermindWatcher(service, tmux, undefined, undefined, undefined, makeSettingsStub(20, 45));
      await watcher.tick();
      const asks = tmux.sendAndSubmit.mock.calls.filter((call: [string, string]) => call[1].includes(ARTIFACT_FAILSAFE_TEXT));
      expect(asks).toHaveLength(1); // falls back to last_parent_update_at being stale
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  });
});

// ─── Persisted cooldown survives watcher restart ─────────────────────────────

describe("Idle-nudge cooldown persists across watcher restarts (NudgeStateService)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agj-nudge-restart-test-"));
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
    fs.mkdirSync(path.join(tmpDir, "data"), { recursive: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("cooldown holds after simulated pm2 restart (new OvermindWatcher + same NudgeStateService)", async () => {
    const staleIso = "2000-01-01T00:00:00.000Z";
    // ── Setup ──────────────────────────────────────────────────────────────────
    const workflow = registerAttachedWorkflowFixture(service, {
      label: "restart-persist",
      coordinator_session: "coord-rp",
      child_sessions: ["child-rp"],
      run_dir: "/tmp/overmind-nudge"
    });
    service.update(workflow.id, {
      last_pane_hash: hashPane(QUIET_PANE),
      last_activity_at: staleIso,
      stuck_since: staleIso
    });
    setWorkflowParentUpdate(workflow.id, staleIso);

    const tmux = makeTmuxMock({ "coord-rp": QUIET_PANE, "child-rp": "child quiet pane" });
    // 30-minute cooldown, same as the live setting.
    const settings = makeSettingsStub(30);
    const nudgeState = new NudgeStateService();
    await nudgeState.load();

    const watcher1 = new OvermindWatcher(service, tmux, undefined, undefined, undefined, settings, nudgeState);

    // ── First tick: nudge fires, timestamp persisted ────────────────────────────
    await watcher1.tick();
    let updated = service.get(workflow.id);
    expect(updated?.nudge_count).toBe(1);
    expect(tmux.sendAndSubmit).toHaveBeenCalledTimes(1);
    expect(tmux.sendAndSubmit).toHaveBeenLastCalledWith("coord-rp", CANNED_NUDGE);

    // Verify the timestamp landed in the persisted store (non-zero).
    expect(nudgeState.getLastUnifiedIdleNudge(workflow.id)).toBeGreaterThan(0);

    // ── Simulate pm2 restart: new OvermindWatcher instance, same NudgeStateService ──
    // (NudgeStateService.load() already ran; on a real restart we'd load() again from
    // the same file — simulate that by creating a NEW service that reads from the same file.)
    const nudgeState2 = new NudgeStateService();
    await nudgeState2.load();

    const tmux2 = makeTmuxMock({ "coord-rp": QUIET_PANE, "child-rp": "child quiet pane" });
    const watcher2 = new OvermindWatcher(service, tmux2, undefined, undefined, undefined, settings, nudgeState2);

    // ── Immediately stuck again — cooldown should hold ─────────────────────────
    // (the in-memory cooldowns on watcher2 start at 0, but nudgeState2
    // returns the persisted timestamp → cooldown is respected).
    await watcher2.tick();
    updated = service.get(workflow.id);
    // nudge_count must NOT increment — the persisted timestamp suppressed the send.
    expect(updated?.nudge_count).toBe(1);
    expect(tmux2.sendAndSubmit).not.toHaveBeenCalled();
  });

  it("ask-update cooldown also survives watcher reconstruction with the same persisted state file", async () => {
    const staleIso = new Date(Date.now() - 120 * 60 * 1000).toISOString();
    const workflow = registerAttachedWorkflowFixture(service, {
      label: "ask-update-restart-persist",
      coordinator_session: "coord-ask-rp",
      child_sessions: ["child-ask-rp"],
      child_roles: ["coder"],
      run_dir: "/tmp/overmind-nudge",
      current_task: "A1",
      tasks: [{ id: "A1", label: "Work", state: "processing" }]
    });
    service.update(workflow.id, {
      last_pane_hash: hashPane("old pane"),
      last_activity_at: staleIso
    });
    db.prepare("UPDATE overmind_workflows SET last_parent_update_at = ? WHERE id = ?")
      .run(staleIso, workflow.id);

    const nudgeState = new NudgeStateService();
    await nudgeState.load();
    const settings = makeSettingsStub(30, 30);

    const tmux = makeTmuxMock({
      "coord-ask-rp": "new pane output",
      "child-ask-rp": "child quiet pane"
    });
    const watcher1 = new OvermindWatcher(service, tmux, undefined, undefined, undefined, settings, nudgeState);
    await watcher1.tick();
    expect(
      tmux.sendAndSubmit.mock.calls.filter((call: [string, string]) =>
        call[1].includes("no tracked artifact has advanced")
      )
    ).toHaveLength(1);

    const nudgeState2 = new NudgeStateService();
    await nudgeState2.load();
    const tmux2 = makeTmuxMock({
      "coord-ask-rp": "new pane output",
      "child-ask-rp": "child quiet pane"
    });
    const watcher2 = new OvermindWatcher(service, tmux2, undefined, undefined, undefined, settings, nudgeState2);
    await watcher2.tick();
    expect(
      tmux2.sendAndSubmit.mock.calls.filter((call: [string, string]) =>
        call[1].includes("no tracked artifact has advanced")
      )
    ).toHaveLength(0);
  });

  it("terminal status cleanup forgets persisted cooldown entries for completed, failed, and paused workflows", async () => {
    const completed = registerAttachedWorkflowFixture(service, {
      label: "cleanup-completed",
      coordinator_session: "cleanup-completed-parent",
      run_dir: "/tmp/overmind-nudge/cleanup-completed"
    });
    const failed = registerAttachedWorkflowFixture(service, {
      label: "cleanup-failed",
      coordinator_session: "cleanup-failed-parent",
      run_dir: "/tmp/overmind-nudge/cleanup-failed"
    });
    const paused = registerAttachedWorkflowFixture(service, {
      label: "cleanup-paused",
      coordinator_session: "cleanup-paused-parent",
      run_dir: "/tmp/overmind-nudge/cleanup-paused"
    });

    const nudgeState = new NudgeStateService();
    await nudgeState.load();
    for (const wf of [completed, failed, paused]) {
      nudgeState.setLastUnifiedIdleNudge(wf.id, Date.now() - 1000);
      nudgeState.setLastTaskStaleNudge(wf.id, Date.now() - 3000);
      nudgeState.setLastReconcileAsk(wf.id, "gap:missing");
    }

    service.setStatus(completed.id, "completed");
    service.setStatus(failed.id, "failed");
    service.setStatus(paused.id, "paused");

    const tmux = makeTmuxMock({
      "cleanup-completed-parent": "quiet",
      "cleanup-failed-parent": "quiet",
      "cleanup-paused-parent": "quiet"
    });
    const watcher = new OvermindWatcher(service, tmux, undefined, undefined, undefined, makeSettingsStub(30), nudgeState);
    await watcher.tick();

    const snapshot = nudgeState.getStateSnapshot();
    expect(snapshot.workflows[String(completed.id)]).toBeUndefined();
    expect(snapshot.workflows[String(failed.id)]).toBeUndefined();
    expect(snapshot.workflows[String(paused.id)]).toBeUndefined();
  });
});

// ─── R1-R8 Completion-prompt ladder (proven prompt, no latch) ────────────────

describe("Completion-prompt ladder (R1-R8 fix)", () => {
  const RUN_DIR = "/tmp/overmind-nudge";

  it("R1/R3: all-done + brain 'working' but NO observed activity → working_accepts counts up, then falls through to completion prompt (MONOTONIC, no oscillation)", async () => {
    const workflow = registerAttachedWorkflowFixture(service, {
      label: "lkvc-r1",
      coordinator_session: "coord-r1",
      child_sessions: ["child-r1"],
      run_dir: RUN_DIR
    });
    service.setTasks(workflow.id, null, [
      { id: "b1", label: "B1", state: "done" },
      { id: "b2", label: "B2", state: "done" }
    ]);
    // No pane activity: last_pane_hash matches current pane.
    const STATIC_PANE = "idle coordinator pane";
    service.update(workflow.id, { last_pane_hash: hashPane(STATIC_PANE) });

    const brain = {
      verifyCompletion: vi.fn(async () => ({
        action: "working" as const,
        reason: "pane looks active",
        consultText: ""
      }))
    } as unknown as OvermindBrain;

    const tmux = makeTmuxMock({ "coord-r1": STATIC_PANE, "child-r1": "child idle" });
    const watcher = new OvermindWatcher(service, tmux, undefined, brain);

    // Tick 1: no activity observed + brain "working" → accepted (working_accepts 1 < 2).
    await watcher.tick();
    let updated = service.get(workflow.id);
    expect(updated?.status).toBe("working");
    expect(updated?.working_accepts).toBe(1);       // separate counter (monotonic design)
    expect(updated?.completion_nudge_count).toBe(0); // nudge count UNTOUCHED (not negated)
    expect(tmux.sendAndSubmit).not.toHaveBeenCalled();

    // Tick 2: same scenario → accepted (working_accepts 2 = MAX). Still no nudge.
    await watcher.tick();
    updated = service.get(workflow.id);
    expect(updated?.status).toBe("working");
    expect(updated?.working_accepts).toBe(2);
    expect(updated?.completion_nudge_count).toBe(0);
    expect(tmux.sendAndSubmit).not.toHaveBeenCalled();

    // Tick 3: cap (2) exceeded → brain "working" NOT accepted → completion prompt sent.
    await watcher.tick();
    updated = service.get(workflow.id);
    expect(updated?.status).toBe("stuck");
    expect(updated?.completion_nudge_count).toBe(1); // monotonic: first nudge sent
    expect(updated?.working_accepts).toBe(0);         // reset when nudge sent
    expect(tmux.sendAndSubmit).toHaveBeenCalledTimes(1);
    // R3: proven prompt must contain run label + exact overmind.sh command.
    const sentMsg = tmux.sendAndSubmit.mock.calls[0][1] as string;
    expect(sentMsg).toContain('"lkvc-r1"');
    expect(sentMsg).toContain(`overmind.sh complete --run-dir ${RUN_DIR}`);
    expect(sentMsg).toContain("2/2 tasks DONE but is");
  });

  it("R3: sends proven completion prompt up to N times (bounded; no per-tick spam, re-sends after cooldown)", async () => {
    const workflow = registerAttachedWorkflowFixture(service, {
      label: "lkvc-r3",
      coordinator_session: "coord-r3",
      child_sessions: ["child-r3"],
      run_dir: RUN_DIR
    });
    service.setTasks(workflow.id, null, [
      { id: "b1", label: "B1", state: "done" },
      { id: "b2", label: "B2", state: "done" }
    ]);

    const tmux = makeTmuxMock({ "coord-r3": "idle pane", "child-r3": "child idle" });
    // 1-min cooldown so we can advance the persisted timestamp.
    const watcher = new OvermindWatcher(service, tmux, undefined, undefined, undefined, makeSettingsStub(1));

    // Helper to simulate persisted cooldown expiry (set last_at to 2 min ago).
    const expireCooldown = () => service.update(workflow.id, {
      completion_nudge_last_at: new Date(Date.now() - 2 * 60 * 1000).toISOString()
    });

    // Tick 1: first nudge.
    await watcher.tick();
    expect(service.get(workflow.id)?.completion_nudge_count).toBe(1);
    expect(tmux.sendAndSubmit).toHaveBeenCalledTimes(1);

    // Tick 2: within cooldown → no nudge (completion_nudge_last_at was just set).
    await watcher.tick();
    expect(service.get(workflow.id)?.completion_nudge_count).toBe(1);
    expect(tmux.sendAndSubmit).toHaveBeenCalledTimes(1); // no additional send

    // Advance persisted cooldown past expiry → nudge 2.
    expireCooldown();
    await watcher.tick();
    expect(service.get(workflow.id)?.completion_nudge_count).toBe(2);
    expect(tmux.sendAndSubmit).toHaveBeenCalledTimes(2);

    // Advance → nudge 3.
    expireCooldown();
    await watcher.tick();
    expect(service.get(workflow.id)?.completion_nudge_count).toBe(3);
    expect(tmux.sendAndSubmit).toHaveBeenCalledTimes(3);

    // Advance → nudge 4 (MAX).
    expireCooldown();
    await watcher.tick();
    expect(service.get(workflow.id)?.completion_nudge_count).toBe(4);
    expect(tmux.sendAndSubmit).toHaveBeenCalledTimes(4);

    // At this point ladder is exhausted (count=4=MAX). Within hourly backoff → no nudge.
    // (completion_nudge_last_at was just set to now → far within the 1hr backoff)
    await watcher.tick();
    expect(service.get(workflow.id)?.completion_nudge_count).toBe(4);
    expect(tmux.sendAndSubmit).toHaveBeenCalledTimes(4); // no additional send
  });

  it("R4: OVM never sets status to 'completed' itself — only the parent POST /complete does", async () => {
    const workflow = registerAttachedWorkflowFixture(service, {
      label: "lkvc-r4",
      coordinator_session: "coord-r4",
      child_sessions: ["child-r4"],
      run_dir: RUN_DIR
    });
    service.setTasks(workflow.id, null, [
      { id: "b1", label: "B1", state: "done" }
    ]);

    const tmux = makeTmuxMock({ "coord-r4": "idle pane", "child-r4": "child idle" });
    const watcher = new OvermindWatcher(service, tmux, undefined, undefined, undefined, makeSettingsStub(1));

    // Run many ticks — including advancing persisted cooldown to send multiple nudges.
    const expireCooldown = () => service.update(workflow.id, {
      completion_nudge_last_at: new Date(Date.now() - 2 * 60 * 1000).toISOString()
    });
    for (let i = 0; i < 8; i++) {
      expireCooldown();
      await watcher.tick();
    }

    const updated = service.get(workflow.id);
    // R4: OVM must NEVER auto-complete.
    expect(updated?.status).not.toBe("completed");
    // R5: run stays visible (status is stuck after ladder exhaustion).
    expect(updated?.status).toBe("stuck");
  });

  it("R5: dead parent (orphaned) → orphaned=true, no nudge, no auto-complete", async () => {
    const workflow = registerAttachedWorkflowFixture(service, {
      label: "dead-r5",
      coordinator_session: "coord-r5",
      child_sessions: ["child-r5"],
      run_dir: RUN_DIR
    });
    service.setTasks(workflow.id, null, [
      { id: "b1", label: "B1", state: "done" }
    ]);

    const tmux = makeTmuxMock(
      { "coord-r5": "", "child-r5": "" },
      { "coord-r5": false, "child-r5": false }
    );
    const watcher = new OvermindWatcher(service, tmux);

    await watcher.tick();
    const updated = service.get(workflow.id);
    expect(updated?.orphaned).toBe(true);
    expect(updated?.status).not.toBe("completed");
    expect(tmux.sendAndSubmit).not.toHaveBeenCalled();
  });

  it("R6: all-done + pane changed (observed activity) → NOT prompted as done", async () => {
    const workflow = registerAttachedWorkflowFixture(service, {
      label: "active-r6",
      coordinator_session: "coord-r6",
      child_sessions: ["child-r6"],
      run_dir: RUN_DIR
    });
    service.setTasks(workflow.id, null, [
      { id: "b1", label: "B1", state: "done" }
    ]);
    // Set a prior pane hash different from the current pane → pane has changed.
    service.update(workflow.id, { last_pane_hash: hashPane("old pane content") });

    const tmux = makeTmuxMock({ "coord-r6": "NEW pane content showing activity", "child-r6": "child idle" });
    const watcher = new OvermindWatcher(service, tmux);

    await watcher.tick();
    const updated = service.get(workflow.id);
    // R6: active run must NOT receive a completion prompt.
    expect(tmux.sendAndSubmit).not.toHaveBeenCalled();
    expect(updated?.status).toBe("working");
  });

  it("R7: setTasks resets completion_check to NULL and completion_nudge_count to 0", () => {
    const workflow = registerAttachedWorkflowFixture(service, {
      label: "set-tasks-r7",
      coordinator_session: "coord-r7",
      child_sessions: [],
      run_dir: RUN_DIR
    });
    // Simulate a prior completion check.
    service.update(workflow.id, {
      completion_check: "2/2",
      completion_nudge_count: 3
    });

    // setTasks must reset both fields.
    service.setTasks(workflow.id, null, [
      { id: "b1", label: "B1", state: "done" },
      { id: "b2", label: "B2", state: "done" }
    ]);

    const updated = service.get(workflow.id);
    expect(updated?.completion_check).toBeNull();
    expect(updated?.completion_nudge_count).toBe(0);
  });

  it("R3 prompt text: contains the exact proven template fields", () => {
    const prompt = buildCompletionPrompt("my-run-label", 3, 3, "/path/to/run/dir");
    expect(prompt).toContain("overmind:");
    expect(prompt).toContain('"my-run-label"');
    expect(prompt).toContain("3/3 tasks DONE but is");
    expect(prompt).toContain("bash ~/.claude/agents/lib/overmind.sh complete --run-dir /path/to/run/dir");
    expect(prompt).toContain("finishing the work isn't enough");
    expect(prompt).toContain("update your task list instead");
  });

  it("R7/H6: setTasks resets completion ladder only on real signature change; identical re-sync does NOT reset", () => {
    const workflow = registerAttachedWorkflowFixture(service, {
      label: "h6-sig-change",
      coordinator_session: "coord-h6",
      child_sessions: [],
      run_dir: RUN_DIR
    });
    // First, seed the task list so the existing state has 2/2 done tasks.
    service.setTasks(workflow.id, null, [
      { id: "b1", label: "B1", state: "done" },
      { id: "b2", label: "B2", state: "done" }
    ]);
    // Simulate an in-progress ladder state (after the initial task seed).
    service.update(workflow.id, {
      completion_check: "2/2",
      completion_nudge_count: 2,
      working_accepts: 0,
      completion_nudge_last_at: new Date().toISOString()
    });

    // Idempotent re-sync with same done/total → signature unchanged → ladder NOT reset.
    service.setTasks(workflow.id, null, [
      { id: "b1", label: "B1", state: "done" },
      { id: "b2", label: "B2", state: "done" }
    ]);
    let updated = service.get(workflow.id);
    expect(updated?.completion_nudge_count).toBe(2);  // unchanged (same signature)
    expect(updated?.completion_check).toBe("2/2");    // unchanged (setTasks doesn't reset same-sig)

    // Now change the task signature (new task added → done count changes from 2/2 to 2/3).
    service.setTasks(workflow.id, null, [
      { id: "b1", label: "B1", state: "done" },
      { id: "b2", label: "B2", state: "done" },
      { id: "b3", label: "B3", state: "pending" }
    ]);
    updated = service.get(workflow.id);
    expect(updated?.completion_check).toBeNull();         // reset on sig change
    expect(updated?.completion_nudge_count).toBe(0);      // reset on sig change
    expect(updated?.working_accepts).toBe(0);             // reset on sig change
    expect(updated?.completion_nudge_last_at).toBeNull(); // reset on sig change
  });
});

// ─── iter2 red-team hole tests (H1-H8 + MULTI-TICK LADDER) ──────────────────

describe("iter2 red-team plugs (H1-H8)", () => {
  const RUN_DIR = "/tmp/overmind-nudge";

  it("H1 MULTI-TICK LADDER: brain='working' every tick, cooldown advanced between ticks — completion_nudge_count goes 1→2→3→4 MONOTONICALLY, prompt sent each step, NEVER resets or oscillates back", async () => {
    const workflow = registerAttachedWorkflowFixture(service, {
      label: "monotonic-ladder",
      coordinator_session: "coord-ml",
      child_sessions: ["child-ml"],
      run_dir: RUN_DIR
    });
    service.setTasks(workflow.id, null, [
      { id: "b1", label: "B1", state: "done" },
      { id: "b2", label: "B2", state: "done" }
    ]);
    // No pane activity.
    const STATIC_PANE = "idle pane";
    service.update(workflow.id, { last_pane_hash: hashPane(STATIC_PANE) });

    // Brain ALWAYS says "working" — old design would oscillate; new design must advance monotonically.
    const brain = {
      verifyCompletion: vi.fn(async () => ({
        action: "working" as const,
        reason: "still working",
        consultText: ""
      }))
    } as unknown as OvermindBrain;

    const tmux = makeTmuxMock({ "coord-ml": STATIC_PANE, "child-ml": "child idle" });
    // 1-min cooldown so we can expire it easily.
    const watcher = new OvermindWatcher(service, tmux, undefined, brain, undefined, makeSettingsStub(1));

    const expireCooldown = () => service.update(workflow.id, {
      completion_nudge_last_at: new Date(Date.now() - 2 * 60 * 1000).toISOString()
    });

    // Ticks 1 and 2: working_accepts accumulates (brain "working" accepted, cap=2).
    await watcher.tick();
    let w = service.get(workflow.id)!;
    expect(w.working_accepts).toBe(1);
    expect(w.completion_nudge_count).toBe(0);
    expect(tmux.sendAndSubmit).toHaveBeenCalledTimes(0);

    await watcher.tick();
    w = service.get(workflow.id)!;
    expect(w.working_accepts).toBe(2);
    expect(w.completion_nudge_count).toBe(0);
    expect(tmux.sendAndSubmit).toHaveBeenCalledTimes(0);

    // Tick 3: cap exceeded → first completion nudge. completion_nudge_count = 1.
    await watcher.tick();
    w = service.get(workflow.id)!;
    expect(w.completion_nudge_count).toBe(1);
    expect(w.working_accepts).toBe(0);
    expect(tmux.sendAndSubmit).toHaveBeenCalledTimes(1);

    // MONOTONIC INVARIANT: with nudge_count > 0, brain "working" is BLOCKED —
    // no oscillation back to 0 even if brain keeps returning "working".
    expireCooldown();
    await watcher.tick();
    w = service.get(workflow.id)!;
    expect(w.completion_nudge_count).toBe(2); // advanced, never reset
    expect(tmux.sendAndSubmit).toHaveBeenCalledTimes(2);

    expireCooldown();
    await watcher.tick();
    w = service.get(workflow.id)!;
    expect(w.completion_nudge_count).toBe(3);
    expect(tmux.sendAndSubmit).toHaveBeenCalledTimes(3);

    expireCooldown();
    await watcher.tick();
    w = service.get(workflow.id)!;
    expect(w.completion_nudge_count).toBe(4);
    expect(tmux.sendAndSubmit).toHaveBeenCalledTimes(4);

    // Count is now at MAX (4). Verify it NEVER went backward (no oscillation).
    // Check: count was 1, then 2, then 3, then 4 — all calls to verifyCompletion
    // after the first nudge should have been bypassed (MONOTONIC INVARIANT).
    // (The brain was called for ticks 1, 2, 3 — once cap exceeded, not called for ticks 4+.)
    expect(brain.verifyCompletion).toHaveBeenCalledTimes(3);
  });

  it("H2/exhaustion→escalation: after MAX nudges, does NOT go silent — slow-backoff re-nudge fires + OVM never auto-completes", async () => {
    const notify = vi.fn(async () => {});
    const workflow = registerAttachedWorkflowFixture(service, {
      label: "exhaustion-esc",
      coordinator_session: "coord-ee",
      child_sessions: ["child-ee"],
      run_dir: RUN_DIR
    });
    service.setTasks(workflow.id, null, [
      { id: "b1", label: "B1", state: "done" }
    ]);
    // Start at MAX nudges with a stale last_at (so backoff has elapsed).
    service.update(workflow.id, {
      completion_check: "1/1",
      completion_nudge_count: 4,
      stuck_since: "2000-01-01T00:00:00.000Z",
      completion_nudge_last_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() // 2hr ago > 1hr backoff
    });

    const tmux = makeTmuxMock({ "coord-ee": "idle pane", "child-ee": "child idle" });
    const watcher = new OvermindWatcher(service, tmux, notify);

    await watcher.tick();
    const updated = service.get(workflow.id)!;
    // H5: slow-backoff re-nudge fired (count goes from 4 → 5).
    expect(updated.completion_nudge_count).toBeGreaterThan(4);
    expect(tmux.sendAndSubmit).toHaveBeenCalledTimes(1);
    // H5: one-shot JROM escalation notify also fires.
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toContain("slow-backoff");
    // R4: OVM never auto-completes.
    expect(updated.status).not.toBe("completed");
    expect(updated.status).toBe("stuck");
  });

  it("F2 bare-bash parent: send fails → cooldown recorded (completion_nudge_last_at set), escalates to orphaned, no per-tick retry", async () => {
    isAgentPaneMock.mockResolvedValue("bare-bash");
    const workflow = registerAttachedWorkflowFixture(service, {
      label: "bare-bash-fail",
      coordinator_session: "coord-bb",
      child_sessions: ["child-bb"],
      run_dir: RUN_DIR
    });
    service.setTasks(workflow.id, null, [
      { id: "b1", label: "B1", state: "done" }
    ]);
    service.update(workflow.id, {
      completion_check: "1/1"
    });

    const tmux = makeTmuxMock({ "coord-bb": "$ ", "child-bb": "child idle" });
    const watcher = new OvermindWatcher(service, tmux);

    // Tick 1: bare-bash detected → no send, but cooldown is recorded.
    // First consecutive read (count=1 < 2 threshold) → treated as "unknown" → attempted send.
    // Second consecutive read → orphaned.
    await watcher.tick();
    let w = service.get(workflow.id)!;
    // After one tick: either cooldown recorded or orphaned (depends on consecutive count).
    // completion_nudge_last_at MUST be set (so no per-tick retry).
    expect(w.completion_nudge_last_at).not.toBeNull();
    expect(w.status).not.toBe("completed"); // R4: never auto-complete

    // Tick 2: within cooldown → no retry regardless of bare-bash status.
    const callsBefore = tmux.sendAndSubmit.mock.calls.length;
    await watcher.tick();
    // No additional nudge sends (cooldown is set from tick 1).
    expect(tmux.sendAndSubmit.mock.calls.length).toBeLessThanOrEqual(callsBefore + 1);
  });

  it("H3 persisted cooldown survives restart: completion_nudge_last_at in DB → no immediate re-nudge on fresh watcher", async () => {
    const workflow = registerAttachedWorkflowFixture(service, {
      label: "restart-cooldown",
      coordinator_session: "coord-rc",
      child_sessions: ["child-rc"],
      run_dir: RUN_DIR
    });
    service.setTasks(workflow.id, null, [
      { id: "b1", label: "B1", state: "done" }
    ]);
    // Simulate first nudge already sent: set persisted cooldown to now.
    service.update(workflow.id, {
      completion_check: "1/1",
      completion_nudge_count: 1,
      completion_nudge_last_at: new Date().toISOString()
    });

    const tmux = makeTmuxMock({ "coord-rc": "idle pane", "child-rc": "child idle" });
    // Fresh watcher instance (simulating pm2 restart — in-memory cooldowns are EMPTY).
    const watcher = new OvermindWatcher(service, tmux, undefined, undefined, undefined, makeSettingsStub(20));

    // Despite empty in-memory cooldowns, completion_nudge_last_at = now → within 20-min cooldown.
    await watcher.tick();
    const updated = service.get(workflow.id)!;
    // No immediate re-nudge — persisted cooldown holds.
    expect(tmux.sendAndSubmit).not.toHaveBeenCalled();
    expect(updated.completion_nudge_count).toBe(1); // unchanged
    expect(updated.status).not.toBe("completed");
  });

  it("H2 monitoring_paused + all-done → completion prompt is sent (not silently stale in plain Active)", async () => {
    const workflow = registerAttachedWorkflowFixture(service, {
      label: "paused-all-done",
      coordinator_session: "coord-pad",
      child_sessions: ["child-pad"],
      run_dir: RUN_DIR
    });
    service.setTasks(workflow.id, null, [
      { id: "b1", label: "B1", state: "done" }
    ]);
    service.setMonitoringPaused(workflow.id, true, "jrom");

    const tmux = makeTmuxMock({ "coord-pad": "idle pane", "child-pad": "child idle" });
    const watcher = new OvermindWatcher(service, tmux);

    await watcher.tick();
    const updated = service.get(workflow.id)!;
    // H2: paused all-done run must NOT be silently hidden → completion prompt is sent.
    expect(tmux.sendAndSubmit).toHaveBeenCalledTimes(1);
    expect(tmux.sendAndSubmit.mock.calls[0][1]).toContain("overmind.sh complete --run-dir");
    expect(updated.status).not.toBe("completed"); // R4: OVM never auto-completes
  });

  it("H8 stale tui subagentInFlight (no pane-hash change) + idle all-done → still reaches the nudge ladder (NOT suppressed forever)", async () => {
    const workflow = registerAttachedWorkflowFixture(service, {
      label: "stale-subagent",
      coordinator_session: "coord-ss",
      child_sessions: ["child-ss"],
      run_dir: RUN_DIR
    });
    service.setTasks(workflow.id, null, [
      { id: "b1", label: "B1", state: "done" }
    ]);
    // The pane shows a STATIC idle state (no live subagent markers, no pane change).
    // The subagent ack text is absent so the tui-detection loop won't refresh the entry.
    const IDLE_PANE = "idle coordinator — all done, waiting";
    service.update(workflow.id, { last_pane_hash: hashPane(IDLE_PANE) });

    const tmux = makeTmuxMock({ "coord-ss": IDLE_PANE, "child-ss": "child idle" });
    const watcher = new OvermindWatcher(service, tmux);

    // Manually inject a stale tui-sourced subagent entry (>5 min = past force-expiry).
    // Use an id that matches the workflow so the watcher finds it.
    const wid = workflow.id;
    (watcher as any).subagentInFlight.set(wid, {
      source: "tui",
      since: Date.now() - 6 * 60 * 1000  // 6 min ago > STALE_SUBAGENT_FORCE_EXPIRE_MS (5 min)
    });

    await watcher.tick();
    const updated = service.get(workflow.id)!;
    // H8: stale tui flag must NOT suppress the completion ladder forever.
    // Force-expiry in completion-detector clears the stale flag, ladder proceeds.
    expect(tmux.sendAndSubmit).toHaveBeenCalledTimes(1);
    expect(tmux.sendAndSubmit.mock.calls[0][1]).toContain("overmind.sh complete --run-dir");
    expect(updated.status).not.toBe("completed"); // R4
  });

  it("NEW-1: alive parent where sendAndSubmit returns false → completion_nudge_count NOT incremented, completion_nudge_last_at recorded, orphaned stays false", async () => {
    // Regression: before fix, the guard discarded the boolean from sendAndSubmit
    // and hardcoded sent:true — phantom sends marched the monotonic counter to
    // exhaustion on a live but temporarily unreachable parent.
    const workflow = registerAttachedWorkflowFixture(service, {
      label: "phantom-send",
      coordinator_session: "coord-phantom",
      child_sessions: ["child-phantom"],
      run_dir: RUN_DIR
    });
    service.setTasks(workflow.id, null, [
      { id: "b1", label: "B1", state: "done" },
      { id: "b2", label: "B2", state: "done" }
    ]);

    // isAgentPane returns a live kind (claude) — guard does NOT orphan the pane.
    isAgentPaneMock.mockResolvedValue("claude");

    // sendAndSubmit returns false — the real tmux send failed / submit unconfirmed.
    const tmux = makeTmuxMock({
      "coord-phantom": "idle pane",
      "child-phantom": "child idle"
    });
    tmux.sendAndSubmit.mockResolvedValue(false);

    const watcher = new OvermindWatcher(service, tmux, undefined, undefined, undefined, makeSettingsStub(1));
    await watcher.tick();

    const updated = service.get(workflow.id)!;
    // Phantom send: completion_nudge_count must NOT be incremented (was 0, stays 0).
    expect(updated.completion_nudge_count).toBe(0);
    // Cooldown recorded so the ladder retries after cooldown, not per-tick.
    expect(updated.completion_nudge_last_at).not.toBeNull();
    // Live parent must NOT be orphaned.
    expect(updated.orphaned).toBe(false);
    // Send was actually attempted (alive pane path does call send).
    expect(tmux.sendAndSubmit).toHaveBeenCalledTimes(1);
  });

  it("R4/R7: OVM never setStatus('completed'); dead-parent → orphaned; active run never prompted", async () => {
    // Part 1: active run with pending tasks → never prompted for completion.
    const activeWorkflow = registerAttachedWorkflowFixture(service, {
      label: "active-no-prompt",
      coordinator_session: "coord-anp",
      child_sessions: ["child-anp"],
      run_dir: RUN_DIR
    });
    service.setTasks(activeWorkflow.id, "B1 in progress", [
      { id: "b1", label: "B1", state: "processing" },
      { id: "b2", label: "B2", state: "pending" }
    ]);

    const tmux = makeTmuxMock({
      "coord-anp": "Working (3s)\nesc to interrupt",
      "child-anp": "child idle"
    });
    const watcher = new OvermindWatcher(service, tmux);
    await watcher.tick();
    expect(tmux.sendAndSubmit).not.toHaveBeenCalled();
    const a = service.get(activeWorkflow.id)!;
    expect(a.status).not.toBe("completed");

    // Part 2: dead parent + all done → orphaned, no nudge, no auto-complete.
    const deadWorkflow = registerAttachedWorkflowFixture(service, {
      label: "dead-parent-done",
      coordinator_session: "coord-dpd",
      child_sessions: ["child-dpd"],
      run_dir: RUN_DIR
    });
    service.setTasks(deadWorkflow.id, null, [
      { id: "b1", label: "B1", state: "done" }
    ]);
    const tmux2 = makeTmuxMock(
      { "coord-dpd": "", "child-dpd": "" },
      { "coord-dpd": false, "child-dpd": false }
    );
    const watcher2 = new OvermindWatcher(service, tmux2);
    await watcher2.tick();
    const d = service.get(deadWorkflow.id)!;
    expect(d.orphaned).toBe(true);
    expect(d.status).not.toBe("completed");
    expect(tmux2.sendAndSubmit).not.toHaveBeenCalled();
  });
});

describe("Overmind completion notifications", () => {
  let app: FastifyInstance;
  let authService: AuthService;

  beforeEach(async () => {
    authService = new AuthService(db, BOT_TOKEN, JWT_SECRET, 24);
    app = Fastify({ logger: false });
  });

  afterEach(async () => {
    await app.close();
  });

  it("sends DONE once from the authoritative complete endpoint", async () => {
    const notify = vi.fn(async () => {});
    registerOvermindRoutes(app, testConfig(), authService, service, notify);
    await app.ready();

    registerAttachedWorkflowFixture(service, {
      label: "projcore A5",
      coordinator_session: "coord-3",
      run_dir: "/tmp/overmind-nudge"
    });

    const completeBody = {
      token: OVERMIND_TOKEN,
      session: "coord-3"
    };
    const first = await app.inject({
      method: "POST",
      url: "/api/overmind/complete",
      remoteAddress: "127.0.0.1",
      payload: completeBody
    });
    const second = await app.inject({
      method: "POST",
      url: "/api/overmind/complete",
      remoteAddress: "127.0.0.1",
      payload: completeBody
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toContain("🎉 DONE · AGJAssist · overmind");
    expect(notify.mock.calls[0][0]).toContain("✅ projcore A5 completed.");
    expect(notify.mock.calls[0][0]).toContain("➡️ Next: none");
    expect(service.getBySession("coord-3")?.last_notified_transition).toBe("done:completed");
  });
});
