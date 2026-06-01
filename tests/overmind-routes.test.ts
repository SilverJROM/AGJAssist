import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import { DatabaseService } from "../src/db/database.js";
import { AuthService } from "../src/auth/auth-service.js";
import { OvermindService } from "../src/services/overmind-service.js";
import { registerOvermindRoutes } from "../src/api/routes/overmind-routes.js";
import * as agentPane from "../src/services/overmind/agent-pane.js";
import { AppConfig } from "../src/config/config.js";
import { OvmSessionManager } from "../src/services/ovm-session.js";
import type { TmuxService } from "../src/tmux/tmux-service.js";
import { NudgeStateService } from "../src/services/nudge-state-service.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

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
let tempProjectDirs: string[] = [];

function authHeader(): { authorization: string } {
  const loginCode = authService.generateLoginCode(111222);
  const auth = authService.authenticateWithCode(loginCode);
  expect(auth).not.toBeNull();
  return { authorization: `Bearer ${auth!.token}` };
}

function viewerAuthHeader(): { authorization: string } {
  authService.addUser(333444, "viewer");
  const loginCode = authService.generateLoginCode(333444);
  const auth = authService.authenticateWithCode(loginCode);
  expect(auth).not.toBeNull();
  return { authorization: `Bearer ${auth!.token}` };
}

function tempProjectPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "overmind-project-"));
  tempProjectDirs.push(dir);
  return dir;
}

