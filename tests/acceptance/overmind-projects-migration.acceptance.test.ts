import { describe, expect, it, vi } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseService } from "../../src/db/database.js";
import { AuthService } from "../../src/auth/auth-service.js";
import { AppConfig } from "../../src/config/config.js";
import { registerOvermindRoutes } from "../../src/api/routes/overmind-routes.js";
import { OvermindService } from "../../src/services/overmind-service.js";
import {
  analyzeCompletedWorkflows,
  formatDryRunOutput
} from "../../src/tools/propose-overmind-projects.js";
import * as agentPane from "../../src/services/overmind/agent-pane.js";

const BOT_TOKEN = "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11";
const JWT_SECRET = "acceptance-secret";
const OVERMIND_TOKEN = "acceptance-overmind-token";
const OWNER_TG_ID = 111222;
const AGJ_APP_PATH = "/home/agjrom/TGBOTS/AGJAssist";

describe("T12.9-T12.10 Overmind project migration and AGJ attach acceptance", () => {
  it("T12.9 emits dry-run project curls from completed workflows only, executes zero network, and marks review-needed rows", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fake-tgbots-"));
    const db = new DatabaseService(path.join(root, "fixture.sqlite"));
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.fn(async () => {
      throw new Error("dry-run acceptance must not execute network");
    }) as unknown as typeof fetch;
    globalThis.fetch = fetchSpy;

    try {
      const appAlpha = appDir(root, "alpha", "project_specs.md");
      const appGitOnly = appDir(root, "gitonly", ".git");
      const alphaRunOne = mkdirp(path.join(appAlpha, "spark-daemon-runkit", "run-one"));
      const alphaRunTwo = mkdirp(path.join(appAlpha, "spark-daemon-runkit", "run-two"));
      const gitRun = mkdirp(path.join(appGitOnly, "nested", "run"));
      const missingRun = path.join(root, "missing", "run");

      insertWorkflow(db, {
        id: 1,
        label: "alpha-b12m migrate",
        coordinator_session: "alpha-old-parent",
        run_dir: alphaRunOne,
        status: "completed",
        ended_at: "2026-06-01T10:00:00.000Z"
      });
      insertWorkflow(db, {
        id: 2,
        label: "alpha-b12n proof",
        coordinator_session: "alpha-new-parent",
        run_dir: alphaRunTwo,
        status: "completed",
        ended_at: "2026-06-01T11:00:00.000Z"
      });
      insertWorkflow(db, {
        id: 3,
        label: "gitonly setup",
        coordinator_session: "gitonly-parent",
        run_dir: gitRun,
        status: "completed",
        ended_at: "2026-06-01T09:00:00.000Z"
      });
      insertWorkflow(db, {
        id: 4,
        label: "gone-b12q",
        coordinator_session: "gone-parent",
        run_dir: missingRun,
        status: "completed",
        ended_at: "2026-06-01T08:00:00.000Z"
      });
      insertWorkflow(db, {
        id: 5,
        label: "alpha-active",
        coordinator_session: "active-parent",
        run_dir: alphaRunOne,
        status: "active",
        ended_at: null
      });
      insertWorkflow(db, {
        id: 6,
        label: "alpha-working",
        coordinator_session: "working-parent",
        run_dir: alphaRunOne,
        status: "working",
        ended_at: null
      });
      insertWorkflow(db, {
        id: 7,
        label: "alpha-waiting",
        coordinator_session: "waiting-parent",
        run_dir: alphaRunOne,
        status: "waiting_human",
        ended_at: null
      });

      const analysis = await analyzeCompletedWorkflows(db);
      const dryRun = formatDryRunOutput(analysis, "http://127.0.0.1:3999");
      const alpha = analysis.proposals.find((proposal) => proposal.slug === "alpha");
      const gitOnly = analysis.proposals.find((proposal) => proposal.slug === "gitonly");

      expect(alpha).toMatchObject({
        app_path: fs.realpathSync(appAlpha),
        parent_session: "alpha-new-parent",
        source_workflow_id: 2,
        workflow_ids: [1, 2],
        completed_count: 2,
        commit_eligible: true
      });
      expect(gitOnly).toMatchObject({
        app_path: fs.realpathSync(appGitOnly),
        parent_session: "gitonly-parent",
        workflow_ids: [3],
        commit_eligible: true
      });
      expect(analysis.review_needed).toEqual([
        {
          workflow_id: 4,
          label: "gone-b12q",
          run_dir: missingRun,
          reason: "missing-run-dir"
        }
      ]);
      expect(analysis.skipped_statuses).toEqual(["active", "waiting_human", "working"]);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(dryRun).toContain("# DRY RUN: no HTTP requests were executed.");
      expect(dryRun).toContain("Ignored non-completed workflow statuses: active, waiting_human, working");
      expect(dryRun).toContain("curl -sS -X POST 'http://127.0.0.1:3999/api/overmind/projects'");
      expect(dryRun).toContain("\"parent_session\": \"alpha-new-parent\"");
      expect(dryRun).toContain("\"workflow_ids\": [\n    1,\n    2\n  ]");
      expect(dryRun).toContain("review-needed: workflow 4");
      expect(dryRun).not.toContain("active-parent");
      expect(dryRun).not.toContain("working-parent");
      expect(dryRun).not.toContain("waiting-parent");
    } finally {
      globalThis.fetch = originalFetch;
      db.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("T12.10 creates AGJ in a temp DB, registers a run under its app_path, and lists it attached to AGJ", async () => {
    const harness = await createHarness();
    const runRoot = fs.mkdtempSync(path.join(AGJ_APP_PATH, "tmp", "b12q-acceptance-"));
    const runDir = mkdirp(path.join(runRoot, "spark-daemon-runkit", "projcore-run-b12q"));

    try {
      const created = await harness.app.inject({
        method: "POST",
        url: "/api/overmind/projects",
        headers: ownerHeaders(harness.authService),
        payload: {
          slug: "AGJ",
          app_path: AGJ_APP_PATH,
          parent_session: "AGJ-51",
          notes: "B12q deterministic AGJ attach re-proof"
        }
      });

      expect(created.statusCode).toBe(201);
      expect(created.json().project).toMatchObject({
        slug: "AGJ",
        app_path: AGJ_APP_PATH,
        parent_session: "AGJ-51",
        created_by: "JROM"
      });

      const registered = await harness.app.inject({
        method: "POST",
        url: "/api/overmind/register",
        remoteAddress: "127.0.0.1",
        payload: {
          token: OVERMIND_TOKEN,
          run_dir: runDir
        }
      });

      expect(registered.statusCode).toBe(201);
      const registerBody = registered.json();
      const project = harness.overmindService.getProjectBySlug("AGJ");
      expect(project).not.toBeNull();
      expect(registerBody).toMatchObject({
        workflow_id: registerBody.workflow.id,
        project_id: project!.id,
        project_slug: "AGJ",
        parent_session: "AGJ-51",
        parent_status: "ok",
        workflow: {
          id: registerBody.workflow_id,
          project_id: project!.id,
          run_dir: fs.realpathSync(runDir),
          parent_status: "ok"
        }
      });
      expect(harness.overmindService.get(registerBody.workflow_id)).toMatchObject({
        project_id: project!.id,
        run_dir: fs.realpathSync(runDir),
        parent_status: "ok"
      });

      const listed = await harness.app.inject({
        method: "GET",
        url: "/api/overmind/projects/AGJ",
        headers: ownerHeaders(harness.authService)
      });

      expect(listed.statusCode).toBe(200);
      expect(listed.json().project).toMatchObject({
        slug: "AGJ",
        app_path: AGJ_APP_PATH,
        parent_session: "AGJ-51",
        active_runs_count: 1,
        latest_parent_status: "ok"
      });
    } finally {
      fs.rmSync(runRoot, { recursive: true, force: true });
      await harness.close();
    }
  });
});

function testConfig(dbPath: string, workspaceRoot: string): AppConfig {
  return {
    telegram: {
      botToken: BOT_TOKEN,
      authorizedUserId: OWNER_TG_ID,
      testMode: true
    },
    runtime: {
      workspaceRoot,
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
      root: workspaceRoot
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

async function createHarness(): Promise<{
  app: FastifyInstance;
  db: DatabaseService;
  authService: AuthService;
  overmindService: OvermindService;
  close: () => Promise<void>;
}> {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "overmind-b12q-acceptance-"));
  const dbPath = path.join(rootDir, "acceptance.sqlite");
  const db = new DatabaseService(dbPath);
  db.ensureOwner(OWNER_TG_ID);
  const authService = new AuthService(db, BOT_TOKEN, JWT_SECRET, 24);
  const overmindService = new OvermindService(db);
  vi.spyOn(agentPane, "isAgentPane").mockResolvedValue("codex");

  const app = Fastify({ logger: false });
  registerOvermindRoutes(app, testConfig(dbPath, rootDir), authService, overmindService);
  await app.ready();

  return {
    app,
    db,
    authService,
    overmindService,
    close: async () => {
      await app.close();
      db.close();
      vi.restoreAllMocks();
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  };
}

function ownerHeaders(authService: AuthService): { authorization: string } {
  const loginCode = authService.generateLoginCode(OWNER_TG_ID);
  const auth = authService.authenticateWithCode(loginCode);
  expect(auth).not.toBeNull();
  return { authorization: `Bearer ${auth!.token}` };
}

function appDir(root: string, name: string, marker: "project_specs.md" | ".git"): string {
  const dir = mkdirp(path.join(root, name));
  if (marker === "project_specs.md") {
    fs.writeFileSync(path.join(dir, "project_specs.md"), "# spec\n");
  } else {
    mkdirp(path.join(dir, ".git"));
  }
  return dir;
}

function mkdirp(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function insertWorkflow(
  db: DatabaseService,
  input: {
    id: number;
    label: string;
    coordinator_session: string;
    run_dir: string;
    status: "active" | "working" | "waiting_human" | "completed";
    ended_at: string | null;
  }
): void {
  db.prepare(
    `INSERT INTO overmind_workflows (
      id,
      label,
      coordinator_session,
      run_dir,
      status,
      tasks,
      ended_at,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, '[]', ?, '2026-06-01T00:00:00.000Z', ?)`
  ).run(
    input.id,
    input.label,
    input.coordinator_session,
    input.run_dir,
    input.status,
    input.ended_at,
    input.ended_at ?? "2026-06-01T00:00:00.000Z"
  );
}
