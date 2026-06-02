import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseService } from "../src/db/database.js";
import { AuthService } from "../src/auth/auth-service.js";
import { registerOvermindRoutes } from "../src/api/routes/overmind-routes.js";
import { OvermindService, type OvermindWorkflow } from "../src/services/overmind-service.js";
import { OvermindWatcher } from "../src/services/overmind-watcher.js";
import * as agentPane from "../src/services/overmind/agent-pane.js";
import type { AppConfig } from "../src/config/config.js";
import type { TmuxService } from "../src/tmux/tmux-service.js";

const TEST_DB = path.join("data", "test-overmind-registration-journey.sqlite");
const BOT_TOKEN = "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11";
const JWT_SECRET = "test-secret";
const OVERMIND_TOKEN = "ovm-journey-token";

let app: FastifyInstance;
let db: DatabaseService;
let authService: AuthService;
let overmindService: OvermindService;
let tempDirs: string[] = [];

function cleanupDb(): void {
  for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
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

function lifecycleGet(url: string) {
  return app.inject({
    method: "GET",
    url,
    remoteAddress: "127.0.0.1",
    headers: {
      "x-overmind-token": OVERMIND_TOKEN
    }
  });
}

function lifecyclePost(url: string, body: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url,
    remoteAddress: "127.0.0.1",
    payload: body
  });
}

function makeTmuxMock() {
  return {
    capturePane: vi.fn(async () => "quiet pane"),
    sendCommand: vi.fn(async () => ({ message: "sent", blocked: false })),
    sendAndSubmit: vi.fn(async () => true),
    sessionExists: vi.fn(async () => true)
  } as unknown as TmuxService & {
    sendAndSubmit: ReturnType<typeof vi.fn>;
    sessionExists: ReturnType<typeof vi.fn>;
  };
}

beforeEach(async () => {
  cleanupDb();
  tempDirs = [];
  db = new DatabaseService(TEST_DB);
  db.ensureOwner(111222);
  authService = new AuthService(db, BOT_TOKEN, JWT_SECRET, 24);
  overmindService = new OvermindService(db);
  vi.spyOn(agentPane, "isAgentPane").mockResolvedValue("codex");
  app = Fastify({ logger: false });
  registerOvermindRoutes(app, testConfig(), authService, overmindService);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  db.close();
  vi.restoreAllMocks();
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  cleanupDb();
});

describe("Overmind registration journey", () => {
  it("gives a fresh agent a seamless attach-only registration path with corrective hints", async () => {
    const appPath = tempDir("ovm-journey-app-");
    const project = overmindService.createProject({
      slug: "agjassist",
      app_path: appPath,
      parent_session: "AGJ-51",
      notes: "Phase-1 registration journey"
    });

    const describeResponse = await lifecycleGet("/api/overmind/register/describe");
    expect(describeResponse.statusCode).toBe(200);
    expect(describeResponse.json()).toMatchObject({
      ok: true,
      register: {
        path: "/api/overmind/register",
        required: ["run_dir", "token"],
        forbidden: ["label", "session", "parent_session", "project_slug"]
      },
      projects: [
        {
          slug: "agjassist",
          app_path: appPath,
          parent_session: "AGJ-51"
        }
      ]
    });
    expect(describeResponse.json().register.input_schema.additionalProperties).toBe(false);

    const firstRunDir = path.join(appPath, "plan", "run-clean");
    fs.mkdirSync(firstRunDir, { recursive: true });
    const cleanRegister = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      run_dir: firstRunDir
    });
    expect(cleanRegister.statusCode).toBe(201);
    const cleanBody = cleanRegister.json();
    expect(cleanBody.workflow).toMatchObject({
      project_id: project.id,
      coordinator_session: "AGJ-51",
      run_dir: fs.realpathSync(firstRunDir)
    });
    expect(cleanBody.workflow.coordinator_session).not.toBeNull();

    const children = await lifecyclePost("/api/overmind/children", {
      token: OVERMIND_TOKEN,
      workflow_id: cleanBody.workflow.id,
      child_sessions: ["AGJ-b3c-codex"],
      child_roles: ["implementer"]
    });
    expect(children.statusCode).toBe(200);
    const healthy = children.json().workflow as OvermindWorkflow;
    const staleGap = {
      ...healthy,
      info_request: "unregistered child",
      info_check: "dead_child"
    } satisfies OvermindWorkflow;
    const tmux = makeTmuxMock();
    const watcher = new OvermindWatcher(overmindService, tmux);
    await watcher.reconcile([staleGap]);
    expect(tmux.sendAndSubmit).not.toHaveBeenCalled();

    const wrongRunDir = tempDir("ovm-journey-wrong-run-");
    const wrongRegister = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      run_dir: wrongRunDir
    });
    expect(wrongRegister.statusCode).toBe(404);
    expect(wrongRegister.json()).toMatchObject({
      ok: false,
      error: "no-project-for-run-dir",
      code: "no-project-for-run-dir",
      validProjects: [
        {
          slug: "agjassist",
          app_path: appPath
        }
      ]
    });
    expect(wrongRegister.json().hint).toContain("use the correct run_dir or ask JROM to create the project");

    const recoveredRunDir = path.join(appPath, "plan", "run-recovered");
    fs.mkdirSync(recoveredRunDir, { recursive: true });
    const recoveredRegister = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      run_dir: recoveredRunDir
    });
    expect(recoveredRegister.statusCode).toBe(201);
    expect(recoveredRegister.json().workflow.project_id).toBe(project.id);

    const workflowCountBeforeLegacy = overmindService.list().length;
    const legacyRegister = await lifecyclePost("/api/overmind/register", {
      token: OVERMIND_TOKEN,
      run_dir: path.join(appPath, "plan", "legacy-payload"),
      label: "legacy",
      session: "legacy-session"
    });
    expect(legacyRegister.statusCode).toBe(422);
    expect(legacyRegister.json()).toMatchObject({
      ok: false,
      error: "legacy-register-removed",
      code: "legacy-register-removed",
      hint: "registration is attach-only now — POST {run_dir, token}; identity is derived from the project. See GET /api/overmind/register/describe"
    });
    expect(overmindService.list()).toHaveLength(workflowCountBeforeLegacy);

    const garbageTasks = await lifecyclePost("/api/overmind/tasks", {
      token: OVERMIND_TOKEN,
      workflow_id: cleanBody.workflow.id,
      current_task: "Garbage rejection",
      tasks: [
        { id: "B3c", label: "Registration journey", state: "processing" },
        { id: "row-7", label: "Fallback parser row", state: "pending" }
      ]
    });
    expect(garbageTasks.statusCode).toBe(422);
    expect(garbageTasks.json()).toMatchObject({
      ok: false,
      error: "invalid-task-list",
      code: "invalid-task-list",
      invalid_tasks: [
        expect.objectContaining({
          index: 1,
          field: "id",
          value: "row-7"
        })
      ]
    });
  });
});
