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
  ALL_DONE_CONFIRM_NUDGE,
  CANNED_NUDGE,
  OvermindWatcher
} from "../src/services/overmind-watcher.js";
import { hashPane } from "../src/services/overmind/pane-utils.js";
import { TmuxService } from "../src/tmux/tmux-service.js";
import type { AppSettingsService, OvermindCooldowns } from "../src/services/app-settings-service.js";
import { NudgeStateService } from "../src/services/nudge-state-service.js";

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

function makeTmuxMock(panes: Record<string, string>) {
  return {
    capturePane: vi.fn(async (target: string) => panes[target] ?? ""),
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

beforeEach(() => {
  cleanup();
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
    const workflow = service.register({
      label: "hris",
      coordinator_session: "coord-paused",
      child_sessions: ["child-paused"],
      run_dir: "/tmp/overmind-nudge"
    });
    service.update(workflow.id, {
      last_pane_hash: hashPane(QUIET_PANE),
      stuck_since: "2000-01-01T00:00:00.000Z"
    });
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
    await watcher.tick();
    updated = service.get(workflow.id);
    expect(updated?.monitoring_paused).toBe(false);
    expect(updated?.nudge_count).toBe(1);
    expect(tmux.sendAndSubmit).toHaveBeenCalledTimes(1);
    expect(tmux.sendAndSubmit).toHaveBeenLastCalledWith("coord-paused", CANNED_NUDGE);
  });

  it("sends Tier 1 and Tier 2 nudges to the coordinator only, then stops", async () => {
    const workflow = service.register({
      label: "hris",
      coordinator_session: "coord-1",
      child_sessions: ["child-1"],
      run_dir: "/tmp/overmind-nudge"
    });
    service.update(workflow.id, {
      last_pane_hash: hashPane(QUIET_PANE),
      stuck_since: "2000-01-01T00:00:00.000Z"
    });

    const tmux = makeTmuxMock({
      "coord-1": QUIET_PANE,
      "child-1": "child quiet pane"
    });
    const watcher = new OvermindWatcher(service, tmux);

    await watcher.tick();
    let updated = service.get(workflow.id);
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

  it("fail-safe: when all tasks are done but completion was never reported, nudges the coordinator once and flips off 'working'", async () => {
    const workflow = service.register({
      label: "lkvc",
      coordinator_session: "coord-done",
      child_sessions: ["child-done"],
      run_dir: "/tmp/overmind-nudge"
    });
    service.setTasks(workflow.id, "all batches done — idle", [
      { id: "b1", label: "B1", state: "done" },
      { id: "b2", label: "B2", state: "done" }
    ]);

    // Pane keeps churning (idle recap chatter) — would normally pin status to "working".
    const tmux = makeTmuxMock({
      "coord-done": "✻ Cooked for 2m · recap: queue empty",
      "child-done": "child idle"
    });
    const watcher = new OvermindWatcher(service, tmux);

    await watcher.tick();
    let updated = service.get(workflow.id);
    expect(updated?.status).toBe("waiting_human");
    expect(tmux.sendAndSubmit).toHaveBeenCalledTimes(1);
    expect(tmux.sendAndSubmit).toHaveBeenLastCalledWith("coord-done", ALL_DONE_CONFIRM_NUDGE);

    // Subsequent ticks must NOT re-nudge (once per transition) and stay off "working".
    await watcher.tick();
    updated = service.get(workflow.id);
    expect(updated?.status).toBe("waiting_human");
    expect(tmux.sendAndSubmit).toHaveBeenCalledTimes(1);
  });

  it("resets nudge count and tier when the workflow returns to working", async () => {
    const workflow = service.register({
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
    const workflow = service.register({
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
    const workflow = service.register({
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
    const workflow = service.register({
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
    const staleWaitingPane = [
      "Recap:",
      "Waiting for codex proposal review from earlier.",
      "Composer is empty."
    ].join("\n");
    const workflow = service.register({
      label: "lkcamp",
      coordinator_session: "coord-lkcamp",
      child_sessions: ["child-lkcamp"],
      run_dir: "/tmp/overmind-nudge"
    });
    service.update(workflow.id, {
      last_pane_hash: hashPane(staleWaitingPane),
      stuck_since: "2000-01-01T00:00:00.000Z"
    });

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
    const workflow = service.register({
      label: "self-nudge",
      coordinator_session: "coord-4",
      child_sessions: ["child-4"],
      run_dir: "/tmp/overmind-nudge"
    });
    service.update(workflow.id, {
      last_pane_hash: hashPane(QUIET_PANE),
      stuck_since: "2000-01-01T00:00:00.000Z"
    });

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
  idle_nudge_cooldown_minutes: number,
  ask_update_cooldown_minutes = 45
): AppSettingsService {
  return {
    get: () => ({
      idle_nudge_cooldown_minutes,
      task_stale_ask_cooldown_minutes: 30,
      ask_update_cooldown_minutes,
      task_stale_recent_update_grace_minutes: 45
    } satisfies OvermindCooldowns),
    load: async () => {},
    setOvermindCooldown: async () => {}
  } as unknown as AppSettingsService;
}

describe("Idle-nudge cooldown", () => {
  it("sends ONE nudge on first stuck tick, then skips the second tick within cooldown (nudge_count unchanged)", async () => {
    const workflow = service.register({
      label: "cooldown-test",
      coordinator_session: "coord-cd",
      child_sessions: ["child-cd"],
      run_dir: "/tmp/overmind-nudge"
    });
    service.update(workflow.id, {
      last_pane_hash: hashPane(QUIET_PANE),
      stuck_since: "2000-01-01T00:00:00.000Z"
    });

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
    // Simulate time passing: override lastIdleNudgeAt to 1 min ago.
    (watcher as any).lastIdleNudgeAt.set(workflow.id, Date.now() - 1 * 60 * 1000);

    await watcher.tick();
    updated = service.get(workflow.id);
    // nudge_count must NOT increment — cooldown suppressed the send.
    expect(updated?.nudge_count).toBe(1);
    expect(tmux.sendAndSubmit).toHaveBeenCalledTimes(1); // no additional send
  });

  it("sends a second nudge once the cooldown window has elapsed", async () => {
    const workflow = service.register({
      label: "cooldown-expire",
      coordinator_session: "coord-ce",
      child_sessions: ["child-ce"],
      run_dir: "/tmp/overmind-nudge"
    });
    service.update(workflow.id, {
      last_pane_hash: hashPane(QUIET_PANE),
      stuck_since: "2000-01-01T00:00:00.000Z"
    });

    const tmux = makeTmuxMock({ "coord-ce": QUIET_PANE, "child-ce": "child quiet pane" });
    // 5-minute cooldown so we can easily "expire" it without waiting.
    const watcher = new OvermindWatcher(service, tmux, undefined, undefined, undefined, makeSettingsStub(5));

    // Tick 1: sends the first nudge.
    await watcher.tick();
    expect(service.get(workflow.id)?.nudge_count).toBe(1);
    expect(tmux.sendAndSubmit).toHaveBeenCalledTimes(1);

    // Simulate last nudge was sent 6 minutes ago — cooldown expired.
    (watcher as any).lastIdleNudgeAt.set(workflow.id, Date.now() - 6 * 60 * 1000);

    // Tick 2: cooldown expired → second nudge goes out.
    await watcher.tick();
    expect(service.get(workflow.id)?.nudge_count).toBe(2);
    expect(tmux.sendAndSubmit).toHaveBeenCalledTimes(2);
  });
});

describe("Ask-update cooldown nudge", () => {
  // JROM 2026-05-24 v2 — message now asks for progress.md/callbacks.md updates,
  // not POSTs to /api/overmind/tasks. The cooldown trigger is also the MAX of
  // (last_parent_update_at, progress.md mtime, callbacks.md mtime).
  const ASK_UPDATE_TEXT = "I haven't seen any activity";

  function setLastParentUpdate(workflowId: number, iso: string): void {
    db.prepare("UPDATE overmind_workflows SET last_parent_update_at = ? WHERE id = ?").run(iso, workflowId);
  }

  it("fires once when last_parent_update_at is older than the effective cooldown", async () => {
    const workflow = service.register({
      label: "ask-update-once",
      coordinator_session: "coord-ask-once",
      child_sessions: ["child-ask-once"],
      child_roles: ["coder"],
      run_dir: "/tmp/overmind-nudge",
      current_task: "A1",
      tasks: [{ id: "A1", label: "Work", state: "processing" }]
    });
    service.update(workflow.id, { last_pane_hash: hashPane("old coordinator pane") });
    setLastParentUpdate(workflow.id, new Date(Date.now() - 70 * 60 * 1000).toISOString());

    const tmux = makeTmuxMock({
      "coord-ask-once": "new coordinator pane output",
      "child-ask-once": "child quiet pane"
    });
    const watcher = new OvermindWatcher(service, tmux, undefined, undefined, undefined, makeSettingsStub(20, 45));

    await watcher.tick();
    const askCalls = tmux.sendAndSubmit.mock.calls.filter((call: [string, string]) => call[1].includes(ASK_UPDATE_TEXT));
    expect(askCalls).toHaveLength(1);
    expect(askCalls[0][0]).toBe("coord-ask-once");
  });

  it("re-arms once the in-memory cooldown elapses", async () => {
    const workflow = service.register({
      label: "ask-update-rearm",
      coordinator_session: "coord-ask-rearm",
      child_sessions: ["child-ask-rearm"],
      child_roles: ["coder"],
      run_dir: "/tmp/overmind-nudge",
      current_task: "A1",
      tasks: [{ id: "A1", label: "Work", state: "processing" }]
    });
    service.update(workflow.id, { last_pane_hash: hashPane("old rearm pane") });
    setLastParentUpdate(workflow.id, new Date(Date.now() - 90 * 60 * 1000).toISOString());

    const tmux = makeTmuxMock({
      "coord-ask-rearm": "new rearm pane output",
      "child-ask-rearm": "child quiet pane"
    });
    const watcher = new OvermindWatcher(service, tmux, undefined, undefined, undefined, makeSettingsStub(20, 10));

    await watcher.tick();
    expect(tmux.sendAndSubmit.mock.calls.filter((call: [string, string]) => call[1].includes(ASK_UPDATE_TEXT))).toHaveLength(1);

    await watcher.tick();
    expect(tmux.sendAndSubmit.mock.calls.filter((call: [string, string]) => call[1].includes(ASK_UPDATE_TEXT))).toHaveLength(1);

    (watcher as any).lastAskUpdateNudgeAt.set(workflow.id, Date.now() - 11 * 60 * 1000);
    await watcher.tick();
    expect(tmux.sendAndSubmit.mock.calls.filter((call: [string, string]) => call[1].includes(ASK_UPDATE_TEXT))).toHaveLength(2);
  });

  it("respects per-workflow override (override cooldown beats system default)", async () => {
    const workflow = service.register({
      label: "ask-update-override",
      coordinator_session: "coord-ask-override",
      child_sessions: ["child-ask-override"],
      child_roles: ["coder"],
      run_dir: "/tmp/overmind-nudge",
      current_task: "A1",
      tasks: [{ id: "A1", label: "Work", state: "processing" }]
    });
    service.update(workflow.id, { last_pane_hash: hashPane("old override pane") });
    service.setAskUpdateCooldownOverride(workflow.id, 5);
    setLastParentUpdate(workflow.id, new Date(Date.now() - 10 * 60 * 1000).toISOString());

    const tmux = makeTmuxMock({
      "coord-ask-override": "new override pane output",
      "child-ask-override": "child quiet pane"
    });
    const watcher = new OvermindWatcher(service, tmux, undefined, undefined, undefined, makeSettingsStub(20, 45));

    await watcher.tick();
    const askCalls = tmux.sendAndSubmit.mock.calls.filter((call: [string, string]) => call[1].includes(ASK_UPDATE_TEXT));
    expect(askCalls).toHaveLength(1);
    expect(askCalls[0][0]).toBe("coord-ask-override");
  });

  it("does NOT fire for paused or terminal workflows", async () => {
    fs.mkdirSync("/tmp/overmind-nudge/paused", { recursive: true });
    fs.mkdirSync("/tmp/overmind-nudge/completed", { recursive: true });

    const pausedWorkflow = service.register({
      label: "ask-update-paused",
      coordinator_session: "coord-ask-paused",
      child_sessions: ["child-ask-paused"],
      child_roles: ["coder"],
      run_dir: "/tmp/overmind-nudge/paused"
    });
    service.update(pausedWorkflow.id, { last_pane_hash: hashPane("old paused pane") });
    service.setMonitoringPaused(pausedWorkflow.id, true, "jrom");
    setLastParentUpdate(pausedWorkflow.id, new Date(Date.now() - 90 * 60 * 1000).toISOString());

    const completedWorkflow = service.register({
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
    expect(tmux.sendAndSubmit.mock.calls.filter((call: [string, string]) => call[1].includes(ASK_UPDATE_TEXT))).toHaveLength(0);
  });

  // ── JROM 2026-05-24 v2: MAX-of-three freshness + new message text ──────────

  it("MAX-of-three: progress.md mtime recent → no nag even when last_parent_update_at is stale", async () => {
    // Set up a real run_dir with a freshly-written progress.md
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "agj-nudge-v2-progress-"));
    fs.writeFileSync(path.join(runDir, "progress.md"), "B1 done — fresh\n");
    try {
      const workflow = service.register({
        label: "v2-progress-fresh",
        coordinator_session: "coord-v2-pf",
        child_sessions: ["child-v2-pf"],
        child_roles: ["coder"],
        run_dir: runDir,
        current_task: "B1",
        tasks: [{ id: "B1", label: "Work", state: "processing" }]
      });
      service.update(workflow.id, { last_pane_hash: hashPane("old pane") });
      // last_parent_update_at = 90min ago (stale by itself), but progress.md was
      // just written (current mtime) so MAX-of-three = now → no nag.
      setLastParentUpdate(workflow.id, new Date(Date.now() - 90 * 60 * 1000).toISOString());

      const tmux = makeTmuxMock({
        "coord-v2-pf": "fresh pane output",
        "child-v2-pf": "child quiet pane"
      });
      const watcher = new OvermindWatcher(service, tmux, undefined, undefined, undefined, makeSettingsStub(20, 45));
      await watcher.tick();
      const asks = tmux.sendAndSubmit.mock.calls.filter((call: [string, string]) => call[1].includes(ASK_UPDATE_TEXT));
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
      const workflow = service.register({
        label: "v2-all-stale",
        coordinator_session: "coord-v2-as",
        child_sessions: ["child-v2-as"],
        child_roles: ["coder"],
        run_dir: runDir,
        current_task: "B1",
        tasks: [{ id: "B1", label: "Work", state: "processing" }]
      });
      service.update(workflow.id, { last_pane_hash: hashPane("old pane") });
      setLastParentUpdate(workflow.id, oldDate.toISOString());

      const tmux = makeTmuxMock({
        "coord-v2-as": "new pane output",
        "child-v2-as": "child quiet pane"
      });
      const watcher = new OvermindWatcher(service, tmux, undefined, undefined, undefined, makeSettingsStub(20, 45));
      await watcher.tick();
      const asks = tmux.sendAndSubmit.mock.calls.filter((call: [string, string]) => call[1].includes(ASK_UPDATE_TEXT));
      expect(asks).toHaveLength(1);
      const msg = asks[0][1];
      expect(msg).toContain("progress.md");
      expect(msg).toContain("callbacks.md");
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
      const workflow = service.register({
        label: "v2-no-files",
        coordinator_session: "coord-v2-nf",
        child_sessions: ["child-v2-nf"],
        child_roles: ["coder"],
        run_dir: runDir,
        current_task: "B1",
        tasks: [{ id: "B1", label: "Work", state: "processing" }]
      });
      service.update(workflow.id, { last_pane_hash: hashPane("old pane") });
      setLastParentUpdate(workflow.id, new Date(Date.now() - 90 * 60 * 1000).toISOString());

      const tmux = makeTmuxMock({
        "coord-v2-nf": "new pane output",
        "child-v2-nf": "child quiet pane"
      });
      const watcher = new OvermindWatcher(service, tmux, undefined, undefined, undefined, makeSettingsStub(20, 45));
      await watcher.tick();
      const asks = tmux.sendAndSubmit.mock.calls.filter((call: [string, string]) => call[1].includes(ASK_UPDATE_TEXT));
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
    // ── Setup ──────────────────────────────────────────────────────────────────
    const workflow = service.register({
      label: "restart-persist",
      coordinator_session: "coord-rp",
      child_sessions: ["child-rp"],
      run_dir: "/tmp/overmind-nudge"
    });
    service.update(workflow.id, {
      last_pane_hash: hashPane(QUIET_PANE),
      stuck_since: "2000-01-01T00:00:00.000Z"
    });

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
    expect(nudgeState.getLastIdleNudge(workflow.id)).toBeGreaterThan(0);

    // ── Simulate pm2 restart: new OvermindWatcher instance, same NudgeStateService ──
    // (NudgeStateService.load() already ran; on a real restart we'd load() again from
    // the same file — simulate that by creating a NEW service that reads from the same file.)
    const nudgeState2 = new NudgeStateService();
    await nudgeState2.load();

    const tmux2 = makeTmuxMock({ "coord-rp": QUIET_PANE, "child-rp": "child quiet pane" });
    const watcher2 = new OvermindWatcher(service, tmux2, undefined, undefined, undefined, settings, nudgeState2);

    // ── Immediately stuck again — cooldown should hold ─────────────────────────
    // (the in-memory lastIdleNudgeAt on watcher2 starts at 0, but nudgeState2
    // returns the persisted timestamp → cooldown is respected).
    await watcher2.tick();
    updated = service.get(workflow.id);
    // nudge_count must NOT increment — the persisted timestamp suppressed the send.
    expect(updated?.nudge_count).toBe(1);
    expect(tmux2.sendAndSubmit).not.toHaveBeenCalled();
  });

  it("ask-update cooldown also survives watcher reconstruction with the same persisted state file", async () => {
    const workflow = service.register({
      label: "ask-update-restart-persist",
      coordinator_session: "coord-ask-rp",
      child_sessions: ["child-ask-rp"],
      child_roles: ["coder"],
      run_dir: "/tmp/overmind-nudge",
      current_task: "A1",
      tasks: [{ id: "A1", label: "Work", state: "processing" }]
    });
    service.update(workflow.id, { last_pane_hash: hashPane("old pane") });
    db.prepare("UPDATE overmind_workflows SET last_parent_update_at = ? WHERE id = ?")
      .run(new Date(Date.now() - 120 * 60 * 1000).toISOString(), workflow.id);

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
        call[1].includes("I haven't seen any activity")
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
        call[1].includes("I haven't seen any activity")
      )
    ).toHaveLength(0);
  });

  it("terminal status cleanup forgets persisted cooldown entries for completed, failed, and paused workflows", async () => {
    const completed = service.register({
      label: "cleanup-completed",
      coordinator_session: "cleanup-completed-parent",
      run_dir: "/tmp/overmind-nudge/cleanup-completed"
    });
    const failed = service.register({
      label: "cleanup-failed",
      coordinator_session: "cleanup-failed-parent",
      run_dir: "/tmp/overmind-nudge/cleanup-failed"
    });
    const paused = service.register({
      label: "cleanup-paused",
      coordinator_session: "cleanup-paused-parent",
      run_dir: "/tmp/overmind-nudge/cleanup-paused"
    });

    const nudgeState = new NudgeStateService();
    await nudgeState.load();
    for (const wf of [completed, failed, paused]) {
      nudgeState.setLastIdleNudge(wf.id, Date.now() - 1000);
      nudgeState.setLastAskUpdateNudge(wf.id, Date.now() - 2000);
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

    service.register({
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
