import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import { DatabaseService } from "../src/db/database.js";
import { AuthService } from "../src/auth/auth-service.js";
import { OvermindService } from "../src/services/overmind-service.js";
import { registerOvermindRoutes } from "../src/api/routes/overmind-routes.js";
import { AppConfig } from "../src/config/config.js";
import { OvmSessionManager } from "../src/services/ovm-session.js";
import type { TmuxService } from "../src/tmux/tmux-service.js";
import fs from "node:fs";
import path from "node:path";

const TEST_DB = path.join("data", "test-overmind-routes.sqlite");
const BOT_TOKEN = "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11";
const JWT_SECRET = "test-secret";
const OVERMIND_TOKEN = "ovm-test-token";

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

function lifecyclePost(url: string, body: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url,
    remoteAddress: "127.0.0.1",
    payload: body
  });
}

function lifecycleDelete(url: string, body: Record<string, unknown>) {
  return app.inject({
    method: "DELETE",
    url,
    remoteAddress: "127.0.0.1",
    payload: body
  });
}

function lifecycleDeleteWithTokenHeader(url: string) {
  return app.inject({
    method: "DELETE",
    url,
    remoteAddress: "127.0.0.1",
    headers: {
      "x-overmind-token": OVERMIND_TOKEN
    }
  });
}

let app: FastifyInstance;
let db: DatabaseService;
let authService: AuthService;
let overmindService: OvermindService;
let ovmSession: OvmSessionManager;

function authHeader(): { authorization: string } {
  const loginCode = authService.generateLoginCode(111222);
  const auth = authService.authenticateWithCode(loginCode);
  expect(auth).not.toBeNull();
  return { authorization: `Bearer ${auth!.token}` };
}

beforeEach(async () => {
  cleanup();
  db = new DatabaseService(TEST_DB);
  db.ensureOwner(111222);
  authService = new AuthService(db, BOT_TOKEN, JWT_SECRET, 24);
  overmindService = new OvermindService(db);
  ovmSession = {
    status: vi.fn(async () => ({ open: true, status: "open", since: "2026-05-21T00:00:00.000Z" })),
    open: vi.fn(async () => ({ open: true, status: "open", opened: true, since: "2026-05-21T00:00:00.000Z" })),
    restart: vi.fn(async () => ({ open: true, status: "open", opened: true, restarted: true, since: "2026-05-21T00:00:01.000Z" })),
    close: vi.fn(async () => ({ open: false, status: "closed", closed: true })),
    sendAndAwaitReply: vi.fn(async () => ({ pending: false as const, reply: "mock reply" })),
    getReply: vi.fn(async () => null)
  };
  app = Fastify({ logger: false });
  registerOvermindRoutes(app, testConfig(), authService, overmindService, undefined, undefined, ovmSession);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  db.close();
  cleanup();
});

