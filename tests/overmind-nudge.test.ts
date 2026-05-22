import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { DatabaseService } from "../src/db/database.js";
import { AuthService } from "../src/auth/auth-service.js";
import { AppConfig } from "../src/config/config.js";
import { registerOvermindRoutes } from "../src/api/routes/overmind-routes.js";
import { OvermindService } from "../src/services/overmind-service.js";
import {
  ALL_DONE_CONFIRM_NUDGE,
  CANNED_NUDGE,
  OvermindWatcher,
  hashPane
} from "../src/services/overmind-watcher.js";
import { TmuxService } from "../src/tmux/tmux-service.js";

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
    sendCommand: vi.fn(async () => ({ message: "sent", blocked: false }))
  } as unknown as TmuxService & {
    capturePane: ReturnType<typeof vi.fn>;
    sendCommand: ReturnType<typeof vi.fn>;
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
    expect(tmux.sendCommand).not.toHaveBeenCalled();

    // Resume: the next stuck tick nudges normally.
    service.setMonitoringPaused(workflow.id, false, null);
    await watcher.tick();
    updated = service.get(workflow.id);
    expect(updated?.monitoring_paused).toBe(false);
    expect(updated?.nudge_count).toBe(1);
    expect(tmux.sendCommand).toHaveBeenCalledTimes(1);
    expect(tmux.sendCommand).toHaveBeenLastCalledWith("coord-paused", CANNED_NUDGE, true, true);
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
    expect(tmux.sendCommand).toHaveBeenCalledTimes(1);
    expect(tmux.sendCommand).toHaveBeenLastCalledWith("coord-1", CANNED_NUDGE, true, true);

    await watcher.tick();
    updated = service.get(workflow.id);
    expect(updated?.nudge_count).toBe(2);
    expect(updated?.tier).toBe(2);
    expect(tmux.sendCommand).toHaveBeenCalledTimes(2);
    expect(tmux.sendCommand).toHaveBeenLastCalledWith("coord-1", CANNED_NUDGE, true, true);

    await watcher.tick();
    updated = service.get(workflow.id);
    expect(updated?.nudge_count).toBe(2);
    expect(updated?.tier).toBe(2);
    expect(tmux.sendCommand).toHaveBeenCalledTimes(2);
    expect(tmux.sendCommand.mock.calls.every((call) => call[0] === "coord-1")).toBe(true);
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
    expect(tmux.sendCommand).toHaveBeenCalledTimes(1);
    expect(tmux.sendCommand).toHaveBeenLastCalledWith("coord-done", ALL_DONE_CONFIRM_NUDGE, true, true);

    // Subsequent ticks must NOT re-nudge (once per transition) and stay off "working".
    await watcher.tick();
    updated = service.get(workflow.id);
    expect(updated?.status).toBe("waiting_human");
    expect(tmux.sendCommand).toHaveBeenCalledTimes(1);
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
    expect(tmux.sendCommand).not.toHaveBeenCalled();
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
    expect(tmux.sendCommand).toHaveBeenCalledTimes(1);
    expect(tmux.sendCommand).toHaveBeenLastCalledWith("coord-lkcamp", CANNED_NUDGE, true, true);
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
      sendCommand: vi.fn(async () => ({ message: "sent", blocked: false }))
    } as unknown as TmuxService & {
      capturePane: ReturnType<typeof vi.fn>;
      sendCommand: ReturnType<typeof vi.fn>;
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
    expect(tmux.sendCommand).toHaveBeenCalledTimes(2);
    expect(tmux.sendCommand.mock.calls.every((call) => call[0] === "coord-4")).toBe(true);
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
