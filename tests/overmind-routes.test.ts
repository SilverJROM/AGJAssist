import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import { DatabaseService } from "../src/db/database.js";
import { AuthService } from "../src/auth/auth-service.js";
import { OvermindService } from "../src/services/overmind-service.js";
import { registerOvermindRoutes } from "../src/api/routes/overmind-routes.js";
import { AppConfig } from "../src/config/config.js";
import { OvmSessionManager } from "../src/services/ovm-session.js";
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
    llm: {
      ollamaBaseUrl: "http://127.0.0.1:11434",
      ollamaModel: "test",
      ollamaTimeoutMs: 1000,
      openrouterApiKey: "test",
      openrouterBaseUrl: "https://openrouter.ai/api/v1",
      openrouterModel: "test",
      openrouterTimeoutMs: 1000
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
    close: vi.fn(async () => ({ open: false, status: "closed", closed: true }))
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
});
