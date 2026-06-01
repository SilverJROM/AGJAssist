import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { DatabaseService } from "../../src/db/database.js";
import { AuthService } from "../../src/auth/auth-service.js";
import { AppConfig } from "../../src/config/config.js";
import { registerOvermindRoutes } from "../../src/api/routes/overmind-routes.js";
import { OvermindService } from "../../src/services/overmind-service.js";
import * as agentPane from "../../src/services/overmind/agent-pane.js";

const BOT_TOKEN = "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11";
const JWT_SECRET = "acceptance-secret";
const OVERMIND_TOKEN = "acceptance-overmind-token";
const OWNER_TG_ID = 111222;
const VIEWER_TG_ID = 333444;
const OVERMIND_SCRIPT = path.resolve("spark-daemon-runkit/batch-b12h/artifacts/overmind.sh");
const execFileAsync = promisify(execFile);

let rootDir: string;
let app: FastifyInstance;
let db: DatabaseService;
let authService: AuthService;
let overmindService: OvermindService;

function testConfig(dbPath: string): AppConfig {
  return {
    telegram: {
      botToken: BOT_TOKEN,
      authorizedUserId: OWNER_TG_ID,
      testMode: true
    },
    runtime: {
      workspaceRoot: rootDir,
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
      path: dbPath
    },
    projects: {
      root: rootDir
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

function ownerHeaders(): { authorization: string } {
  const loginCode = authService.generateLoginCode(OWNER_TG_ID);
  const auth = authService.authenticateWithCode(loginCode);
  expect(auth).not.toBeNull();
  return { authorization: `Bearer ${auth!.token}` };
}

function viewerHeaders(): { authorization: string } {
  authService.addUser(VIEWER_TG_ID, "viewer");
  const loginCode = authService.generateLoginCode(VIEWER_TG_ID);
  const auth = authService.authenticateWithCode(loginCode);
  expect(auth).not.toBeNull();
  return { authorization: `Bearer ${auth!.token}` };
}

function projectPath(name: string): string {
  const dir = path.join(rootDir, name);
  fs.mkdirSync(dir, { recursive: true });
  return fs.realpathSync(dir);
}

function overmindTokenBody(extra: Record<string, unknown>): Record<string, unknown> {
  return {
    token: OVERMIND_TOKEN,
    ...extra
  };
}

async function registerRun(payload: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: "/api/overmind/register",
    remoteAddress: "127.0.0.1",
    payload: overmindTokenBody(payload)
  });
}

beforeEach(async () => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "overmind-acceptance-"));
  const dbPath = path.join(rootDir, "acceptance.sqlite");
  db = new DatabaseService(dbPath);
  db.ensureOwner(OWNER_TG_ID);
  authService = new AuthService(db, BOT_TOKEN, JWT_SECRET, 24);
  overmindService = new OvermindService(db);
  vi.spyOn(agentPane, "isAgentPane").mockResolvedValue("codex");

  app = Fastify({ logger: false });
  registerOvermindRoutes(app, testConfig(dbPath), authService, overmindService);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  db.close();
  vi.restoreAllMocks();
  fs.rmSync(rootDir, { recursive: true, force: true });
});

