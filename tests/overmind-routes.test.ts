import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import { DatabaseService } from "../src/db/database.js";
import { AuthService } from "../src/auth/auth-service.js";
import { OvermindService } from "../src/services/overmind-service.js";
import { registerOvermindRoutes } from "../src/api/routes/overmind-routes.js";
import * as agentPane from "../src/services/overmind/agent-pane.js";
import { AppConfig } from "../src/config/config.js";
import { OvmSessionManager } from "../src/services/ovm-session.js";
import type { OvermindTask } from "../src/services/overmind/types.js";
import type { OvermindStreamManager } from "../src/api/websocket/overmind-stream-manager.js";
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

function lifecycleGetWithTokenHeader(url: string, remoteAddress = "127.0.0.1") {
  return app.inject({
    method: "GET",
    url,
    remoteAddress,
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
let streamBroadcast: ReturnType<typeof vi.fn>;
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

async function seedAttachedWorkflow(input: {
  slug?: string;
  parentSession: string;
  runDir: string;
  currentTask?: string | null;
  tasks?: OvermindTask[];
  childSessions?: string[];
  childRoles?: string[];
}) {
  fs.mkdirSync(input.runDir, { recursive: true });
  overmindService.createProject({
    slug: input.slug ?? `seed-${input.parentSession}-${overmindService.listProjects().length + 1}`,
    app_path: input.runDir,
    parent_session: input.parentSession,
    notes: null
  });
  const registered = await lifecyclePost("/api/overmind/register", {
    token: OVERMIND_TOKEN,
    run_dir: input.runDir,
    current_task: input.currentTask,
    tasks: input.tasks
  });
  expect(registered.statusCode).toBe(201);
  let workflow = registered.json().workflow;
  if (input.childSessions) {
    const children = await lifecyclePost("/api/overmind/children", {
      token: OVERMIND_TOKEN,
      workflow_id: workflow.id,
      child_sessions: input.childSessions,
      child_roles: input.childRoles ?? input.childSessions.map(() => "child")
    });
    expect(children.statusCode).toBe(200);
    workflow = children.json().workflow;
  }
  const body = registered.json();
  return {
    statusCode: registered.statusCode,
    json: () => ({ ...body, workflow })
  };
}

beforeEach(async () => {
  cleanup();
  tempProjectDirs = [];
  db = new DatabaseService(TEST_DB);
  db.ensureOwner(111222);
  authService = new AuthService(db, BOT_TOKEN, JWT_SECRET, 24);
  overmindService = new OvermindService(db);
  streamBroadcast = vi.fn();
  const streamManager = {
    broadcast: streamBroadcast
  } as unknown as OvermindStreamManager;
  ovmSession = {
    status: vi.fn(async () => ({ open: true, status: "open", since: "2026-05-21T00:00:00.000Z" })),
    open: vi.fn(async () => ({ open: true, status: "open", opened: true, since: "2026-05-21T00:00:00.000Z" })),
    restart: vi.fn(async () => ({ open: true, status: "open", opened: true, restarted: true, since: "2026-05-21T00:00:01.000Z" })),
    close: vi.fn(async () => ({ open: false, status: "closed", closed: true })),
    sendAndAwaitReply: vi.fn(async () => ({ pending: false as const, reply: "mock reply" })),
    getReply: vi.fn(async () => null)
  };
  app = Fastify({ logger: false });
  registerOvermindRoutes(app, testConfig(), authService, overmindService, undefined, streamManager, ovmSession);
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

  it("rejects malformed project parent_session names with corrective hints", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/overmind/projects",
      headers: authHeader(),
      payload: {
        slug: "bad-parent",
        app_path: tempProjectPath(),
        parent_session: "AGJ:51"
      }
    });
    expect(created.statusCode).toBe(422);
    expect(created.json()).toMatchObject({
      ok: false,
      code: "invalid-session-name",
      field: "parent_session",
      value: "AGJ:51"
    });

    const appPath = tempProjectPath();
    overmindService.createProject({
      slug: "patch-parent",
      app_path: appPath,
      parent_session: "AGJ-51",
      notes: null
    });
    const patched = await app.inject({
      method: "PATCH",
      url: "/api/overmind/projects/patch-parent",
      headers: authHeader(),
      payload: {
        parent_session: "AGJ 51"
      }
    });
    expect(patched.statusCode).toBe(422);
    expect(patched.json()).toMatchObject({
      ok: false,
      code: "invalid-session-name",
      field: "parent_session",
      value: "AGJ 51"
    });
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
    const second = overmindService.createProject({
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
    db.prepare(
      `UPDATE overmind_workflows
       SET parent_status = 'ok', updated_at = '2026-01-01 00:00:00'
       WHERE coordinator_session = 'AGJ-51'`
    ).run();
    db.prepare(
      `UPDATE overmind_workflows
       SET parent_status = 'bare-bash', updated_at = '2026-01-02 00:00:00'
       WHERE coordinator_session = 'AGJ-52'`
    ).run();
    db.prepare(
      `UPDATE overmind_workflows
       SET parent_status = 'no-session', updated_at = '2026-01-03 00:00:00'
       WHERE coordinator_session = 'AGJ-53'`
    ).run();
    db.prepare(
      `INSERT INTO overmind_workflows (project_id, label, coordinator_session, run_dir, status, tasks, parent_status, updated_at)
       VALUES (?, 'receipt-warning', 'RS-1', '/tmp/receiptbot/run', 'completed', '[]', 'no-session', '2026-01-04 00:00:00')`
    ).run(second.id);

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
      expect.objectContaining({ slug: "agjassist", active_runs_count: 2, latest_parent_status: "no-session" }),
      expect.objectContaining({ slug: "receiptbot", active_runs_count: 0, latest_parent_status: "no-session" })
    ]);

    const viewerOne = await app.inject({
      method: "GET",
      url: "/api/overmind/projects/agjassist",
      headers: viewerAuthHeader()
    });
    expect(viewerOne.statusCode).toBe(200);
    expect(viewerOne.json().project).toMatchObject({
      slug: "agjassist",
      active_runs_count: 2,
      latest_parent_status: "no-session"
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

  it("describes attach registration with a live project list and loopback token auth", async () => {
    const appPath = tempProjectPath();
    overmindService.createProject({
      slug: "agjassist",
      app_path: appPath,
      parent_session: "AGJ-51",
      notes: "Primary project"
    });

    const response = await lifecycleGetWithTokenHeader("/api/overmind/register/describe");

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      version: 1,
      register: {
        method: "POST",
        path: "/api/overmind/register",
        required: ["run_dir", "token"],
        forbidden: ["label", "session", "parent_session", "project_slug"],
        input_schema: {
          type: "object",
          additionalProperties: false,
          required: ["run_dir", "token"],
          properties: {
            run_dir: expect.objectContaining({ type: "string", minLength: 1 }),
            token: expect.objectContaining({ type: "string", minLength: 1 })
          }
        },
        example: {
          run_dir: "<abs path under a registered project>",
          token: "<overmind token>"
        }
      },
      projects: [
        {
          slug: "agjassist",
          app_path: appPath,
          parent_session: "AGJ-51"
        }
      ]
    });
    expect(response.json().register.notes).toContain("identity is derived server-side");
    expect(response.json().endpoints.map((endpoint: { name: string }) => endpoint.name)).toEqual([
      "register",
      "tasks",
      "children",
      "complete",
      "pause",
      "resume"
    ]);

    const fullResponse = await lifecycleGetWithTokenHeader("/api/overmind/describe");
    expect(fullResponse.statusCode).toBe(200);
    const fullBody = fullResponse.json();
    expect(fullBody).toMatchObject({
      ok: true,
      version: 2,
      projects: [
        {
          slug: "agjassist",
          app_path: appPath,
          parent_session: "AGJ-51"
        }
      ]
    });
    expect(fullBody.endpoints.map((endpoint: { name: string }) => endpoint.name)).toEqual([
      "register",
      "tasks",
      "children",
      "complete",
      "pause",
      "resume"
    ]);
    for (const name of ["register", "tasks", "children", "complete"]) {
      const endpoint = fullBody.endpoints.find((candidate: { name: string }) => candidate.name === name);
      expect(endpoint).toMatchObject({
        method: "POST",
        auth: expect.stringContaining("loopback"),
        input_schema: expect.objectContaining({ type: "object" }),
        example: expect.any(Object)
      });
    }

    const missingToken = await app.inject({
      method: "GET",
      url: "/api/overmind/register/describe",
      remoteAddress: "127.0.0.1"
    });
    expect(missingToken.statusCode).toBe(401);
    expect(missingToken.json()).toEqual({ error: "Missing or invalid overmind token" });

    const nonLoopback = await lifecycleGetWithTokenHeader("/api/overmind/register/describe", "10.0.0.5");
    expect(nonLoopback.statusCode).toBe(403);
    expect(nonLoopback.json()).toEqual({ error: "Overmind lifecycle endpoints are localhost-only" });
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

  it("adds spark_health to workflow dashboard reads from the daemon state cache", async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "spark-health-cache-"));
    tempProjectDirs.push(cacheDir);
    const cachePath = path.join(cacheDir, "spark-daemon-state.json");
    const previousCachePath = process.env.SPARK_DAEMON_STATE_CACHE;

    const activeId = db.prepare(
      `INSERT INTO overmind_workflows (label, coordinator_session, run_dir, status, tasks)
       VALUES ('spark-active', 'AGJ-51', '/tmp/spark-active', 'working', '[]')`
    ).run().lastInsertRowid as number;
    db.prepare(
      `INSERT INTO overmind_workflows (label, coordinator_session, run_dir, status, tasks)
       VALUES ('spark-unknown', 'AGJ-52', '/tmp/spark-unknown', 'active', '[]')`
    ).run();

    const lastTick = new Date().toISOString();
    const lastAmbiguousAt = new Date(Date.now() - 17 * 60 * 1000).toISOString();
    fs.writeFileSync(cachePath, JSON.stringify({
      runs: {
        [String(activeId)]: {
          last_classification: "ALERT-MEDIUM",
          last_tick: lastTick,
          last_ambiguous_at: lastAmbiguousAt
        }
      }
    }));

    try {
      process.env.SPARK_DAEMON_STATE_CACHE = cachePath;
      const response = await app.inject({
        method: "GET",
        url: "/api/overmind/workflows",
        headers: authHeader()
      });

      expect(response.statusCode).toBe(200);
      const workflows = response.json().workflows;
      const active = workflows.find((workflow: { id: number }) => workflow.id === activeId);
      const unknown = workflows.find((workflow: { label: string }) => workflow.label === "spark-unknown");
      expect(active.spark_health).toMatchObject({
        state: "ALERT-MEDIUM",
        last_classification: lastTick
      });
      expect(active.spark_health.minutes_since_ambiguous).toBeGreaterThanOrEqual(17);
      expect(active.spark_health.minutes_since_ambiguous).toBeLessThan(20);
      expect(unknown.spark_health).toEqual({
        state: "UNKNOWN",
        last_classification: null,
        minutes_since_ambiguous: null
      });
    } finally {
      if (previousCachePath === undefined) {
        delete process.env.SPARK_DAEMON_STATE_CACHE;
      } else {
        process.env.SPARK_DAEMON_STATE_CACHE = previousCachePath;
      }
    }
  });

  it("serves project-backed active runs for the spark daemon", async () => {
    const empty = await lifecycleGetWithTokenHeader("/api/overmind/runs/active");
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({ runs: [] });

    const appPath = tempProjectPath();
    const runDir = path.join(appPath, "spark-run");
    const dispatchDir = path.join(runDir, "dispatch");
    fs.mkdirSync(dispatchDir, { recursive: true });
    fs.writeFileSync(path.join(dispatchDir, "b.json"), "{}");
    fs.writeFileSync(path.join(dispatchDir, "a.json"), "{}");
    fs.writeFileSync(path.join(dispatchDir, "ignore.txt"), "ignore");

    const project = overmindService.createProject({
      slug: "agjassist",
      app_path: appPath,
      parent_session: "AGJ-51",
      notes: null
    });
    const activeId = db.prepare(
      `INSERT INTO overmind_workflows (
         project_id,
         label,
         coordinator_session,
         child_sessions,
         child_roles,
         run_dir,
         status,
         tasks,
         created_at
       ) VALUES (?, 'AGJ B2', NULL, ?, ?, ?, 'working', '[]', '2026-06-01T13:00:00.000Z')`
    ).run(
      project.id,
      JSON.stringify(["agj-spark", "agj-validator"]),
      JSON.stringify(["implementer", "validator"]),
      runDir
    ).lastInsertRowid as number;
    db.prepare(
      `INSERT INTO overmind_workflows (project_id, label, coordinator_session, run_dir, status, tasks)
       VALUES (?, 'completed-run', NULL, ?, 'completed', '[]')`
    ).run(project.id, path.join(appPath, "completed"));
    db.prepare(
      `INSERT INTO overmind_workflows (project_id, label, coordinator_session, run_dir, status, tasks)
       VALUES (?, 'paused-run', NULL, ?, 'paused', '[]')`
    ).run(project.id, path.join(appPath, "paused"));
    db.prepare(
      `INSERT INTO overmind_workflows (project_id, label, coordinator_session, run_dir, status, tasks)
       VALUES (NULL, 'legacy-active', 'legacy-parent', '/tmp/legacy-active', 'active', '[]')`
    ).run();

    const response = await lifecycleGetWithTokenHeader("/api/overmind/runs/active");

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      runs: [
        {
          run_id: activeId,
          run_dir: runDir,
          label: "AGJ B2",
          parent_label: "agjassist",
          parent_session: "AGJ-51",
          status: "working",
          registered_at: "2026-06-01T13:00:00.000Z",
          children: [
            { session: "agj-spark", role: "implementer" },
            { session: "agj-validator", role: "validator" }
          ],
          dispatch_manifests: [
            path.join(dispatchDir, "a.json"),
            path.join(dispatchDir, "b.json")
          ]
        }
      ]
    });
  });

  it("rejects active-runs registry reads without loopback overmind token auth", async () => {
    const noToken = await app.inject({
      method: "GET",
      url: "/api/overmind/runs/active",
      remoteAddress: "127.0.0.1"
    });
    expect(noToken.statusCode).toBe(401);

    const nonLoopback = await lifecycleGetWithTokenHeader("/api/overmind/runs/active", "10.0.0.7");
    expect(nonLoopback.statusCode).toBe(403);
  });

  it("attaches and upserts workflows from localhost with the shared token", async () => {
    const runDir = "/tmp/lkcamp";
    fs.mkdirSync(runDir, { recursive: true });
    overmindService.createProject({
      slug: "lkcamp",
      app_path: runDir,
      parent_session: "lkcamp-12",
      notes: null
    });

    const first = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      run_dir: runDir,
      current_task: "A2 routes",
      tasks: [{ id: "A2", label: "Routes", state: "processing" }]
    });
    expect(first.statusCode).toBe(201);
    const firstBody = first.json();
    expect(firstBody.workflow.coordinator_session).toBe("lkcamp-12");
    expect(firstBody.workflow.tasks).toEqual([{ id: "A2", label: "Routes", state: "processing", estimate_min: null }]);

    const firstChildren = await lifecyclePost("/api/overmind/children", {
      token: OVERMIND_TOKEN,
      workflow_id: firstBody.workflow.id,
      child_sessions: ["lkcdx-may20"],
      child_roles: ["implementer"]
    });
    expect(firstChildren.statusCode).toBe(200);
    expect(firstChildren.json().workflow.child_sessions).toEqual(["lkcdx-may20"]);

    const second = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      run_dir: runDir,
      tasks: [{ id: "t1", label: "Task 1", state: "pending" }]
    });
    expect(second.statusCode).toBe(201);
    const secondBody = second.json();
    expect(secondBody.workflow.id).toBe(firstBody.workflow.id);
    expect(secondBody.workflow.label).toBe("lkcamp · lkcamp");
    expect(secondBody.workflow.status).toBe("active");
    const secondChildren = await lifecyclePost("/api/overmind/children", {
      token: OVERMIND_TOKEN,
      workflow_id: firstBody.workflow.id,
      child_sessions: ["lkcdx-may20", "lkcdx-extra"],
      child_roles: ["implementer", "reviewer"]
    });
    expect(secondChildren.statusCode).toBe(200);
    expect(secondChildren.json().workflow.child_sessions).toEqual(["lkcdx-may20", "lkcdx-extra"]);
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
      // coordinator_session is DERIVED from the project's parent_session on attach
      // (was NULL — the bug that made the watcher/spark-daemon read "coord session dead").
      coordinator_session: "AGJ-51",
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

  it("announces a successful first attach registration over the Overmind stream", async () => {
    const appPath = tempProjectPath();
    const runDir = path.join(appPath, "plans", "b5", "run-1");
    fs.mkdirSync(runDir, { recursive: true });
    overmindService.createProject({
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
    const body = attached.json();
    expect(streamBroadcast).toHaveBeenCalledOnce();
    expect(streamBroadcast).toHaveBeenCalledWith(undefined, expect.objectContaining({
      kind: "overmind-registration",
      project_slug: "agjassist",
      workflow_id: body.workflow_id,
      label: "agjassist · run-1",
      run_dir: fs.realpathSync(runDir)
    }));
  });

  it("does not announce an idempotent attach registration for an existing project/run_dir", async () => {
    const appPath = tempProjectPath();
    const runDir = path.join(appPath, "plans", "b5", "run-1");
    fs.mkdirSync(runDir, { recursive: true });
    overmindService.createProject({
      slug: "agjassist",
      app_path: appPath,
      parent_session: "AGJ-51",
      notes: null
    });

    const first = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      run_dir: runDir
    });
    expect(first.statusCode).toBe(201);
    expect(streamBroadcast).toHaveBeenCalledOnce();

    streamBroadcast.mockClear();
    const second = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      run_dir: runDir
    });

    expect(second.statusCode).toBe(201);
    expect(second.json().workflow_id).toBe(first.json().workflow_id);
    expect(streamBroadcast).not.toHaveBeenCalled();
  });

  it("does not announce rejected attach registrations", async () => {
    const unmatchedRunDir = path.join(tempProjectPath(), "unknown-run");
    fs.mkdirSync(unmatchedRunDir, { recursive: true });

    const noProject = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      run_dir: unmatchedRunDir
    });
    expect(noProject.statusCode).toBe(404);
    expect(streamBroadcast).not.toHaveBeenCalled();

    const appPath = tempProjectPath();
    const runDir = path.join(appPath, "plans", "b5", "run-2");
    fs.mkdirSync(runDir, { recursive: true });
    overmindService.createProject({
      slug: "agjassist",
      app_path: appPath,
      parent_session: "AGJ-51",
      notes: null
    });

    const forbidden = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      run_dir: runDir,
      label: "caller supplied label"
    });
    expect(forbidden.statusCode).toBe(422);
    expect(streamBroadcast).not.toHaveBeenCalled();
  });

  it("adds children to an attached workflow by canonicalized run_dir without workflow_id", async () => {
    const appPath = tempProjectPath();
    const symlinkRoot = `${appPath}-link`;
    tempProjectDirs.push(symlinkRoot);
    fs.symlinkSync(appPath, symlinkRoot, "dir");
    const realRunDir = path.join(appPath, "plans", "b9a", "run-1");
    const linkedRunDir = path.join(symlinkRoot, "plans", "b9a", "run-1");
    fs.mkdirSync(realRunDir, { recursive: true });
    overmindService.createProject({
      slug: "agjassist",
      app_path: appPath,
      parent_session: "AGJ-51",
      notes: null
    });

    const attached = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      run_dir: linkedRunDir
    });
    expect(attached.statusCode).toBe(201);
    expect(attached.json().workflow.run_dir).toBe(fs.realpathSync(realRunDir));

    const children = await lifecyclePost("/api/overmind/children", {
      token: OVERMIND_TOKEN,
      run_dir: linkedRunDir,
      child_sessions: ["AGJ-codex55"],
      child_roles: ["implementer"]
    });
    expect(children.statusCode).toBe(200);
    expect(children.json().workflow.id).toBe(attached.json().workflow_id);
    expect(children.json().workflow.child_sessions).toEqual(["AGJ-codex55"]);
    expect(children.json().workflow.child_roles).toEqual(["implementer"]);
    expect(overmindService.get(attached.json().workflow_id)?.child_sessions).toEqual(["AGJ-codex55"]);
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
    const appPath = tempProjectPath();
    overmindService.createProject({
      slug: "seeded-project",
      app_path: appPath,
      parent_session: "AGJ-51",
      notes: null
    });
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "overmind-no-project-"));
    tempProjectDirs.push(runDir);
    const resolvedRunDir = fs.realpathSync(runDir);

    const rejected = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      run_dir: runDir
    });

    expect(rejected.statusCode).toBe(404);
    expect(rejected.json()).toMatchObject({
      ok: false,
      error: "no-project-for-run-dir",
      code: "no-project-for-run-dir",
      message: `No registered overmind project contains run_dir '${resolvedRunDir}'.`,
      run_dir: resolvedRunDir,
      searched_up_to: path.parse(runDir).root,
      validProjects: [
        {
          slug: "seeded-project",
          app_path: appPath
        }
      ]
    });
    expect(rejected.json().hint).toContain(`your run_dir ${resolvedRunDir} is not under any registered project`);
    expect(rejected.json().hint).toContain(`seeded-project (${appPath})`);
    expect(rejected.json().hint).toContain("use the correct run_dir or ask JROM to create the project");
  });

  it("rejects derived fields on run_dir-only register", async () => {
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
    expect(forbidden.json()).toMatchObject({
      ok: false,
      error: "forbidden-derived-field",
      code: "forbidden-derived-field",
      message: "Attach registration rejected forbidden derived field 'label'.",
      hint: "identity is derived server-side; do not send label — see GET /api/overmind/register/describe",
      field: "label"
    });

  });

  it("rejects legacy label/session register payloads with the attach-only contract error", async () => {
    const rejected = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      label: "legacy",
      session: "legacy-session",
      run_dir: "/tmp/overmind/legacy-register-removed",
      tasks: [{ id: "B1", label: "Legacy", state: "pending" }]
    });

    expect(rejected.statusCode).toBe(422);
    expect(rejected.json()).toMatchObject({
      ok: false,
      error: "legacy-register-removed",
      code: "legacy-register-removed",
      hint: "registration is attach-only now — POST {run_dir, token}; identity is derived from the project. See GET /api/overmind/register/describe"
    });
    expect(overmindService.list()).toHaveLength(0);
  });

  it("preserves existing tasks when attach re-register omits or sends an empty tasks array", async () => {
    const runDir = "/tmp/projectz-checkin";
    fs.mkdirSync(runDir, { recursive: true });
    overmindService.createProject({
      slug: "projectz",
      app_path: runDir,
      parent_session: "pz-checkin",
      notes: null
    });
    const initial = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      run_dir: runDir,
      tasks: [{ id: "T1", label: "Initial", state: "processing" }]
    });
    expect(initial.statusCode).toBe(201);
    const omittedTasks = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      run_dir: runDir
    });
    expect(omittedTasks.statusCode).toBe(201);
    expect(omittedTasks.json().workflow.tasks).toEqual([
      { id: "T1", label: "Initial", state: "processing", estimate_min: null }
    ]);

    const emptyTasks = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      run_dir: runDir,
      tasks: []
    });
    expect(emptyTasks.statusCode).toBe(201);
    expect(emptyTasks.json().workflow.tasks).toEqual([
      { id: "T1", label: "Initial", state: "processing", estimate_min: null }
    ]);
    expect(overmindService.list()).toHaveLength(1);
  });

  it("stores and returns optional task estimates on register and task updates", async () => {
    const runDir = "/tmp/projectz-estimates";
    fs.mkdirSync(runDir, { recursive: true });
    overmindService.createProject({
      slug: "projectz-estimates",
      app_path: runDir,
      parent_session: "pz-estimates",
      notes: null
    });

    const registered = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      run_dir: runDir,
      tasks: [
        { id: "B10", label: "Parser estimate", state: "processing", estimate_min: 25 },
        { id: "B11", label: "No estimate", state: "pending" }
      ]
    });
    expect(registered.statusCode).toBe(201);
    expect(registered.json().workflow.tasks).toEqual([
      { id: "B10", label: "Parser estimate", state: "processing", estimate_min: 25 },
      { id: "B11", label: "No estimate", state: "pending", estimate_min: null }
    ]);

    const updated = await lifecyclePost("/api/overmind/tasks", {
      token: OVERMIND_TOKEN,
      session: "pz-estimates",
      current_task: "Estimate update",
      tasks: [
        { id: "B10", label: "Parser estimate", state: "done", estimate_min: 25 },
        { id: "B12", label: "Invalid estimate", state: "processing", estimate_min: "later" },
        { id: "B13", label: "Non-positive estimate", state: "pending", estimate_min: 0 }
      ]
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().workflow.tasks).toEqual([
      { id: "B10", label: "Parser estimate", state: "done", estimate_min: 25 },
      { id: "B12", label: "Invalid estimate", state: "processing", estimate_min: null },
      { id: "B13", label: "Non-positive estimate", state: "pending", estimate_min: null }
    ]);
    expect(updated.json().workflow.current_task).toBe("Estimate update");
  });

  it("rejects garbage task rows on /register and /tasks with corrective hints", async () => {
    const rowIdRunDir = "/tmp/overmind/trash-paste-route";
    fs.mkdirSync(rowIdRunDir, { recursive: true });
    overmindService.createProject({
      slug: "trash-paste",
      app_path: rowIdRunDir,
      parent_session: "tp-route",
      notes: null
    });
    const rowIdRegister = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      run_dir: rowIdRunDir,
      current_task: "| # | Batch | Owner | Status | Notes |",
      tasks: [
        { id: "B0", label: "Design memo rev", state: "pending" },
        { id: "row-1", label: "Parser fallback", state: "pending" }
      ]
    });
    expect(rowIdRegister.statusCode).toBe(422);
    expect(rowIdRegister.json()).toMatchObject({
      ok: false,
      code: "invalid-task-list",
      hint: expect.stringContaining("row-N")
    });
    expect(rowIdRegister.json().invalid_tasks).toContainEqual(expect.objectContaining({
      index: 1,
      field: "id",
      value: "row-1"
    }));

    const trashLabelRunDir = "/tmp/overmind/trash-label-route";
    fs.mkdirSync(trashLabelRunDir, { recursive: true });
    overmindService.createProject({
      slug: "trash-label",
      app_path: trashLabelRunDir,
      parent_session: "trash-label-route",
      notes: null
    });
    const trashLabelRegister = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      run_dir: trashLabelRunDir,
      tasks: [
        { id: "B1", label: "|---|---|---|", state: "pending" }
      ]
    });
    expect(trashLabelRegister.statusCode).toBe(422);
    expect(trashLabelRegister.json().invalid_tasks).toContainEqual(expect.objectContaining({
      index: 0,
      field: "label"
    }));

    const reg = await seedAttachedWorkflow({
      parentSession: "valid-task-route",
      runDir: "/tmp/overmind/valid-task-route",
      tasks: [
        { id: "B0", label: "Design memo rev", state: "pending" }
      ]
    });
    expect(reg.statusCode).toBe(201);

    const invalidStateUpdate = await lifecyclePost("/api/overmind/tasks", {
      token: OVERMIND_TOKEN,
      session: "valid-task-route",
      current_task: "Still valid",
      tasks: [
        { id: "B0", label: "Design memo rev", state: "done" },
        { id: "B1", label: "Bad state", state: "blocked" }
      ]
    });
    expect(invalidStateUpdate.statusCode).toBe(422);
    expect(invalidStateUpdate.json()).toMatchObject({
      ok: false,
      code: "invalid-task-list",
      invalid_tasks: [expect.objectContaining({
        index: 1,
        field: "state",
        value: "blocked"
      })]
    });

    const overlongLabelUpdate = await lifecyclePost("/api/overmind/tasks", {
      token: OVERMIND_TOKEN,
      session: "valid-task-route",
      current_task: "Overlong label",
      tasks: [
        { id: "B0", label: "x".repeat(121), state: "processing" }
      ]
    });
    expect(overlongLabelUpdate.statusCode).toBe(422);
    expect(overlongLabelUpdate.json()).toMatchObject({
      ok: false,
      code: "invalid-task-list",
      hint: expect.stringContaining("label ≤120 chars; a task title is not a paragraph"),
      invalid_tasks: [expect.objectContaining({
        index: 0,
        field: "label",
        reason: "label must be 120 characters or fewer"
      })]
    });

    const validUpdate = await lifecyclePost("/api/overmind/tasks", {
      token: OVERMIND_TOKEN,
      session: "valid-task-route",
      current_task: "Real follow-up",
      tasks: [
        { id: "B0", label: "Design memo rev", state: "done" },
        { id: "B1", label: "x".repeat(120), state: "processing" }
      ]
    });
    expect(validUpdate.statusCode).toBe(200);
    expect(validUpdate.json().workflow.tasks.map((t: { id: string }) => t.id)).toEqual(["B0", "B1"]);
    expect(validUpdate.json().workflow.current_task).toBe("Real follow-up");
    expect(validUpdate.json().workflow.tasks[1].label).toHaveLength(120);
  });

  it("rejects garbage task rows on attach-shaped /register", async () => {
    const appPath = tempProjectPath();
    const runDir = path.join(appPath, "plans", "b9b", "attach-task-validation");
    fs.mkdirSync(runDir, { recursive: true });
    overmindService.createProject({
      slug: "attach-task-validation",
      app_path: appPath,
      parent_session: "AGJ-51",
      notes: null
    });

    const rejected = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      run_dir: runDir,
      tasks: [
        { id: "row-9", label: "Fallback row", state: "pending" }
      ]
    });

    expect(rejected.statusCode).toBe(422);
    expect(rejected.json()).toMatchObject({
      ok: false,
      code: "invalid-task-list",
      invalid_tasks: [expect.objectContaining({
        index: 0,
        field: "id",
        value: "row-9"
      })]
    });
  });

  it("addresses lifecycle updates by workflow_id and run_dir without session, while preserving session fallback", async () => {
    const reg = await seedAttachedWorkflow({
      parentSession: "identity-session",
      runDir: "/tmp/overmind/identity-route",
      currentTask: "Start",
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

    const missingTasks = await lifecyclePost("/api/overmind/tasks", {
      token: OVERMIND_TOKEN,
      workflow_id: workflowId
    });
    expect(missingTasks.statusCode).toBe(400);
    expect(missingTasks.json()).toMatchObject({
      ok: false,
      error: "workflow_id, run_dir, or session and tasks are required",
      code: "missing-task-update-fields",
      message: expect.stringContaining("tasks"),
      hint: expect.stringContaining("tasks")
    });

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

    const missingChildren = await lifecyclePost("/api/overmind/children", {
      token: OVERMIND_TOKEN,
      workflow_id: workflowId
    });
    expect(missingChildren.statusCode).toBe(400);
    expect(missingChildren.json()).toMatchObject({
      ok: false,
      error: "child_sessions is required",
      code: "missing-child-sessions",
      message: expect.stringContaining("child_sessions"),
      hint: expect.stringContaining("child_sessions")
    });

    const malformedChild = await lifecyclePost("/api/overmind/children", {
      token: OVERMIND_TOKEN,
      workflow_id: workflowId,
      run_dir: "/tmp/overmind/identity-route",
      child_sessions: ["identity:child"],
      child_roles: ["tester"]
    });
    expect(malformedChild.statusCode).toBe(422);
    expect(malformedChild.json()).toMatchObject({
      ok: false,
      code: "invalid-session-name",
      field: "child_sessions[0]",
      hint: expect.stringContaining("letters")
    });

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
    const workflow = overmindService.registerAttached({
      project_id: project.id,
      label: "parent-route",
      coordinator_session: "parent-route-session",
      run_dir: "/tmp/overmind/parent-route-app/run",
      tasks: [{ id: "B12c", label: "Identity", state: "processing" }]
    });

    expect(overmindService.getParentSessionForWorkflow(workflow.id)).toBe("AGJ-51");
  });

  it("rejects lifecycle requests with missing or invalid token and non-loopback source", async () => {
    const missingToken = await lifecyclePost("/api/overmind/register", {
      run_dir: "/tmp/bad",
      tasks: [{ id: "t1", label: "Task 1", state: "pending" }]
    });
    expect(missingToken.statusCode).toBe(401);

    const badToken = await lifecyclePost("/api/overmind/register", {
      token: "wrong",
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
        run_dir: "/tmp/bad",
        tasks: [{ id: "t1", label: "Task 1", state: "pending" }]
      }
    });
    expect(nonLoopback.statusCode).toBe(403);
  });

  it("completes workflows and updates tasklists by session", async () => {
    await seedAttachedWorkflow({
      parentSession: "hris-d-22",
      runDir: "/tmp/hris",
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
      { id: "A1", label: "Schema", state: "done", estimate_min: null },
      { id: "A2", label: "Routes", state: "processing", estimate_min: null }
    ]);

    const complete = await lifecyclePost("/api/overmind/complete", {
      token: OVERMIND_TOKEN,
      session: "hris-d-22"
    });

    expect(complete.statusCode).toBe(200);
    expect(complete.json().workflow.status).toBe("completed");

    const missingLookup = await lifecyclePost("/api/overmind/complete", {
      token: OVERMIND_TOKEN
    });
    expect(missingLookup.statusCode).toBe(400);
    expect(missingLookup.json()).toMatchObject({
      ok: false,
      error: "workflow_id, run_dir, or session is required",
      code: "missing-workflow-lookup",
      message: expect.stringContaining("workflow_id"),
      hint: expect.stringContaining("workflow_id")
    });

    const missing = await lifecyclePost("/api/overmind/complete", {
      token: OVERMIND_TOKEN,
      session: "unknown"
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({
      ok: false,
      error: "Workflow not found",
      code: "workflow-not-found",
      message: "Workflow not found.",
      hint: expect.stringContaining("re-register")
    });
  });

  it("pauses, resumes, and drops workflows from localhost with the shared token", async () => {
    const registered = await seedAttachedWorkflow({
      parentSession: "ovm-controls-parent",
      runDir: "/tmp/ovm-controls",
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
      const registered = await seedAttachedWorkflow({
        parentSession: "nudge-delete-parent",
        runDir: "/tmp/nudge-delete",
        tasks: [{ id: "t1", label: "Task 1", state: "pending" }]
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
    const registered = await seedAttachedWorkflow({
      parentSession: "owner-delete-parent",
      runDir: "/tmp/owner-delete",
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
    const registered = await seedAttachedWorkflow({
      parentSession: "unauth-delete-parent",
      runDir: "/tmp/unauth-delete",
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
    await seedAttachedWorkflow({
      parentSession: "history-del-parent",
      runDir: "/tmp/history-del",
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
    const registered = await seedAttachedWorkflow({
      parentSession: "guarded-controls-parent",
      runDir: "/tmp/guarded-controls",
      tasks: [{ id: "t1", label: "Task 1", state: "pending" }]
    });
    const workflowId = registered.json().workflow.id;

    const pauseMissingToken = await lifecyclePost(`/api/overmind/workflows/${workflowId}/pause`, {});
    expect(pauseMissingToken.statusCode).toBe(401);
    expect(pauseMissingToken.json()).toMatchObject({
      ok: false,
      error: "Missing or invalid overmind token",
      code: "invalid-overmind-token",
      hint: expect.stringContaining("body.token")
    });

    const resumeBadToken = await lifecyclePost(`/api/overmind/workflows/${workflowId}/resume`, {
      token: "wrong"
    });
    expect(resumeBadToken.statusCode).toBe(401);
    expect(resumeBadToken.json()).toMatchObject({
      ok: false,
      code: "invalid-overmind-token",
      message: expect.stringContaining("token")
    });

    const dropMissingToken = await lifecycleDelete(`/api/overmind/workflows/${workflowId}`, {});
    expect(dropMissingToken.statusCode).toBe(401);

    expect(overmindService.get(workflowId)?.status).toBe("active");
  });

  it("returns 404 for operator control requests against unknown workflows", async () => {
    const pause = await lifecyclePost("/api/overmind/workflows/999/pause", {
      token: OVERMIND_TOKEN
    });
    expect(pause.statusCode).toBe(404);
    expect(pause.json()).toMatchObject({
      ok: false,
      error: "Workflow not found",
      code: "workflow-not-found",
      hint: expect.stringContaining("re-register")
    });

    const resume = await lifecyclePost("/api/overmind/workflows/999/resume", {
      token: OVERMIND_TOKEN
    });
    expect(resume.statusCode).toBe(404);
    expect(resume.json()).toMatchObject({
      ok: false,
      error: "Workflow not found",
      code: "workflow-not-found",
      hint: expect.stringContaining("re-register")
    });

    const drop = await lifecycleDelete("/api/overmind/workflows/999", {
      token: OVERMIND_TOKEN
    });
    expect(drop.statusCode).toBe(404);
  });

  it("requires JWT auth for workflow reads and returns registered rows", async () => {
    await seedAttachedWorkflow({
      parentSession: "lkvc-38",
      runDir: "/tmp/lkvc",
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
    const registered = await seedAttachedWorkflow({
      parentSession: "archive-parent",
      runDir: "/tmp/archive",
      currentTask: "Seed",
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
    const registered = await seedAttachedWorkflow({
      parentSession: "agjassist-51",
      runDir: "/tmp/agjassist",
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
    const runDir = "/tmp/spoof-test";
    fs.mkdirSync(runDir, { recursive: true });
    overmindService.createProject({
      slug: "spoof-test",
      app_path: runDir,
      parent_session: "spoof-session",
      notes: null
    });

    // Attach and set a custom display_name
    const first = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      run_dir: runDir,
      tasks: [{ id: "t1", label: "Task 1", state: "pending" }]
    });
    const workflowId = first.json().workflow.id;
    overmindService.setDisplayName(workflowId, "JROM Custom Title");

    // Re-attach with a spoofed display_name field in the body.
    const second = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      run_dir: runDir,
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
    const registered = await seedAttachedWorkflow({
      parentSession: "ask-update-override-parent",
      runDir: "/tmp/ask-update-override",
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
    const registered = await seedAttachedWorkflow({
      parentSession: "ask-update-validation-parent",
      runDir: "/tmp/ask-update-validation",
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

    function seedWorkflowForComplete(input: {
      parentSession: string;
      runDir: string;
      tasks: OvermindTask[];
      childSessions?: string[];
    }) {
      fs.mkdirSync(input.runDir, { recursive: true });
      const project = overmindService.createProject({
        slug: `complete-${input.parentSession}`,
        app_path: input.runDir,
        parent_session: input.parentSession,
        notes: null
      });
      const workflow = overmindService.registerAttached({
        project_id: project.id,
        label: `complete ${input.parentSession}`,
        run_dir: input.runDir,
        coordinator_session: input.parentSession,
        tasks: input.tasks
      });
      if (input.childSessions) {
        overmindService.update(workflow.id, { child_sessions: input.childSessions });
      }
    }

    it("sends one sendCommand to coordinator_session containing child name + kill-session when ≥1 child is alive", async () => {
      const tmux = makeTmuxMock(new Set(["child-alive-1"]), ["parent-coord"]);
      const a = await buildAppWithTmux(tmux);
      try {
        seedWorkflowForComplete({
          parentSession: "parent-coord",
          childSessions: ["child-alive-1"],
          runDir: "/tmp/close-test",
          tasks: [{ id: "t1", label: "Task 1", state: "pending" }]
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
        seedWorkflowForComplete({
          parentSession: "parent-no-children",
          runDir: "/tmp/no-children",
          tasks: [{ id: "t1", label: "Task 1", state: "done" }]
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
        seedWorkflowForComplete({
          parentSession: "parent-dead-children",
          childSessions: ["child-dead-1", "child-dead-2"],
          runDir: "/tmp/dead-children",
          tasks: [{ id: "t1", label: "Task 1", state: "done" }]
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
      seedWorkflowForComplete({
        parentSession: "parent-no-tmux",
        childSessions: ["child-1"],
        runDir: "/tmp/no-tmux",
        tasks: [{ id: "t1", label: "Task 1", state: "pending" }]
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
        seedWorkflowForComplete({
          parentSession: "hris-partial-coord",
          childSessions: ["child-alive-x"],
          runDir: "/tmp/hris-partial",
          tasks: [
            { id: "T1", label: "Done task", state: "done" },
            { id: "T2", label: "Still processing", state: "processing" },
            { id: "T3", label: "Still pending", state: "pending" }
          ]
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
        seedWorkflowForComplete({
          parentSession: "hris-ncp-coord",
          childSessions: ["child-dead-x"],
          runDir: "/tmp/hris-ncp",
          tasks: [
            { id: "X1", label: "Done", state: "done" },
            { id: "X2", label: "Not done", state: "processing" }
          ]
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
        seedWorkflowForComplete({
          parentSession: "hris-ad-coord",
          childSessions: ["child-alive-y"],
          runDir: "/tmp/hris-ad",
          tasks: [
            { id: "Y1", label: "Done 1", state: "done" },
            { id: "Y2", label: "Done 2", state: "done" }
          ]
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
        seedWorkflowForComplete({
          parentSession: "hris-adnc-coord",
          childSessions: ["child-dead-z"],
          runDir: "/tmp/hris-adnc",
          tasks: [
            { id: "Z1", label: "Done", state: "done" }
          ]
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
    const activeReg = await seedAttachedWorkflow({
      parentSession: "runs-active-parent",
      runDir: "/tmp/runs-active",
      tasks: [{ id: "T1", label: "Task 1", state: "processing" }]
    });
    expect(activeReg.statusCode).toBe(201);

    const compReg = await seedAttachedWorkflow({
      parentSession: "runs-comp-parent",
      runDir: "/tmp/runs-completed",
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

    const failedReg = await seedAttachedWorkflow({
      parentSession: "runs-failed-parent",
      runDir: "/tmp/runs-failed",
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
    await seedAttachedWorkflow({
      parentSession: "hist-filter-s1",
      runDir: "/tmp/hist-filter-1",
      currentTask: "T1",
      tasks: [{ id: "A1", label: "A1", state: "processing" }]
    });
    await seedAttachedWorkflow({
      parentSession: "hist-filter-s2",
      runDir: "/tmp/hist-filter-2",
      currentTask: "T2",
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