describe("Overmind routes", () => {
  it("registers and upserts workflows from localhost with the shared token", async () => {
    const first = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      label: "lkcamp",
      session: "lkcamp-12",
      child_sessions: ["lkcdx-may20"],
      run_dir: "/tmp/lkcamp",
      current_task: "A2 routes",
      tasks: [{ id: "A2", label: "Routes", state: "processing" }]
    });

    expect(first.statusCode).toBe(201);
    const firstBody = first.json();
    expect(firstBody.workflow.coordinator_session).toBe("lkcamp-12");
    expect(firstBody.workflow.child_sessions).toEqual(["lkcdx-may20"]);
    expect(firstBody.workflow.tasks).toEqual([{ id: "A2", label: "Routes", state: "processing" }]);

    const second = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      label: "lkcamp rerun",
      session: "lkcamp-12",
      child_sessions: ["lkcdx-may20", "lkcdx-extra"],
      run_dir: "/tmp/lkcamp-rerun"
    });

    expect(second.statusCode).toBe(201);
    const secondBody = second.json();
    expect(secondBody.workflow.id).toBe(firstBody.workflow.id);
    expect(secondBody.workflow.label).toBe("lkcamp rerun");
    expect(secondBody.workflow.status).toBe("active");
    expect(secondBody.workflow.child_sessions).toEqual(["lkcdx-may20", "lkcdx-extra"]);
    expect(overmindService.list()).toHaveLength(1);
  });

  it("rejects /register with 409 when a different coordinator_session already owns the same run_dir (1 workflow per parent)", async () => {
    const first = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      label: "HRIS · trapprove",
      session: "hris-d-22",
      run_dir: "/home/agjrom/websites/HRIS/plan/WK_0522/tr-auto-approve/projcore-run-2026-05-23"
    });
    expect(first.statusCode).toBe(201);

    const dup = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      label: "HRIS · trapprove",
      session: "hris-claude-main",
      run_dir: "/home/agjrom/websites/HRIS/plan/WK_0522/tr-auto-approve/projcore-run-2026-05-23"
    });
    expect(dup.statusCode).toBe(409);
    const body = dup.json();
    expect(body.existing.coordinator_session).toBe("hris-d-22");
    expect(body.existing.id).toBe(first.json().workflow.id);

    // Only one workflow row exists — the duplicate did not persist.
    expect(overmindService.list()).toHaveLength(1);
  });

  it("sanitizes markdown table chrome out of tasks on /register and /tasks", async () => {
    const reg = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      label: "trash-paste",
      session: "tp-route",
      run_dir: "/tmp/overmind/trash-paste-route",
      current_task: "| # | Batch | Owner | Status | Notes |",
      tasks: [
        { id: "row-1", label: "| # | Batch | Owner | Status | Notes |", state: "pending" },
        { id: "row-2", label: "|---|-------|-------|--------|-------|", state: "pending" },
        { id: "row-3", label: "| B0 | Design memo rev | codex-impl | DONE | …", state: "pending" }
      ]
    });
    expect(reg.statusCode).toBe(201);
    expect(reg.json().workflow.tasks.map((t: { id: string }) => t.id)).toEqual(["row-3"]);
    expect(reg.json().workflow.current_task).toBeNull();

    const upd = await lifecyclePost("/api/overmind/tasks", {
      token: OVERMIND_TOKEN,
      session: "tp-route",
      current_task: "|---|---|---|",
      tasks: [
        { id: "row-a", label: "|---|---|---|", state: "pending" },
        { id: "row-b", label: "Real follow-up", state: "processing" }
      ]
    });
    expect(upd.statusCode).toBe(200);
    expect(upd.json().workflow.tasks.map((t: { id: string }) => t.id)).toEqual(["row-b"]);
    expect(upd.json().workflow.current_task).toBeNull();
  });

  it("rejects lifecycle requests with missing or invalid token and non-loopback source", async () => {
    const missingToken = await lifecyclePost("/api/overmind/register", {
      label: "bad",
      session: "bad-1",
      run_dir: "/tmp/bad"
    });
    expect(missingToken.statusCode).toBe(401);

    const badToken = await lifecyclePost("/api/overmind/register", {
      token: "wrong",
      label: "bad",
      session: "bad-1",
      run_dir: "/tmp/bad"
    });
    expect(badToken.statusCode).toBe(401);

    const nonLoopback = await app.inject({
      method: "POST",
      url: "/api/overmind/register",
      remoteAddress: "10.0.0.10",
      payload: {
        token: OVERMIND_TOKEN,
        label: "bad",
        session: "bad-1",
        run_dir: "/tmp/bad"
      }
    });
    expect(nonLoopback.statusCode).toBe(403);
  });

  it("completes workflows and updates tasklists by session", async () => {
    await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      label: "hris",
      session: "hris-d-22",
      run_dir: "/tmp/hris"
    });

    const tasks = await lifecyclePost("/api/overmind/tasks", {
      token: OVERMIND_TOKEN,
      session: "hris-d-22",
      current_task: "A2 validation",
      tasks: [
        { id: "A1", label: "Schema", state: "done" },
        { id: "A2", label: "Routes", state: "processing" }
      ]
    });

    expect(tasks.statusCode).toBe(200);
    expect(tasks.json().workflow.current_task).toBe("A2 validation");
    expect(tasks.json().workflow.tasks).toEqual([
      { id: "A1", label: "Schema", state: "done" },
      { id: "A2", label: "Routes", state: "processing" }
    ]);

    const complete = await lifecyclePost("/api/overmind/complete", {
      token: OVERMIND_TOKEN,
      session: "hris-d-22"
    });

    expect(complete.statusCode).toBe(200);
    expect(complete.json().workflow.status).toBe("completed");

    const missing = await lifecyclePost("/api/overmind/complete", {
      token: OVERMIND_TOKEN,
      session: "unknown"
    });
    expect(missing.statusCode).toBe(404);
  });

  it("pauses, resumes, and drops workflows from localhost with the shared token", async () => {
    const registered = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      label: "operator controls",
      session: "ovm-controls-parent",
      run_dir: "/tmp/ovm-controls"
    });
    const workflowId = registered.json().workflow.id;

    const paused = await lifecyclePost(`/api/overmind/workflows/${workflowId}/pause`, {
      token: OVERMIND_TOKEN
    });
    expect(paused.statusCode).toBe(200);
    expect(paused.json().workflow.monitoring_paused).toBe(true);
    expect(overmindService.get(workflowId)?.monitoring_paused).toBe(true);
    expect(overmindService.get(workflowId)?.paused_by).toBe("projcore-relay");

    const resumed = await lifecyclePost(`/api/overmind/workflows/${workflowId}/resume`, {
      token: OVERMIND_TOKEN
    });
    expect(resumed.statusCode).toBe(200);
    expect(resumed.json().workflow.monitoring_paused).toBe(false);
    expect(overmindService.get(workflowId)?.monitoring_paused).toBe(false);

    const dropped = await lifecycleDeleteWithTokenHeader(`/api/overmind/workflows/${workflowId}`);
    expect(dropped.statusCode).toBe(200);
    expect(dropped.json()).toEqual({ ok: true });
    expect(overmindService.get(workflowId)).toBeNull();
  });

  it("rejects operator control requests with missing or invalid token", async () => {
    const registered = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      label: "guarded controls",
      session: "guarded-controls-parent",
      run_dir: "/tmp/guarded-controls"
    });
    const workflowId = registered.json().workflow.id;

    const pauseMissingToken = await lifecyclePost(`/api/overmind/workflows/${workflowId}/pause`, {});
    expect(pauseMissingToken.statusCode).toBe(401);

    const resumeBadToken = await lifecyclePost(`/api/overmind/workflows/${workflowId}/resume`, {
      token: "wrong"
    });
    expect(resumeBadToken.statusCode).toBe(401);

    const dropMissingToken = await lifecycleDelete(`/api/overmind/workflows/${workflowId}`, {});
    expect(dropMissingToken.statusCode).toBe(401);

    expect(overmindService.get(workflowId)?.status).toBe("active");
  });

  it("returns 404 for operator control requests against unknown workflows", async () => {
    const pause = await lifecyclePost("/api/overmind/workflows/999/pause", {
      token: OVERMIND_TOKEN
    });
    expect(pause.statusCode).toBe(404);

    const resume = await lifecyclePost("/api/overmind/workflows/999/resume", {
      token: OVERMIND_TOKEN
    });
    expect(resume.statusCode).toBe(404);

    const drop = await lifecycleDelete("/api/overmind/workflows/999", {
      token: OVERMIND_TOKEN
    });
    expect(drop.statusCode).toBe(404);
  });

  it("requires JWT auth for workflow reads and returns registered rows", async () => {
    await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      label: "lkvc",
      session: "lkvc-38",
      run_dir: "/tmp/lkvc"
    });

    const unauthenticated = await app.inject({
      method: "GET",
      url: "/api/overmind/workflows"
    });
    expect(unauthenticated.statusCode).toBe(401);

    const loginCode = authService.generateLoginCode(111222);
    const auth = authService.authenticateWithCode(loginCode);
    expect(auth).not.toBeNull();

    const authenticated = await app.inject({
      method: "GET",
      url: "/api/overmind/workflows?status=active",
      headers: {
        authorization: `Bearer ${auth!.token}`
      }
    });

    expect(authenticated.statusCode).toBe(200);
    expect(authenticated.json().workflows).toHaveLength(1);
    expect(authenticated.json().workflows[0].coordinator_session).toBe("lkvc-38");
  });

  it("requires JWT auth for task history and keeps rows after workflow deletion", async () => {
    const registered = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      label: "archive label",
      session: "archive-parent",
      run_dir: "/tmp/archive",
      current_task: "Seed",
      tasks: [{ id: "A1", label: "First", state: "processing" }]
    });
    const workflowId = registered.json().workflow.id;
    overmindService.setDisplayName(workflowId, "Archive display");

    await lifecyclePost("/api/overmind/tasks", {
      token: OVERMIND_TOKEN,
      session: "archive-parent",
      current_task: "Archive this",
      tasks: [{ id: "A1", label: "First", state: "done" }]
    });

    const unauthenticated = await app.inject({
      method: "GET",
      url: "/api/overmind/history"
    });
    expect(unauthenticated.statusCode).toBe(401);

    const loginCode = authService.generateLoginCode(111222);
    const auth = authService.authenticateWithCode(loginCode);
    expect(auth).not.toBeNull();

    const beforeDrop = await app.inject({
      method: "GET",
      url: "/api/overmind/history",
      headers: {
        authorization: `Bearer ${auth!.token}`
      }
    });
    expect(beforeDrop.statusCode).toBe(200);
    expect(beforeDrop.json().history).toHaveLength(1);
    expect(beforeDrop.json().history[0]).toMatchObject({
      coordinator_session: "archive-parent",
      name: "Archive display",
      current_task: "Archive this",
      done: 1,
      total: 1
    });

    const drop = await lifecycleDelete(`/api/overmind/workflows/${workflowId}`, {
      token: OVERMIND_TOKEN
    });
    expect(drop.statusCode).toBe(200);
    expect(drop.json()).toEqual({ ok: true });

    const afterDrop = await app.inject({
      method: "GET",
      url: "/api/overmind/history",
      headers: {
        authorization: `Bearer ${auth!.token}`
      }
    });
    expect(afterDrop.statusCode).toBe(200);
    expect(afterDrop.json().history).toHaveLength(1);
    expect(afterDrop.json().history[0]).toMatchObject({
      coordinator_session: "archive-parent",
      name: "Archive display",
      current_task: "Archive this"
    });
  });

  it("requires JWT auth to rename workflows and sets or clears display_name", async () => {
    const registered = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      label: "agjassist",
      session: "agjassist-51",
      run_dir: "/tmp/agjassist"
    });
    const workflowId = registered.json().workflow.id;

    const unauthenticated = await app.inject({
      method: "POST",
      url: `/api/overmind/workflows/${workflowId}/name`,
      payload: { name: "Custom Workflow" }
    });
    expect(unauthenticated.statusCode).toBe(401);

    const loginCode = authService.generateLoginCode(111222);
    const auth = authService.authenticateWithCode(loginCode);
    expect(auth).not.toBeNull();

    const renamed = await app.inject({
      method: "POST",
      url: `/api/overmind/workflows/${workflowId}/name`,
      headers: {
        authorization: `Bearer ${auth!.token}`
      },
      payload: { name: "  Custom Workflow  " }
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().workflow.display_name).toBe("Custom Workflow");
    expect(overmindService.get(workflowId)?.display_name).toBe("Custom Workflow");

    const cleared = await app.inject({
      method: "POST",
      url: `/api/overmind/workflows/${workflowId}/name`,
      headers: {
        authorization: `Bearer ${auth!.token}`
      },
      payload: { name: "" }
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().workflow.display_name).toBeNull();

    const missing = await app.inject({
      method: "POST",
      url: "/api/overmind/workflows/999/name",
      headers: {
        authorization: `Bearer ${auth!.token}`
      },
      payload: { name: "Nope" }
    });
    expect(missing.statusCode).toBe(404);
  });

  it("POST /api/overmind/register with display_name in body does NOT change an existing display_name", async () => {
    // Register and set a custom display_name
    const first = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      label: "spoof-test",
      session: "spoof-session",
      run_dir: "/tmp/spoof-test"
    });
    const workflowId = first.json().workflow.id;
    overmindService.setDisplayName(workflowId, "JROM Custom Title");

    // Re-register with a spoofed display_name field in the body
    const second = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      label: "spoof-test-v2",
      session: "spoof-session",
      run_dir: "/tmp/spoof-test-v2",
      display_name: "spoofed"
    });

    expect(second.statusCode).toBe(201);
    // display_name must be unchanged — the register route must never forward it
    const wf = overmindService.get(workflowId);
    expect(wf?.display_name).toBe("JROM Custom Title");
    expect(second.json().workflow.display_name).toBe("JROM Custom Title");
  });

  it("POST /api/overmind/workflows/:id/ask-update-cooldown sets and clears the override, JWT-authed", async () => {
    const registered = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      label: "ask-update-override",
      session: "ask-update-override-parent",
      run_dir: "/tmp/ask-update-override"
    });
    const workflowId = registered.json().workflow.id;

    const unauthenticated = await app.inject({
      method: "POST",
      url: `/api/overmind/workflows/${workflowId}/ask-update-cooldown`,
      payload: { override_minutes: 25 }
    });
    expect(unauthenticated.statusCode).toBe(401);

    const authenticatedSet = await app.inject({
      method: "POST",
      url: `/api/overmind/workflows/${workflowId}/ask-update-cooldown`,
      headers: authHeader(),
      payload: { override_minutes: 25 }
    });
    expect(authenticatedSet.statusCode).toBe(200);
    expect(authenticatedSet.json().workflow.ask_update_cooldown_override_minutes).toBe(25);
    expect(overmindService.get(workflowId)?.ask_update_cooldown_override_minutes).toBe(25);

    const authenticatedClear = await app.inject({
      method: "POST",
      url: `/api/overmind/workflows/${workflowId}/ask-update-cooldown`,
      headers: authHeader(),
      payload: { override_minutes: null }
    });
    expect(authenticatedClear.statusCode).toBe(200);
    expect(authenticatedClear.json().workflow.ask_update_cooldown_override_minutes).toBeNull();
    expect(overmindService.get(workflowId)?.ask_update_cooldown_override_minutes).toBeNull();
  });

  it("POST /api/overmind/workflows/:id/ask-update-cooldown validation rejects 7, -5, 245, 4.5", async () => {
    const registered = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      label: "ask-update-validation",
      session: "ask-update-validation-parent",
      run_dir: "/tmp/ask-update-validation"
    });
    const workflowId = registered.json().workflow.id;

    for (const overrideMinutes of [7, -5, 245, 4.5]) {
      const res = await app.inject({
        method: "POST",
        url: `/api/overmind/workflows/${workflowId}/ask-update-cooldown`,
        headers: authHeader(),
        payload: { override_minutes: overrideMinutes }
      });
      expect(res.statusCode).toBe(400);
    }
  });

  describe("child-close reminder on /complete", () => {
    function makeTmuxMock(aliveSet: Set<string>): TmuxService {
      return {
        sessionExists: vi.fn(async (target: string) => aliveSet.has(target)),
        sendCommand: vi.fn(async () => ({ message: "sent", blocked: false })),
        sendAndSubmit: vi.fn(async () => true),
        capturePane: vi.fn(async () => "")
      } as unknown as TmuxService;
    }

    async function buildAppWithTmux(tmuxMock: TmuxService): Promise<FastifyInstance> {
      const a = Fastify({ logger: false });
      registerOvermindRoutes(a, testConfig(), authService, overmindService, undefined, undefined, undefined, tmuxMock);
      await a.ready();
      return a;
    }

    it("sends one sendCommand to coordinator_session containing child name + kill-session when ≥1 child is alive", async () => {
      const tmux = makeTmuxMock(new Set(["child-alive-1"]));
      const a = await buildAppWithTmux(tmux);
      try {
        await a.inject({
          method: "POST",
          url: "/api/overmind/register",
          remoteAddress: "127.0.0.1",
          payload: {
            token: OVERMIND_TOKEN,
            label: "close-reminder-test",
            session: "parent-coord",
            child_sessions: ["child-alive-1"],
            run_dir: "/tmp/close-test"
          }
        });

        const complete = await a.inject({
          method: "POST",
          url: "/api/overmind/complete",
          remoteAddress: "127.0.0.1",
          payload: { token: OVERMIND_TOKEN, session: "parent-coord" }
        });

        expect(complete.statusCode).toBe(200);
        expect(complete.json().workflow.status).toBe("completed");
        expect(tmux.sendAndSubmit).toHaveBeenCalledOnce();
        const [target, msg] = (tmux.sendAndSubmit as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(target).toBe("parent-coord");
        expect(msg).toContain("child-alive-1");
        expect(msg).toContain("kill-session");
      } finally {
        await a.close();
      }
    });

    it("does NOT call sendCommand when workflow has no child_sessions", async () => {
      const tmux = makeTmuxMock(new Set());
      const a = await buildAppWithTmux(tmux);
      try {
        await a.inject({
          method: "POST",
          url: "/api/overmind/register",
          remoteAddress: "127.0.0.1",
          payload: {
            token: OVERMIND_TOKEN,
            label: "no-children-test",
            session: "parent-no-children",
            run_dir: "/tmp/no-children"
          }
        });

        const complete = await a.inject({
          method: "POST",
          url: "/api/overmind/complete",
          remoteAddress: "127.0.0.1",
          payload: { token: OVERMIND_TOKEN, session: "parent-no-children" }
        });

        expect(complete.statusCode).toBe(200);
        expect(complete.json().workflow.status).toBe("completed");
        expect(tmux.sendAndSubmit).not.toHaveBeenCalled();
      } finally {
        await a.close();
      }
    });

    it("does NOT call sendCommand when all children are dead (sessionExists → false)", async () => {
      const tmux = makeTmuxMock(new Set()); // nothing alive
      const a = await buildAppWithTmux(tmux);
      try {
        await a.inject({
          method: "POST",
          url: "/api/overmind/register",
          remoteAddress: "127.0.0.1",
          payload: {
            token: OVERMIND_TOKEN,
            label: "dead-children-test",
            session: "parent-dead-children",
            child_sessions: ["child-dead-1", "child-dead-2"],
            run_dir: "/tmp/dead-children"
          }
        });

        const complete = await a.inject({
          method: "POST",
          url: "/api/overmind/complete",
          remoteAddress: "127.0.0.1",
          payload: { token: OVERMIND_TOKEN, session: "parent-dead-children" }
        });

        expect(complete.statusCode).toBe(200);
        expect(complete.json().workflow.status).toBe("completed");
        expect(tmux.sendAndSubmit).not.toHaveBeenCalled();
      } finally {
        await a.close();
      }
    });

    it("does NOT call sendCommand when no tmuxService is provided (existing behaviour unchanged)", async () => {
      // default app (no tmuxService) — uses the shared `app` from beforeEach
      await app.inject({
        method: "POST",
        url: "/api/overmind/register",
        remoteAddress: "127.0.0.1",
        payload: {
          token: OVERMIND_TOKEN,
          label: "no-tmux-test",
          session: "parent-no-tmux",
          child_sessions: ["child-1"],
          run_dir: "/tmp/no-tmux"
        }
      });

      const complete = await app.inject({
        method: "POST",
        url: "/api/overmind/complete",
        remoteAddress: "127.0.0.1",
        payload: { token: OVERMIND_TOKEN, session: "parent-no-tmux" }
      });

      expect(complete.statusCode).toBe(200);
      expect(complete.json().workflow.status).toBe("completed");
      // no tmuxService — nothing to assert on, just verify no crash
    });

    it("(a) alive child + not-all-tasks-done → ONE sendAndSubmit with BOTH kill-session AND task-list ask", async () => {
      const tmux = makeTmuxMock(new Set(["child-alive-x"]));
      const a = await buildAppWithTmux(tmux);
      try {
        await a.inject({
          method: "POST",
          url: "/api/overmind/register",
          remoteAddress: "127.0.0.1",
          payload: {
            token: OVERMIND_TOKEN,
            label: "hris-partial",
            session: "hris-partial-coord",
            child_sessions: ["child-alive-x"],
            run_dir: "/tmp/hris-partial",
            tasks: [
              { id: "T1", label: "Done task", state: "done" },
              { id: "T2", label: "Still processing", state: "processing" },
              { id: "T3", label: "Still pending", state: "pending" }
            ]
          }
        });

        const complete = await a.inject({
          method: "POST",
          url: "/api/overmind/complete",
          remoteAddress: "127.0.0.1",
          payload: { token: OVERMIND_TOKEN, session: "hris-partial-coord" }
        });

        expect(complete.statusCode).toBe(200);
        expect(complete.json().workflow.status).toBe("completed");
        expect(tmux.sendAndSubmit).toHaveBeenCalledOnce();
        const [target, msg] = (tmux.sendAndSubmit as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(target).toBe("hris-partial-coord");
        // must include kill-session line
        expect(msg).toContain("child-alive-x");
        expect(msg).toContain("kill-session");
        // must include task-list ask with both not-done ids
        expect(msg).toContain("T2");
        expect(msg).toContain("T3");
        expect(msg).toContain("/api/overmind/tasks");
        // must be single-line
        expect(msg).not.toContain("\n");
      } finally {
        await a.close();
      }
    });

    it("(b) no alive children + not-all-tasks-done → sendAndSubmit fires with ONLY the task-list ask", async () => {
      const tmux = makeTmuxMock(new Set()); // no alive children
      const a = await buildAppWithTmux(tmux);
      try {
        await a.inject({
          method: "POST",
          url: "/api/overmind/register",
          remoteAddress: "127.0.0.1",
          payload: {
            token: OVERMIND_TOKEN,
            label: "hris-no-children-partial",
            session: "hris-ncp-coord",
            child_sessions: ["child-dead-x"],
            run_dir: "/tmp/hris-ncp",
            tasks: [
              { id: "X1", label: "Done", state: "done" },
              { id: "X2", label: "Not done", state: "processing" }
            ]
          }
        });

        const complete = await a.inject({
          method: "POST",
          url: "/api/overmind/complete",
          remoteAddress: "127.0.0.1",
          payload: { token: OVERMIND_TOKEN, session: "hris-ncp-coord" }
        });

        expect(complete.statusCode).toBe(200);
        expect(complete.json().workflow.status).toBe("completed");
        expect(tmux.sendAndSubmit).toHaveBeenCalledOnce();
        const [target, msg] = (tmux.sendAndSubmit as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(target).toBe("hris-ncp-coord");
        // must include task-list ask
        expect(msg).toContain("X2");
        expect(msg).toContain("/api/overmind/tasks");
        // must NOT include kill-session (no alive children)
        expect(msg).not.toContain("kill-session");
        expect(msg).not.toContain("child-dead-x");
        // must be single-line
        expect(msg).not.toContain("\n");
      } finally {
        await a.close();
      }
    });

    it("(c) alive child + all-tasks-done → sendAndSubmit fires with ONLY the kill-session ask (no task-list line)", async () => {
      const tmux = makeTmuxMock(new Set(["child-alive-y"]));
      const a = await buildAppWithTmux(tmux);
      try {
        await a.inject({
          method: "POST",
          url: "/api/overmind/register",
          remoteAddress: "127.0.0.1",
          payload: {
            token: OVERMIND_TOKEN,
            label: "hris-all-done",
            session: "hris-ad-coord",
            child_sessions: ["child-alive-y"],
            run_dir: "/tmp/hris-ad",
            tasks: [
              { id: "Y1", label: "Done 1", state: "done" },
              { id: "Y2", label: "Done 2", state: "done" }
            ]
          }
        });

        const complete = await a.inject({
          method: "POST",
          url: "/api/overmind/complete",
          remoteAddress: "127.0.0.1",
          payload: { token: OVERMIND_TOKEN, session: "hris-ad-coord" }
        });

        expect(complete.statusCode).toBe(200);
        expect(complete.json().workflow.status).toBe("completed");
        expect(tmux.sendAndSubmit).toHaveBeenCalledOnce();
        const [target, msg] = (tmux.sendAndSubmit as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(target).toBe("hris-ad-coord");
        // must include kill-session
        expect(msg).toContain("child-alive-y");
        expect(msg).toContain("kill-session");
        // must NOT include the task-list ask
        expect(msg).not.toContain("/api/overmind/tasks");
        // must be single-line
        expect(msg).not.toContain("\n");
      } finally {
        await a.close();
      }
    });

    it("(d) no alive children + all tasks done → NO sendAndSubmit at all", async () => {
      const tmux = makeTmuxMock(new Set()); // all dead
      const a = await buildAppWithTmux(tmux);
      try {
        await a.inject({
          method: "POST",
          url: "/api/overmind/register",
          remoteAddress: "127.0.0.1",
          payload: {
            token: OVERMIND_TOKEN,
            label: "hris-all-done-no-children",
            session: "hris-adnc-coord",
            child_sessions: ["child-dead-z"],
            run_dir: "/tmp/hris-adnc",
            tasks: [
              { id: "Z1", label: "Done", state: "done" }
            ]
          }
        });

        const complete = await a.inject({
          method: "POST",
          url: "/api/overmind/complete",
          remoteAddress: "127.0.0.1",
          payload: { token: OVERMIND_TOKEN, session: "hris-adnc-coord" }
        });

        expect(complete.statusCode).toBe(200);
        expect(complete.json().workflow.status).toBe("completed");
        expect(tmux.sendAndSubmit).not.toHaveBeenCalled();
      } finally {
        await a.close();
      }
    });
  });

  it("requires JWT auth for OVM session manager endpoints and delegates to the manager", async () => {
    const unauthenticated = await app.inject({
      method: "GET",
      url: "/api/overmind/ovm/status"
    });
    expect(unauthenticated.statusCode).toBe(401);

    const headers = authHeader();

    const status = await app.inject({
      method: "GET",
      url: "/api/overmind/ovm/status",
      headers
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toEqual({
      open: true,
      status: "open",
      since: "2026-05-21T00:00:00.000Z"
    });

    const opened = await app.inject({
      method: "POST",
      url: "/api/overmind/ovm/open",
      headers
    });
    expect(opened.statusCode).toBe(200);
    expect(opened.json()).toMatchObject({ open: true, status: "open", opened: true });

    const restarted = await app.inject({
      method: "POST",
      url: "/api/overmind/ovm/restart",
      headers
    });
    expect(restarted.statusCode).toBe(200);
    expect(restarted.json()).toMatchObject({ open: true, status: "open", restarted: true });

    const closed = await app.inject({
      method: "POST",
      url: "/api/overmind/ovm/close",
      headers
    });
    expect(closed.statusCode).toBe(200);
    expect(closed.json()).toEqual({ open: false, status: "closed", closed: true });

    expect(ovmSession.status).toHaveBeenCalledOnce();
    expect(ovmSession.open).toHaveBeenCalledOnce();
    expect(ovmSession.restart).toHaveBeenCalledOnce();
    expect(ovmSession.close).toHaveBeenCalledOnce();
  });

  it("GET /api/overmind/runs requires JWT, returns terminal-only run summaries with correct shape", async () => {
    // register active + completed + failed workflows
    const activeReg = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      label: "runs-active",
      session: "runs-active-parent",
      run_dir: "/tmp/runs-active",
      tasks: [{ id: "T1", label: "Task 1", state: "processing" }]
    });
    expect(activeReg.statusCode).toBe(201);

    const compReg = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      label: "runs-completed",
      session: "runs-comp-parent",
      run_dir: "/tmp/runs-completed",
      tasks: [
        { id: "A1", label: "Task A", state: "done" },
        { id: "A2", label: "Task B", state: "done" }
      ]
    });
    expect(compReg.statusCode).toBe(201);
    await lifecyclePost("/api/overmind/complete", {
      token: OVERMIND_TOKEN,
      session: "runs-comp-parent"
    });

    const failedReg = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      label: "runs-failed",
      session: "runs-failed-parent",
      run_dir: "/tmp/runs-failed",
      tasks: [{ id: "F1", label: "Task F", state: "pending" }]
    });
    expect(failedReg.statusCode).toBe(201);
    overmindService.setStatus(failedReg.json().workflow.id, "failed");

    // unauthenticated is rejected
    const unauthenticated = await app.inject({
      method: "GET",
      url: "/api/overmind/runs"
    });
    expect(unauthenticated.statusCode).toBe(401);

    const headers = authHeader();
    const response = await app.inject({
      method: "GET",
      url: "/api/overmind/runs",
      headers
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(Array.isArray(body.runs)).toBe(true);

    // only terminal workflows returned
    const sessions = body.runs.map((r: { coordinator_session: string }) => r.coordinator_session);
    expect(sessions).not.toContain("runs-active-parent");
    expect(sessions).toContain("runs-comp-parent");
    expect(sessions).toContain("runs-failed-parent");

    // each run has the expected shape
    for (const run of body.runs) {
      expect(run).toHaveProperty("id");
      expect(run).toHaveProperty("label");
      expect(run).toHaveProperty("display_name");
      expect(run).toHaveProperty("coordinator_session");
      expect(run).toHaveProperty("status");
      expect(run).toHaveProperty("run_started_at");
      expect(run).toHaveProperty("ended_at");
      expect(run).toHaveProperty("total_tasks");
      expect(run).toHaveProperty("done_tasks");
    }

    // completed run has correct done_tasks / total_tasks
    const compRun = body.runs.find((r: { coordinator_session: string }) => r.coordinator_session === "runs-comp-parent");
    expect(compRun.total_tasks).toBe(2);
    expect(compRun.done_tasks).toBe(2);
    expect(compRun.status).toBe("completed");
  });

  it("GET /api/overmind/history?session=X filters to that session only", async () => {
    // set up two workflows with task transitions
    await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      label: "hist-filter-1",
      session: "hist-filter-s1",
      run_dir: "/tmp/hist-filter-1",
      current_task: "T1",
      tasks: [{ id: "A1", label: "A1", state: "processing" }]
    });
    await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      label: "hist-filter-2",
      session: "hist-filter-s2",
      run_dir: "/tmp/hist-filter-2",
      current_task: "T2",
      tasks: [{ id: "B1", label: "B1", state: "processing" }]
    });

    // create task transitions for both
    await lifecyclePost("/api/overmind/tasks", {
      token: OVERMIND_TOKEN,
      session: "hist-filter-s1",
      current_task: "T1-done",
      tasks: [{ id: "A1", label: "A1", state: "done" }]
    });
    await lifecyclePost("/api/overmind/tasks", {
      token: OVERMIND_TOKEN,
      session: "hist-filter-s2",
      current_task: "T2-done",
      tasks: [{ id: "B1", label: "B1", state: "done" }]
    });

    const headers = authHeader();

    // unfiltered returns all
    const allHistory = await app.inject({
      method: "GET",
      url: "/api/overmind/history",
      headers
    });
    expect(allHistory.statusCode).toBe(200);
    expect(allHistory.json().history.length).toBe(2);

    // filtered to session 1
    const filtered = await app.inject({
      method: "GET",
      url: "/api/overmind/history?session=hist-filter-s1",
      headers
    });
    expect(filtered.statusCode).toBe(200);
    const filteredHistory = filtered.json().history;
    expect(filteredHistory.length).toBe(1);
    expect(filteredHistory[0].coordinator_session).toBe("hist-filter-s1");

    // filtered to nonexistent session
    const noMatch = await app.inject({
      method: "GET",
      url: "/api/overmind/history?session=nonexistent",
      headers
    });
    expect(noMatch.statusCode).toBe(200);
    expect(noMatch.json().history).toHaveLength(0);
  });
});