beforeEach(async () => {
  cleanup();
  tempProjectDirs = [];
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
  vi.restoreAllMocks();
  for (const dir of tempProjectDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  cleanup();
});

describe("Overmind routes", () => {
  it("creates overmind projects with owner JWT only and forces created_by to JROM", async () => {
    const appPath = tempProjectPath();
    const created = await app.inject({
      method: "POST",
      url: "/api/overmind/projects",
      headers: authHeader(),
      payload: {
        slug: "agjassist",
        app_path: appPath,
        parent_session: "AGJ-51",
        notes: "Primary AGJAssist run",
        created_by: "projcore"
      }
    });

    expect(created.statusCode).toBe(201);
    expect(created.json().project).toMatchObject({
      slug: "agjassist",
      app_path: appPath,
      parent_session: "AGJ-51",
      notes: "Primary AGJAssist run",
      created_by: "JROM"
    });
    expect(overmindService.getProjectBySlug("agjassist")?.created_by).toBe("JROM");

    const duplicateSlug = await app.inject({
      method: "POST",
      url: "/api/overmind/projects",
      headers: authHeader(),
      payload: {
        slug: "agjassist",
        app_path: tempProjectPath(),
        parent_session: "AGJ-99"
      }
    });
    expect(duplicateSlug.statusCode).toBe(409);

    const duplicateAppPath = await app.inject({
      method: "POST",
      url: "/api/overmind/projects",
      headers: authHeader(),
      payload: {
        slug: "agjassist-copy",
        app_path: appPath,
        parent_session: "AGJ-99"
      }
    });
    expect(duplicateAppPath.statusCode).toBe(409);
  });

  it("rejects overmind project creation for loopback token, viewer JWT, missing auth, and invalid app_path", async () => {
    const payload = {
      slug: "blocked",
      app_path: tempProjectPath(),
      parent_session: "AGJ-51"
    };
    const forbidden = { error: "projects are JROM-managed; ask JROM to create via dashboard" };

    const loopbackOnly = await app.inject({
      method: "POST",
      url: "/api/overmind/projects",
      remoteAddress: "127.0.0.1",
      headers: {
        "x-overmind-token": OVERMIND_TOKEN
      },
      payload
    });
    expect(loopbackOnly.statusCode).toBe(403);
    expect(loopbackOnly.json()).toEqual(forbidden);

    const viewer = await app.inject({
      method: "POST",
      url: "/api/overmind/projects",
      headers: viewerAuthHeader(),
      payload: {
        ...payload,
        slug: "viewer-blocked"
      }
    });
    expect(viewer.statusCode).toBe(403);
    expect(viewer.json()).toEqual(forbidden);

    const noAuth = await app.inject({
      method: "POST",
      url: "/api/overmind/projects",
      payload: {
        ...payload,
        slug: "no-auth-blocked"
      }
    });
    expect(noAuth.statusCode).toBe(401);

    const relativePath = await app.inject({
      method: "POST",
      url: "/api/overmind/projects",
      headers: authHeader(),
      payload: {
        slug: "relative",
        app_path: "relative/path",
        parent_session: "AGJ-51"
      }
    });
    expect(relativePath.statusCode).toBe(400);

    const missingPath = await app.inject({
      method: "POST",
      url: "/api/overmind/projects",
      headers: authHeader(),
      payload: {
        slug: "missing",
        app_path: path.join(os.tmpdir(), "overmind-project-missing-b12d"),
        parent_session: "AGJ-51"
      }
    });
    expect(missingPath.statusCode).toBe(400);
  });

  it("reads overmind projects with loopback token or viewer JWT and includes active_runs_count", async () => {
    const first = overmindService.createProject({
      slug: "agjassist",
      app_path: tempProjectPath(),
      parent_session: "AGJ-51",
      notes: "Primary project"
    });
    overmindService.createProject({
      slug: "receiptbot",
      app_path: tempProjectPath(),
      parent_session: "RS-1",
      notes: null
    });

    db.prepare(
      `INSERT INTO overmind_workflows (project_id, label, coordinator_session, run_dir, status, tasks)
       VALUES (?, 'active-run', 'AGJ-51', '/tmp/agjassist/active', 'active', '[]')`
    ).run(first.id);
    db.prepare(
      `INSERT INTO overmind_workflows (project_id, label, coordinator_session, run_dir, status, tasks)
       VALUES (?, 'working-run', 'AGJ-52', '/tmp/agjassist/working', 'working', '[]')`
    ).run(first.id);
    db.prepare(
      `INSERT INTO overmind_workflows (project_id, label, coordinator_session, run_dir, status, tasks)
       VALUES (?, 'done-run', 'AGJ-53', '/tmp/agjassist/done', 'completed', '[]')`
    ).run(first.id);

    const loopbackList = await app.inject({
      method: "GET",
      url: "/api/overmind/projects",
      remoteAddress: "127.0.0.1",
      headers: {
        "x-overmind-token": OVERMIND_TOKEN
      }
    });
    expect(loopbackList.statusCode).toBe(200);
    expect(loopbackList.json().projects).toEqual([
      expect.objectContaining({ slug: "agjassist", active_runs_count: 2 }),
      expect.objectContaining({ slug: "receiptbot", active_runs_count: 0 })
    ]);

    const viewerOne = await app.inject({
      method: "GET",
      url: "/api/overmind/projects/agjassist",
      headers: viewerAuthHeader()
    });
    expect(viewerOne.statusCode).toBe(200);
    expect(viewerOne.json().project).toMatchObject({
      slug: "agjassist",
      active_runs_count: 2
    });

    const missing = await app.inject({
      method: "GET",
      url: "/api/overmind/projects/missing",
      headers: viewerAuthHeader()
    });
    expect(missing.statusCode).toBe(404);

    const noAuth = await app.inject({
      method: "GET",
      url: "/api/overmind/projects"
    });
    expect(noAuth.statusCode).toBe(401);
  });

  it("patches overmind projects only for owner JWT and keeps slug/app_path immutable", async () => {
    const project = overmindService.createProject({
      slug: "agjassist",
      app_path: tempProjectPath(),
      parent_session: "AGJ-51",
      notes: "Before"
    });

    const patched = await app.inject({
      method: "PATCH",
      url: "/api/overmind/projects/agjassist",
      headers: authHeader(),
      payload: {
        parent_session: "AGJ-99",
        notes: null
      }
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().project).toMatchObject({
      id: project.id,
      slug: "agjassist",
      app_path: project.app_path,
      parent_session: "AGJ-99",
      notes: null,
      active_runs_count: 0
    });

    const immutableSlug = await app.inject({
      method: "PATCH",
      url: "/api/overmind/projects/agjassist",
      headers: authHeader(),
      payload: {
        slug: "renamed",
        parent_session: "AGJ-100"
      }
    });
    expect(immutableSlug.statusCode).toBe(400);
    expect(overmindService.getProjectBySlug("agjassist")?.parent_session).toBe("AGJ-99");

    const immutableAppPath = await app.inject({
      method: "PATCH",
      url: "/api/overmind/projects/agjassist",
      headers: authHeader(),
      payload: {
        app_path: tempProjectPath(),
        notes: "blocked"
      }
    });
    expect(immutableAppPath.statusCode).toBe(400);

    const loopbackOnly = await app.inject({
      method: "PATCH",
      url: "/api/overmind/projects/agjassist",
      remoteAddress: "127.0.0.1",
      headers: {
        "x-overmind-token": OVERMIND_TOKEN
      },
      payload: {
        parent_session: "AGJ-100"
      }
    });
    expect(loopbackOnly.statusCode).toBe(403);

    const viewer = await app.inject({
      method: "PATCH",
      url: "/api/overmind/projects/agjassist",
      headers: viewerAuthHeader(),
      payload: {
        parent_session: "AGJ-100"
      }
    });
    expect(viewer.statusCode).toBe(403);

    const missing = await app.inject({
      method: "PATCH",
      url: "/api/overmind/projects/missing",
      headers: authHeader(),
      payload: {
        parent_session: "AGJ-100"
      }
    });
    expect(missing.statusCode).toBe(404);
  });

  it("guards overmind project delete with active runs and owner-only auth", async () => {
    const project = overmindService.createProject({
      slug: "agjassist",
      app_path: tempProjectPath(),
      parent_session: "AGJ-51",
      notes: null
    });
    const activeRun = db.prepare(
      `INSERT INTO overmind_workflows (project_id, label, coordinator_session, run_dir, status, tasks)
       VALUES (?, 'working-run', 'AGJ-51', '/tmp/agjassist/working', 'working', '[]')`
    ).run(project.id).lastInsertRowid as number;

    const loopbackOnly = await app.inject({
      method: "DELETE",
      url: "/api/overmind/projects/agjassist",
      remoteAddress: "127.0.0.1",
      headers: {
        "x-overmind-token": OVERMIND_TOKEN
      }
    });
    expect(loopbackOnly.statusCode).toBe(403);

    const viewer = await app.inject({
      method: "DELETE",
      url: "/api/overmind/projects/agjassist",
      headers: viewerAuthHeader()
    });
    expect(viewer.statusCode).toBe(403);

    const guarded = await app.inject({
      method: "DELETE",
      url: "/api/overmind/projects/agjassist",
      headers: authHeader()
    });
    expect(guarded.statusCode).toBe(409);
    expect(guarded.json()).toEqual({
      error: "project has active runs; complete or cancel them first",
      active_runs: 1
    });
    expect(overmindService.getProjectBySlug("agjassist")).not.toBeNull();

    overmindService.setStatus(activeRun, "completed");
    const deleted = await app.inject({
      method: "DELETE",
      url: "/api/overmind/projects/agjassist",
      headers: authHeader()
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ ok: true });
    expect(overmindService.getProjectBySlug("agjassist")).toBeNull();

    const missing = await app.inject({
      method: "DELETE",
      url: "/api/overmind/projects/agjassist",
      headers: authHeader()
    });
    expect(missing.statusCode).toBe(404);
  });

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
      // Same project tree as first (deeper sub-path) — required by the cross-project
      // upsert guard (JROM 2026-05-24).
      run_dir: "/tmp/lkcamp/rerun",
      tasks: [{ id: "t1", label: "Task 1", state: "pending" }]
    });

    expect(second.statusCode).toBe(201);
    const secondBody = second.json();
    expect(secondBody.workflow.id).toBe(firstBody.workflow.id);
    expect(secondBody.workflow.label).toBe("lkcamp rerun");
    expect(secondBody.workflow.status).toBe("active");
    expect(secondBody.workflow.child_sessions).toEqual(["lkcdx-may20", "lkcdx-extra"]);
    expect(overmindService.list()).toHaveLength(1);
  });

  it("attaches run_dir-only register requests to the matching overmind project and upserts by project/run_dir", async () => {
    const appPath = tempProjectPath();
    const runDir = path.join(appPath, "plans", "b12f", "run-1");
    fs.mkdirSync(runDir, { recursive: true });
    const project = overmindService.createProject({
      slug: "agjassist",
      app_path: appPath,
      parent_session: "AGJ-51",
      notes: null
    });

    const attached = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      run_dir: runDir
    });

    expect(attached.statusCode).toBe(201);
    const firstBody = attached.json();
    expect(firstBody.workflow_id).toBe(firstBody.workflow.id);
    expect(firstBody.project_id).toBe(project.id);
    expect(firstBody.project_slug).toBe("agjassist");
    expect(firstBody.parent_session).toBe("AGJ-51");
    expect(firstBody.workflow).toMatchObject({
      id: firstBody.workflow_id,
      project_id: project.id,
      label: "agjassist · run-1",
      coordinator_session: null,
      run_dir: fs.realpathSync(runDir)
    });

    const idempotent = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      run_dir: runDir
    });
    expect(idempotent.statusCode).toBe(201);
    expect(idempotent.json().workflow_id).toBe(firstBody.workflow_id);
    expect(overmindService.list()).toHaveLength(1);
  });

  it("records ok parent_status and no warning when attach parent_session is an agent pane", async () => {
    vi.spyOn(agentPane, "isAgentPane").mockResolvedValue("codex");
    const appPath = tempProjectPath();
    const runDir = path.join(appPath, "plans", "b12g", "agent-parent");
    fs.mkdirSync(runDir, { recursive: true });
    overmindService.createProject({
      slug: "agent-parent",
      app_path: appPath,
      parent_session: "AGJ-codex",
      notes: null
    });

    const attached = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      run_dir: runDir
    });

    expect(attached.statusCode).toBe(201);
    const body = attached.json();
    expect(body.parent_status).toBe("ok");
    expect(body.parent_warning).toBeUndefined();
    expect(body.workflow.parent_status).toBe("ok");
    expect(overmindService.get(body.workflow_id)?.parent_status).toBe("ok");
    expect(agentPane.isAgentPane).toHaveBeenCalledWith("AGJ-codex");
  });

  it("warns but still returns 201 when attach parent_session is bare-bash", async () => {
    vi.spyOn(agentPane, "isAgentPane").mockResolvedValue("bare-bash");
    const appPath = tempProjectPath();
    const runDir = path.join(appPath, "plans", "b12g", "bare-parent");
    fs.mkdirSync(runDir, { recursive: true });
    overmindService.createProject({
      slug: "bare-parent",
      app_path: appPath,
      parent_session: "AGJ-bare",
      notes: null
    });

    const attached = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      run_dir: runDir
    });

    expect(attached.statusCode).toBe(201);
    const body = attached.json();
    expect(body.parent_status).toBe("bare-bash");
    expect(body.parent_warning).toMatchObject({ code: "parent-session-bare-bash" });
    expect(body.workflow.parent_status).toBe("bare-bash");
    expect(overmindService.get(body.workflow_id)?.parent_status).toBe("bare-bash");
  });

  it("warns but still returns 201 when attach parent_session does not exist", async () => {
    vi.spyOn(agentPane, "isAgentPane").mockResolvedValue("no-session");
    const appPath = tempProjectPath();
    const runDir = path.join(appPath, "plans", "b12g", "missing-parent");
    fs.mkdirSync(runDir, { recursive: true });
    overmindService.createProject({
      slug: "missing-parent",
      app_path: appPath,
      parent_session: "AGJ-missing",
      notes: null
    });

    const attached = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      run_dir: runDir
    });

    expect(attached.statusCode).toBe(201);
    const body = attached.json();
    expect(body.parent_status).toBe("no-session");
    expect(body.parent_warning).toMatchObject({ code: "parent-session-no-session" });
    expect(body.workflow.parent_status).toBe("no-session");
    expect(overmindService.get(body.workflow_id)?.parent_status).toBe("no-session");
  });

  it("keeps attach registration non-fatal when the parent warn-check throws", async () => {
    vi.spyOn(agentPane, "isAgentPane").mockRejectedValue(new Error("tmux unavailable"));
    const appPath = tempProjectPath();
    const runDir = path.join(appPath, "plans", "b12g", "unknown-parent");
    fs.mkdirSync(runDir, { recursive: true });
    overmindService.createProject({
      slug: "unknown-parent",
      app_path: appPath,
      parent_session: "AGJ-unknown",
      notes: null
    });

    const attached = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      run_dir: runDir
    });

    expect(attached.statusCode).toBe(201);
    const body = attached.json();
    expect(body.parent_status).toBe("unknown");
    expect(body.parent_warning).toBeUndefined();
    expect(body.workflow.parent_status).toBe("unknown");
    expect(overmindService.get(body.workflow_id)?.parent_status).toBe("unknown");
  });

  it("returns 404 with searched_up_to when run_dir-only register has no containing project", async () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "overmind-no-project-"));
    tempProjectDirs.push(runDir);

    const rejected = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      run_dir: runDir
    });

    expect(rejected.statusCode).toBe(404);
    expect(rejected.json()).toEqual({
      error: "no-project-for-run-dir",
      run_dir: fs.realpathSync(runDir),
      searched_up_to: path.parse(runDir).root,
      hint: "Ask JROM to create a project for the containing app via POST /api/overmind/projects, then re-register."
    });
  });

  it("rejects derived fields on run_dir-only register without blocking legacy register", async () => {
    const appPath = tempProjectPath();
    const runDir = path.join(appPath, "run-forbidden");
    fs.mkdirSync(runDir, { recursive: true });
    overmindService.createProject({
      slug: "forbidden",
      app_path: appPath,
      parent_session: "AGJ-51",
      notes: null
    });

    const forbidden = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      run_dir: runDir,
      label: "hack"
    });
    expect(forbidden.statusCode).toBe(422);
    expect(forbidden.json()).toEqual({
      error: "forbidden-derived-field",
      field: "label"
    });

    const legacy = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      label: "legacy still works",
      session: "legacy-b12f",
      run_dir: "/tmp/legacy-b12f",
      tasks: [{ id: "B12f", label: "Legacy", state: "processing" }]
    });
    expect(legacy.statusCode).toBe(201);
    expect(legacy.json().workflow.coordinator_session).toBe("legacy-b12f");
  });

  it("rejects /register with 400 when a NEW parent session omits tasks or sends an empty tasks array (JROM 2026-05-24)", async () => {
    const noTasks = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      label: "ProjectX",
      session: "px-new",
      run_dir: "/tmp/projectx-no-tasks"
      // intentionally NO tasks — this test asserts the 400
    });
    expect(noTasks.statusCode).toBe(400);
    expect(noTasks.json().error).toContain("non-empty `tasks` array");

    const emptyTasks = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      label: "ProjectY",
      session: "py-new",
      run_dir: "/tmp/projecty-empty-tasks",
      tasks: []
    });
    expect(emptyTasks.statusCode).toBe(400);

    // Same-session re-register without tasks is allowed — it's a check-in, not a start.
    const initial = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      label: "ProjectZ",
      session: "pz-checkin",
      run_dir: "/tmp/projectz-checkin",
      tasks: [{ id: "T1", label: "Initial", state: "processing" }]
    });
    expect(initial.statusCode).toBe(201);
    const reregister = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      label: "ProjectZ updated",
      session: "pz-checkin",
      run_dir: "/tmp/projectz-checkin",
      child_sessions: ["child-new"]
      // intentionally NO tasks — testing that existing tasks are preserved on upsert
    });
    expect(reregister.statusCode).toBe(201);
    // Existing tasks preserved (destructive-overwrite safeguard).
    expect(reregister.json().workflow.tasks).toEqual([
      { id: "T1", label: "Initial", state: "processing" }
    ]);
  });

  it("rejects /register with 409 when a re-register against an existing coord session points at a different project tree (cross-project upsert guard — JROM 2026-05-24)", async () => {
    // First register: AGJ-51 tracking AGJassist work
    const first = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      label: "AGJAssist chat decom",
      session: "AGJ-51",
      run_dir: "/home/agjrom/TGBOTS/AGJAssist/plan/WK_0519/chat-notes",
      tasks: [{ id: "T1", label: "B1", state: "processing" }]
    });
    expect(first.statusCode).toBe(201);

    // Same session, completely different project tree → must reject
    const crossProject = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      label: "receiptbot",
      session: "AGJ-51",
      run_dir: "/home/agjrom/TGBOTS/RS/plan/WK_0518/vat-decontam",
      tasks: [{ id: "R1", label: "math validation rewrite", state: "processing" }]
    });
    expect(crossProject.statusCode).toBe(409);
    const body = crossProject.json();
    expect(body.existing_session_tracks.coordinator_session).toBe("AGJ-51");
    expect(body.existing_session_tracks.label).toBe("AGJAssist chat decom");
    expect(body.error).toContain("DIFFERENT project tree");

    // The existing row was NOT clobbered.
    const row = overmindService.get(first.json().workflow.id);
    expect(row?.label).toBe("AGJAssist chat decom");
    expect(row?.run_dir).toBe("/home/agjrom/TGBOTS/AGJAssist/plan/WK_0519/chat-notes");

    // Same session, deeper sub-path within the SAME project tree → still allowed (upsert).
    const sameProject = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      label: "AGJAssist chat decom (deeper)",
      session: "AGJ-51",
      run_dir: "/home/agjrom/TGBOTS/AGJAssist/plan/WK_0519/chat-notes/projcore-run-2026-05-22",
      tasks: [{ id: "T1", label: "B1", state: "done" }, { id: "T2", label: "B2", state: "processing" }]
    });
    expect(sameProject.statusCode).toBe(201);
  });

  it("rejects /register with 409 + use_existing when a different coordinator_session matches the same project tree", async () => {
    const first = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      label: "HRIS · trapprove",
      session: "hris-d-22",
      run_dir: "/home/agjrom/websites/HRIS",
      tasks: [{ id: "t1", label: "Task 1", state: "pending" }]
    });
    expect(first.statusCode).toBe(201);

    const dup = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      label: "HRIS · trapprove",
      session: "hris-claude-main",
      run_dir: "/home/agjrom/websites/HRIS/anything-new",
      tasks: [{ id: "t1", label: "Task 1", state: "pending" }]
    });
    expect(dup.statusCode).toBe(409);
    const body = dup.json();
    expect(body.use_existing.coordinator_session).toBe("hris-d-22");
    expect(body.use_existing.id).toBe(first.json().workflow.id);
    expect(body.error).toContain("one workflow per project tree");

    // Only one workflow row exists — the duplicate did not persist.
    expect(overmindService.list()).toHaveLength(1);
  });

  it("allows registration when no project-tree match exists", async () => {
    const first = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      label: "AGJAssist",
      session: "agjassist-parent",
      run_dir: "/tmp/project-alpha",
      tasks: [{ id: "t1", label: "Task 1", state: "pending" }]
    });
    expect(first.statusCode).toBe(201);

    const second = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      label: "Different project",
      session: "other-parent",
      run_dir: "/tmp/project-beta",
      tasks: [{ id: "t1", label: "Task 1", state: "pending" }]
    });
    expect(second.statusCode).toBe(201);
    expect(overmindService.list()).toHaveLength(2);
  });

  it("rejects /register with 409 even when the matching workflow is completed", async () => {
    const first = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      label: "HRIS completed",
      session: "hris-completed-parent",
      run_dir: "/tmp/hris-completed-root",
      tasks: [{ id: "t1", label: "Task 1", state: "pending" }]
    });
    expect(first.statusCode).toBe(201);

    const markCompleted = await lifecyclePost("/api/overmind/complete", {
      token: OVERMIND_TOKEN,
      session: "hris-completed-parent"
    });
    expect(markCompleted.statusCode).toBe(200);
    expect(markCompleted.json().workflow.status).toBe("completed");

    const dup = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      label: "HRIS completed retry",
      session: "hris-other-parent",
      run_dir: "/tmp/hris-completed-root/new-slice",
      tasks: [{ id: "t1", label: "Task 1", state: "pending" }]
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().use_existing.coordinator_session).toBe("hris-completed-parent");
    expect(overmindService.list()).toHaveLength(1);
  });

  describe("register corrective advice tmux send", () => {
    function makeRegisterTmuxMock(aliveIncoming: boolean): TmuxService {
      return {
        sessionExists: vi.fn(async (target: string) => {
          // owner-parent is always alive (the OWNING workflow's session — must pass
          // the new /register session-existence validation, JROM 2026-05-24).
          if (target === "owner-parent") return true;
          if (target === "bad-parent") return aliveIncoming;
          return false;
        }),
        sendAndSubmit: vi.fn(async () => true),
        sendCommand: vi.fn(async () => ({ message: "sent", blocked: false })),
        capturePane: vi.fn(async () => "")
      } as unknown as TmuxService;
    }

    async function buildAppWithRegisterTmux(tmuxMock: TmuxService, nudgeState: NudgeStateService): Promise<FastifyInstance> {
      const a = Fastify({ logger: false });
      registerOvermindRoutes(
        a,
        testConfig(),
        authService,
        overmindService,
        undefined,
        undefined,
        ovmSession,
        tmuxMock,
        nudgeState
      );
      await a.ready();
      return a;
    }

    it("sends corrective advice via sendAndSubmit when the incoming coordinator_session is alive", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agj-register-advice-live-"));
      const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
      fs.mkdirSync(path.join(tmpDir, "data"), { recursive: true });
      const nudgeState = new NudgeStateService();
      await nudgeState.load();

      const tmux = makeRegisterTmuxMock(true);
      const a = await buildAppWithRegisterTmux(tmux, nudgeState);
      try {
        await a.inject({
          method: "POST",
          url: "/api/overmind/register",
          remoteAddress: "127.0.0.1",
          payload: {
            token: OVERMIND_TOKEN,
            label: "owner",
            session: "owner-parent",
            run_dir: "/tmp/register-owner-root",
tasks: [{ id: "t1", label: "Task 1", state: "pending" }]
}
        });

        const dup = await a.inject({
          method: "POST",
          url: "/api/overmind/register",
          remoteAddress: "127.0.0.1",
          payload: {
            token: OVERMIND_TOKEN,
            label: "dup",
            session: "bad-parent",
            run_dir: "/tmp/register-owner-root/new-phase",
tasks: [{ id: "t1", label: "Task 1", state: "pending" }]
}
        });

        expect(dup.statusCode).toBe(409);
        expect(tmux.sendAndSubmit).toHaveBeenCalledTimes(1);
        const [target, msg] = (tmux.sendAndSubmit as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string];
        expect(target).toBe("bad-parent");
        expect(msg).toContain("Please use that session name");
      } finally {
        await a.close();
        cwdSpy.mockRestore();
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("400-rejects (BEFORE the project-tree check) when the incoming coordinator_session is not alive — no corrective tmux send (JROM 2026-05-24 validation)", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agj-register-advice-dead-"));
      const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
      fs.mkdirSync(path.join(tmpDir, "data"), { recursive: true });
      const nudgeState = new NudgeStateService();
      await nudgeState.load();

      const tmux = makeRegisterTmuxMock(false);
      const a = await buildAppWithRegisterTmux(tmux, nudgeState);
      try {
        await a.inject({
          method: "POST",
          url: "/api/overmind/register",
          remoteAddress: "127.0.0.1",
          payload: {
            token: OVERMIND_TOKEN,
            label: "owner",
            session: "owner-parent",
            run_dir: "/tmp/register-owner-root-2",
tasks: [{ id: "t1", label: "Task 1", state: "pending" }]
}
        });

        const dup = await a.inject({
          method: "POST",
          url: "/api/overmind/register",
          remoteAddress: "127.0.0.1",
          payload: {
            token: OVERMIND_TOKEN,
            label: "dup",
            session: "bad-parent",
            run_dir: "/tmp/register-owner-root-2/new-phase",
tasks: [{ id: "t1", label: "Task 1", state: "pending" }]
}
        });

        // A dead incoming coordinator_session is now rejected at the
        // session-existence guard with 400 — short-circuits before the
        // project-tree match even runs, so no corrective tmux send is attempted.
        expect(dup.statusCode).toBe(400);
        expect(dup.json().error).toContain("not an alive tmux session");
        expect(tmux.sendAndSubmit).not.toHaveBeenCalled();
      } finally {
        await a.close();
        cwdSpy.mockRestore();
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
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

  it("addresses lifecycle updates by workflow_id and run_dir without session, while preserving legacy session fallback", async () => {
    const reg = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      label: "identity-route",
      session: "identity-session",
      run_dir: "/tmp/overmind/identity-route",
      current_task: "Start",
      tasks: [{ id: "B12c", label: "Identity", state: "processing" }]
    });
    expect(reg.statusCode).toBe(201);
    const workflowId = reg.json().workflow.id;

    const byId = await lifecyclePost("/api/overmind/tasks", {
      token: OVERMIND_TOKEN,
      workflow_id: workflowId,
      run_dir: "/tmp/overmind/identity-route",
      current_task: "By id",
      tasks: [{ id: "B12c", label: "Identity", state: "done" }]
    });
    expect(byId.statusCode).toBe(200);
    expect(byId.json().workflow.current_task).toBe("By id");
    expect(byId.json().workflow.tasks[0].state).toBe("done");

    const children = await lifecyclePost("/api/overmind/children", {
      token: OVERMIND_TOKEN,
      workflow_id: workflowId,
      run_dir: "/tmp/overmind/identity-route",
      child_sessions: ["identity-child"],
      child_roles: ["tester"]
    });
    expect(children.statusCode).toBe(200);
    expect(children.json().workflow.child_sessions).toEqual(["identity-child"]);
    expect(children.json().workflow.child_roles).toEqual(["tester"]);

    const byRunDir = await lifecyclePost("/api/overmind/complete", {
      token: OVERMIND_TOKEN,
      run_dir: "/tmp/overmind/identity-route"
    });
    expect(byRunDir.statusCode).toBe(200);
    expect(byRunDir.json().workflow.status).toBe("completed");

    const legacy = await lifecyclePost("/api/overmind/tasks", {
      token: OVERMIND_TOKEN,
      session: "identity-session",
      current_task: "Legacy session fallback",
      tasks: [{ id: "B12c", label: "Identity", state: "done" }]
    });
    expect(legacy.statusCode).toBe(200);
    expect(legacy.json().workflow.current_task).toBe("Legacy session fallback");
  });

  it("resolves project parent_session by workflow project_id", async () => {
    db.prepare(`
      INSERT INTO overmind_projects (slug, app_path, parent_session)
      VALUES ('parent-route', '/tmp/overmind/parent-route-app', 'AGJ-51')
    `).run();
    const project = db.prepare("SELECT id FROM overmind_projects WHERE slug = 'parent-route'").get() as { id: number };
    const workflow = overmindService.register({
      label: "parent-route",
      coordinator_session: "parent-route-session",
      run_dir: "/tmp/overmind/parent-route-app/run",
      tasks: [{ id: "B12c", label: "Identity", state: "processing" }]
    });
    db.prepare("UPDATE overmind_workflows SET project_id = ? WHERE id = ?").run(project.id, workflow.id);

    expect(overmindService.getParentSessionForWorkflow(workflow.id)).toBe("AGJ-51");
  });

  it("rejects lifecycle requests with missing or invalid token and non-loopback source", async () => {
    const missingToken = await lifecyclePost("/api/overmind/register", {
      label: "bad",
      session: "bad-1",
      run_dir: "/tmp/bad",
      tasks: [{ id: "t1", label: "Task 1", state: "pending" }]
    });
    expect(missingToken.statusCode).toBe(401);

    const badToken = await lifecyclePost("/api/overmind/register", {
      token: "wrong",
      label: "bad",
      session: "bad-1",
      run_dir: "/tmp/bad",
      tasks: [{ id: "t1", label: "Task 1", state: "pending" }]
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
        run_dir: "/tmp/bad",
tasks: [{ id: "t1", label: "Task 1", state: "pending" }]
}
    });
    expect(nonLoopback.statusCode).toBe(403);
  });

  it("completes workflows and updates tasklists by session", async () => {
    await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      label: "hris",
      session: "hris-d-22",
      run_dir: "/tmp/hris",
      tasks: [{ id: "t1", label: "Task 1", state: "pending" }]
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
      run_dir: "/tmp/ovm-controls",
      tasks: [{ id: "t1", label: "Task 1", state: "pending" }]
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

  it("DELETE /api/overmind/workflows/:id also forgets persisted nudge-state entries", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agj-route-nudge-delete-"));
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
    fs.mkdirSync(path.join(tmpDir, "data"), { recursive: true });

    const nudgeState = new NudgeStateService();
    await nudgeState.load();

    const appWithNudge = Fastify({ logger: false });
    registerOvermindRoutes(
      appWithNudge,
      testConfig(),
      authService,
      overmindService,
      undefined,
      undefined,
      ovmSession,
      undefined,
      nudgeState
    );
    await appWithNudge.ready();

    try {
      const registered = await appWithNudge.inject({
        method: "POST",
        url: "/api/overmind/register",
        remoteAddress: "127.0.0.1",
        payload: {
          token: OVERMIND_TOKEN,
          label: "nudge-delete",
          session: "nudge-delete-parent",
          run_dir: "/tmp/nudge-delete",
          tasks: [{ id: "t1", label: "Task 1", state: "pending" }]
        }
      });
      expect(registered.statusCode).toBe(201);
      const workflowId = registered.json().workflow.id as number;

      nudgeState.setLastIdleNudge(workflowId, Date.now() - 1_000);
      nudgeState.setLastAskUpdateNudge(workflowId, Date.now() - 2_000);
      nudgeState.setLastTaskStaleNudge(workflowId, Date.now() - 3_000);
      nudgeState.setLastReconcileAsk(workflowId, "gap:missing");

      const dropped = await appWithNudge.inject({
        method: "DELETE",
        url: `/api/overmind/workflows/${workflowId}`,
        remoteAddress: "127.0.0.1",
        payload: { token: OVERMIND_TOKEN }
      });
      expect(dropped.statusCode).toBe(200);
      expect(dropped.json()).toEqual({ ok: true });

      expect(nudgeState.getStateSnapshot().workflows[String(workflowId)]).toBeUndefined();
    } finally {
      await appWithNudge.close();
      cwdSpy.mockRestore();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("DELETE /api/overmind/workflows/:id accepts JWT-owner auth (no overmind token) for the dashboard delete button (JROM 2026-05-24)", async () => {
    const registered = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      label: "owner-delete",
      session: "owner-delete-parent",
      run_dir: "/tmp/owner-delete",
      tasks: [{ id: "t1", label: "Task 1", state: "pending" }]
    });
    const workflowId = registered.json().workflow.id as number;
    expect(overmindService.get(workflowId)).not.toBeNull();

    // JWT-owner DELETE (no body, no x-overmind-token).
    const dropped = await app.inject({
      method: "DELETE",
      url: `/api/overmind/workflows/${workflowId}`,
      headers: authHeader()
    });
    expect(dropped.statusCode).toBe(200);
    expect(dropped.json()).toEqual({ ok: true });
    expect(overmindService.get(workflowId)).toBeNull();
  });

  it("DELETE /api/overmind/workflows/:id rejects when neither JWT-owner nor token is provided", async () => {
    const registered = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      label: "unauth-delete",
      session: "unauth-delete-parent",
      run_dir: "/tmp/unauth-delete",
      tasks: [{ id: "t1", label: "Task 1", state: "pending" }]
    });
    const workflowId = registered.json().workflow.id as number;

    const noAuth = await app.inject({
      method: "DELETE",
      url: `/api/overmind/workflows/${workflowId}`
      // no headers, no body
    });
    expect(noAuth.statusCode).toBe(401);
    // Row still there
    expect(overmindService.get(workflowId)).not.toBeNull();
  });

  it("DELETE /api/overmind/history/:id removes a single task-history entry, JWT-owner only", async () => {
    // Register + push a task update so a history row exists
    await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      label: "history-del",
      session: "history-del-parent",
      run_dir: "/tmp/history-del",
      tasks: [
        { id: "T1", label: "A", state: "processing" },
        { id: "T2", label: "B", state: "pending" }
      ]
    });
    await lifecyclePost("/api/overmind/tasks", {
      token: OVERMIND_TOKEN,
      session: "history-del-parent",
      current_task: "A2 routes",
      tasks: [
        { id: "T1", label: "A", state: "done" },
        { id: "T2", label: "B", state: "processing" }
      ]
    });

    const entries = overmindService.listHistory("history-del-parent");
    expect(entries.length).toBeGreaterThanOrEqual(1);
    const entryId = entries[0].id;

    // No auth → 401
    const unauth = await app.inject({
      method: "DELETE",
      url: `/api/overmind/history/${entryId}`
    });
    expect(unauth.statusCode).toBe(401);

    // JWT-owner → 200
    const dropped = await app.inject({
      method: "DELETE",
      url: `/api/overmind/history/${entryId}`,
      headers: authHeader()
    });
    expect(dropped.statusCode).toBe(200);
    expect(dropped.json()).toEqual({ ok: true });
    expect(overmindService.listHistory("history-del-parent").find(e => e.id === entryId)).toBeUndefined();

    // Second delete of the same entry → 404
    const missing = await app.inject({
      method: "DELETE",
      url: `/api/overmind/history/${entryId}`,
      headers: authHeader()
    });
    expect(missing.statusCode).toBe(404);
  });

  it("rejects operator control requests with missing or invalid token", async () => {
    const registered = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      label: "guarded controls",
      session: "guarded-controls-parent",
      run_dir: "/tmp/guarded-controls",
      tasks: [{ id: "t1", label: "Task 1", state: "pending" }]
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
      run_dir: "/tmp/lkvc",
      tasks: [{ id: "t1", label: "Task 1", state: "pending" }]
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
      run_dir: "/tmp/agjassist",
      tasks: [{ id: "t1", label: "Task 1", state: "pending" }]
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
      run_dir: "/tmp/spoof-test",
      tasks: [{ id: "t1", label: "Task 1", state: "pending" }]
    });
    const workflowId = first.json().workflow.id;
    overmindService.setDisplayName(workflowId, "JROM Custom Title");

    // Re-register with a spoofed display_name field in the body
    const second = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      label: "spoof-test-v2",
      session: "spoof-session",
      // Same project tree as first (cross-project upsert guard, JROM 2026-05-24).
      run_dir: "/tmp/spoof-test/v2",
      display_name: "spoofed",
      tasks: [{ id: "t1", label: "Task 1", state: "pending" }]
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
      run_dir: "/tmp/ask-update-override",
      tasks: [{ id: "t1", label: "Task 1", state: "pending" }]
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
    expect(authenticatedSet.json().workflow.evidence_idle_threshold_override_minutes).toBe(25);
    expect(overmindService.get(workflowId)?.evidence_idle_threshold_override_minutes).toBe(25);

    const authenticatedClear = await app.inject({
      method: "POST",
      url: `/api/overmind/workflows/${workflowId}/ask-update-cooldown`,
      headers: authHeader(),
      payload: { override_minutes: null }
    });
    expect(authenticatedClear.statusCode).toBe(200);
    expect(authenticatedClear.json().workflow.evidence_idle_threshold_override_minutes).toBeNull();
    expect(overmindService.get(workflowId)?.evidence_idle_threshold_override_minutes).toBeNull();
  });

  it("POST /api/overmind/workflows/:id/ask-update-cooldown validation rejects 7, -5, 245, 4.5", async () => {
    const registered = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      label: "ask-update-validation",
      session: "ask-update-validation-parent",
      run_dir: "/tmp/ask-update-validation",
      tasks: [{ id: "t1", label: "Task 1", state: "pending" }]
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
    // After the register-validates-parent-session-is-alive guard (JROM 2026-05-24),
    // tests that hit /register through this mock must report their parent session
    // as alive. Each test passes its parent name(s) in `extraAlive`.
    function makeTmuxMock(aliveSet: Set<string>, extraAlive: string[] = []): TmuxService {
      const merged = new Set([...aliveSet, ...extraAlive]);
      return {
        sessionExists: vi.fn(async (target: string) => merged.has(target)),
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
      const tmux = makeTmuxMock(new Set(["child-alive-1"]), ["parent-coord"]);
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
            run_dir: "/tmp/close-test",
tasks: [{ id: "t1", label: "Task 1", state: "pending" }]
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
      const tmux = makeTmuxMock(new Set(), ["parent-no-children"]);
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
            run_dir: "/tmp/no-children",
            tasks: [{ id: "t1", label: "Task 1", state: "done" }]
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
      const tmux = makeTmuxMock(new Set(), ["parent-dead-children"]); // nothing alive
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
            run_dir: "/tmp/dead-children",
            tasks: [{ id: "t1", label: "Task 1", state: "done" }]
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
          run_dir: "/tmp/no-tmux",
tasks: [{ id: "t1", label: "Task 1", state: "pending" }]
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
      const tmux = makeTmuxMock(new Set(["child-alive-x"]), ["hris-partial-coord"]);
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
      const tmux = makeTmuxMock(new Set(), ["hris-ncp-coord"]); // no alive children
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
      const tmux = makeTmuxMock(new Set(["child-alive-y"]), ["hris-ad-coord"]);
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
      const tmux = makeTmuxMock(new Set(), ["hris-adnc-coord"]); // all dead
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

  it("GET /api/overmind/runs requires JWT, returns ALL workflows (active + terminal) with correct shape (JROM 2026-05-24)", async () => {
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

    // history now includes ALL workflows (active + terminal) per JROM 2026-05-24
    const sessions = body.runs.map((r: { coordinator_session: string }) => r.coordinator_session);
    expect(sessions).toContain("runs-active-parent");
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