describe("T12.1-T12.5 Overmind projects/register acceptance", () => {
  it("T12.1 creates an overmind project, then rejects duplicate slug and app_path", async () => {
    const appPath = projectPath("agjassist");

    const created = await app.inject({
      method: "POST",
      url: "/api/overmind/projects",
      headers: ownerHeaders(),
      payload: {
        slug: "agjassist",
        app_path: appPath,
        parent_session: "AGJ-51",
        notes: "Primary acceptance fixture",
        created_by: "not-jrom"
      }
    });

    expect(created.statusCode).toBe(201);
    expect(created.json().project).toMatchObject({
      slug: "agjassist",
      app_path: appPath,
      parent_session: "AGJ-51",
      notes: "Primary acceptance fixture",
      created_by: "JROM"
    });

    const duplicateSlug = await app.inject({
      method: "POST",
      url: "/api/overmind/projects",
      headers: ownerHeaders(),
      payload: {
        slug: "agjassist",
        app_path: projectPath("duplicate-slug"),
        parent_session: "AGJ-52"
      }
    });

    expect(duplicateSlug.statusCode).toBe(409);
    expect(duplicateSlug.json()).toEqual({ error: "project slug or app_path already exists" });

    const duplicateAppPath = await app.inject({
      method: "POST",
      url: "/api/overmind/projects",
      headers: ownerHeaders(),
      payload: {
        slug: "agjassist-copy",
        app_path: appPath,
        parent_session: "AGJ-53"
      }
    });

    expect(duplicateAppPath.statusCode).toBe(409);
    expect(duplicateAppPath.json()).toEqual({ error: "project slug or app_path already exists" });
  });

  it("T12.2 rejects project creation without owner JWT", async () => {
    const payload = {
      slug: "auth-check",
      app_path: projectPath("auth-check"),
      parent_session: "AGJ-51"
    };
    const forbidden = { error: "projects are JROM-managed; ask JROM to create via dashboard" };

    const missingAuth = await app.inject({
      method: "POST",
      url: "/api/overmind/projects",
      payload
    });
    expect(missingAuth.statusCode).toBe(401);
    expect(missingAuth.json()).toEqual({ error: "Missing or invalid authorization header" });

    const viewer = await app.inject({
      method: "POST",
      url: "/api/overmind/projects",
      headers: viewerHeaders(),
      payload: {
        ...payload,
        slug: "viewer-auth-check"
      }
    });
    expect(viewer.statusCode).toBe(403);
    expect(viewer.json()).toEqual(forbidden);

    const loopbackTokenOnly = await app.inject({
      method: "POST",
      url: "/api/overmind/projects",
      remoteAddress: "127.0.0.1",
      headers: {
        "x-overmind-token": OVERMIND_TOKEN
      },
      payload: {
        ...payload,
        slug: "loopback-auth-check"
      }
    });
    expect(loopbackTokenOnly.statusCode).toBe(403);
    expect(loopbackTokenOnly.json()).toEqual(forbidden);
  });

  it("T12.3 attaches a run_dir-only register to the containing overmind project", async () => {
    const appPath = projectPath("project-root");
    const runDir = path.join(appPath, "spark-daemon-runkit", "projcore-run-acceptance");
    fs.mkdirSync(runDir, { recursive: true });
    const project = overmindService.createProject({
      slug: "agj",
      app_path: appPath,
      parent_session: "AGJ-51",
      notes: null
    });

    const attached = await registerRun({ run_dir: runDir });

    expect(attached.statusCode).toBe(201);
    const body = attached.json();
    expect(body.workflow_id).toBe(body.workflow.id);
    expect(body.project_id).toBe(project.id);
    expect(body.project_slug).toBe("agj");
    expect(body.parent_session).toBe("AGJ-51");
    expect(body.parent_status).toBe("ok");
    expect(body.workflow).toMatchObject({
      id: body.workflow_id,
      project_id: project.id,
      coordinator_session: null,
      run_dir: fs.realpathSync(runDir),
      parent_status: "ok"
    });
    expect(body.workflow.label).toContain("agj");
    expect(body.workflow.label).toContain("projcore-run-acceptance");
    expect(overmindService.get(body.workflow_id)).toMatchObject({
      project_id: project.id,
      run_dir: fs.realpathSync(runDir),
      parent_status: "ok"
    });
  });

  it("T12.4 returns no-project-for-run-dir and overmind.sh writes REGISTER-REJECTED on server 404", async () => {
    const runDir = projectPath("no-project-run");

    const rejected = await registerRun({ run_dir: runDir });

    expect(rejected.statusCode).toBe(404);
    expect(rejected.json()).toEqual({
      error: "no-project-for-run-dir",
      run_dir: fs.realpathSync(runDir),
      searched_up_to: path.parse(runDir).root,
      hint: "Ask JROM to create a project for the containing app via POST /api/overmind/projects, then re-register."
    });

    const stub = http.createServer((_request, response) => {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "no-project-for-run-dir" }));
    });
    await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
    const address = stub.address();
    expect(address).toMatchObject({ port: expect.any(Number) });
    const url = `http://127.0.0.1:${(address as { port: number }).port}`;
    const tokenFile = path.join(rootDir, "overmind-token.env");
    fs.writeFileSync(tokenFile, `OVERMIND_TOKEN=${OVERMIND_TOKEN}\n`);

    try {
      await expect(execFileAsync("bash", [OVERMIND_SCRIPT, "register", "--run-dir", runDir], {
        env: {
          ...process.env,
          OVERMIND_URL: url,
          OVERMIND_TOKEN_FILE: tokenFile
        },
        timeout: 5000
      })).rejects.toThrow();
    } finally {
      await new Promise<void>((resolve, reject) => {
        stub.close((error) => error ? reject(error) : resolve());
      });
    }

    const callbacks = fs.readFileSync(path.join(runDir, "callbacks.md"), "utf8");
    expect(callbacks).toContain("[overmind REGISTER-REJECTED]");
    expect(callbacks).toContain("no-project-for-run-dir");
    expect(callbacks).toContain(`Run: ${fs.realpathSync(runDir)}.`);
  });

  it.each(["label", "parent_session", "session"] as const)(
    "T12.5 rejects derived attach field %s with 422",
    async (field) => {
      const appPath = projectPath(`forbidden-${field}`);
      const runDir = path.join(appPath, "run");
      fs.mkdirSync(runDir, { recursive: true });
      overmindService.createProject({
        slug: `forbidden-${field}`,
        app_path: appPath,
        parent_session: "AGJ-51",
        notes: null
      });

      const rejected = await registerRun({
        run_dir: runDir,
        [field]: "caller-owned-value"
      });

      expect(rejected.statusCode).toBe(422);
      expect(rejected.json()).toEqual({
        error: "forbidden-derived-field",
        field
      });
    }
  );
});
