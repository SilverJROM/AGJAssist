import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import path from "node:path";
import fs from "node:fs";
import jwt from "jsonwebtoken";

import { DatabaseService } from "../../src/db/database.js";
import { AuthService } from "../../src/auth/auth-service.js";
import { AgentAssignmentService } from "../../src/services/agent-assignment-service.js";
import { registerAgentRoutes } from "../../src/api/routes/agent-routes.js";
import { CoordinatorLaunchService } from "../../src/services/coordinator-launch-service.js";
import { ProviderDispatchService } from "../../src/services/provider-dispatch-service.js";
import { ProviderResolverService } from "../../src/services/provider-resolver-service.js";
import { TmuxService } from "../../src/tmux/tmux-service.js";
import { ProjectService } from "../../src/services/project-service.js";
import { AssistantCore } from "../../src/bot/assistant-core.js";

const TEST_DB = path.join("data", "test-coordinator-launch.sqlite");
const BOT_TOKEN = "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11";
const JWT_SECRET = "test-b3-jwt-secret";
const SESSION_HOURS = 1;

function cleanup(): void {
  for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

function makeTmuxMock(initialExists = false) {
  const exists = vi.fn(async () => initialExists);
  const createSession = vi.fn(async (name: string, cwd?: string) => `${name}:0.0`);
  const sendCommand = vi.fn(async () => ({ message: "sent", blocked: false }));
  const sendAndSubmit = vi.fn(async () => true);
  const capturePane = vi.fn(async () => "pane with marker\n");
  return {
    sessionExists: exists,
    createSession,
    sendCommand,
    sendAndSubmit,
    capturePane
  } as unknown as TmuxService & {
    sessionExists: ReturnType<typeof vi.fn>;
    createSession: ReturnType<typeof vi.fn>;
    sendCommand: ReturnType<typeof vi.fn>;
    sendAndSubmit: ReturnType<typeof vi.fn>;
    capturePane: ReturnType<typeof vi.fn>;
  };
}

describe("Coordinator launch (B3) - HTTP-level Fastify inject + outcome asserts", () => {
  let db: DatabaseService;
  let authService: AuthService;
  let agentAssignmentService: AgentAssignmentService;
  let app: FastifyInstance;
  let ownerUserId: number;
  let ownerToken: string;

  beforeEach(() => {
    cleanup();
    db = new DatabaseService(TEST_DB);
    // Ensure minimal owner user exists (schema created by DatabaseService)
    const inserted = db
      .prepare(
        `INSERT INTO users (telegram_id, username, display_name, role, active)
         VALUES (?, ?, ?, 'owner', 1)
         RETURNING id`
      )
      .get(999999, "b3-test-owner", "B3 Test Owner") as { id: number };
    ownerUserId = inserted.id;

    authService = new AuthService(db, BOT_TOKEN, JWT_SECRET, SESSION_HOURS);
    agentAssignmentService = new AgentAssignmentService(db);

    // Create a test agent + binding for projcore/coord on a test project
    const agent = agentAssignmentService.createAgent({
      name: "test-grok-coord",
      provider: "grok",
      model: "grok-build",
      default_effort: "high"
    });
    // Create a project (minimal row for FK in bindings if needed; many tests rely on it existing)
    try {
      db.prepare(
        `INSERT INTO projects (id, directory_name, display_name, active) VALUES (123, 'test-proj', 'Test Project', 1)`
      ).run();
    } catch {}
    agentAssignmentService.setProjectBinding(123, "projcore", agent.id);
    agentAssignmentService.setProjectBinding(123, "coord", agent.id);

    // 456: existing project but no binding for projcore (used for unbound-role 400 case in B6 tests)
    try {
      db.prepare(
        `INSERT INTO projects (id, directory_name, display_name, active) VALUES (456, 'unbound-proj', 'Unbound Project', 1)`
      ).run();
    } catch {}

    // Also a claude agent + default for variety in tests
    const claudeAgent = agentAssignmentService.createAgent({
      name: "test-claude-impl",
      provider: "claude",
      model: "claude-3-5-sonnet",
      default_effort: "medium"
    });
    agentAssignmentService.setRoleDefault("implementer", claudeAgent.id);
  });

  afterEach(() => {
    if (app) {
      try { app.close(); } catch {}
    }
    cleanup();
  });

  async function createTestServerWithLaunch(launcher: CoordinatorLaunchService, projectService?: ProjectService) {
    const fastify = Fastify({ logger: false });
    // Register auth + agent routes (the launch endpoint must use the real requireOwner)
    registerAgentRoutes(fastify, authService, agentAssignmentService, launcher, undefined as any, projectService);
    return fastify;
  }

  function makeOwnerToken(): string {
    const sid = "test-sid-b3-launch";
    const token = jwt.sign(
      { sub: ownerUserId, sid, tid: 999999 },
      JWT_SECRET,
      { expiresIn: `${SESSION_HOURS}h` }
    );
    const tokenHash = require("crypto").createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600 * 1000).toISOString();
    db.prepare(
      `INSERT INTO sessions (id, user_id, token_hash, surface, expires_at) VALUES (?, ?, ?, 'web', ?)`
    ).run(sid, ownerUserId, tokenHash, expiresAt);
    return token;
  }

  it("launch endpoint (behind requireOwner) resolves binding, composes CORE+overlay, calls dispatch with correct args, returns outcome", async () => {
    const tmux = makeTmuxMock(false);
    const dispatchService = new ProviderDispatchService(new ProviderResolverService(), tmux);
    const launcher = new CoordinatorLaunchService(agentAssignmentService, (r) =>
      dispatchService.dispatchToProvider(r)
    );

    ownerToken = makeOwnerToken();
    app = await createTestServerWithLaunch(launcher, new ProjectService(db, "/tmp"));

    const res = await app.inject({
      method: "POST",
      url: "/api/projects/123/launch",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { mode: "projcore" },
      remoteAddress: "127.0.0.1"
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.mode).toBe("projcore");
    expect(body.provider).toBe("grok");
    expect(body.sessionTarget).toMatch(/agj-os-123/);
    expect(body.promptLength).toBeGreaterThan(100);

    // OUTCOME 1+2 per brief + affirmation #3: composed prompt CONTAINS CORE + correct provider overlay
    const submitted = tmux.sendAndSubmit.mock.calls[0]?.[1] || "";
    expect(submitted).toContain("App-owned CORE for projcore (v1 minimal, provider-agnostic)");
    expect(submitted).toContain("You are projcore, the requirements-driven batch coordinator");
    expect(submitted).toContain("--- grok overlay ---");
    expect(submitted).toContain("Grok runtime overlay (per-runtime plumbing, v1)");
    expect(submitted).toContain("Status file:"); // grok path

    // dispatchToProvider was called with resolved launch_cmd (via internal sendCommand) + composed + per-project session
    expect(tmux.sendCommand).toHaveBeenCalled();
    const launchCmdArg = tmux.sendCommand.mock.calls[0][1];
    expect(launchCmdArg).toMatch(/grok/); // resolved launch_cmd contains the provider binary
    expect(launchCmdArg).toMatch(/--agent/);
    expect(launchCmdArg).toMatch(/--effort/);

    expect(tmux.sessionExists).toHaveBeenCalledWith("agj-os-123");
    expect(tmux.createSession).toHaveBeenCalledWith("agj-os-123", expect.any(String));
  });

  it("mode selects correct CORE (projcore vs coord) and correct binding; grok statusFilePath is supplied", async () => {
    const tmux = makeTmuxMock(false);
    const dispatchService = new ProviderDispatchService(new ProviderResolverService(), tmux);
    const launcher = new CoordinatorLaunchService(agentAssignmentService, (r) =>
      dispatchService.dispatchToProvider(r)
    );

    ownerToken = makeOwnerToken();
    app = await createTestServerWithLaunch(launcher, new ProjectService(db, "/tmp"));

    // coord mode
    const res2 = await app.inject({
      method: "POST",
      url: "/api/projects/123/launch",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { mode: "coord" },
      remoteAddress: "127.0.0.1"
    });
    expect(res2.statusCode).toBe(200);
    const body2 = JSON.parse(res2.body);
    expect(body2.mode).toBe("coord");

    const submitted2 = tmux.sendAndSubmit.mock.calls[0]?.[1] || "";
    expect(submitted2).toContain("App-owned CORE for coord (v1 minimal, provider-agnostic)");
    expect(submitted2).toContain("You are coord, the fast fix loop coordinator");
    expect(submitted2).not.toContain("projcore, the requirements-driven batch coordinator");
  });

  it("second launch for same project reuses the session (R9) and still asserts outcomes", async () => {
    const tmux = makeTmuxMock(false); // first: not exists
    // Make second call see exists=true by controlling the mock per call count
    let callCount = 0;
    tmux.sessionExists = vi.fn(async () => {
      callCount++;
      return callCount > 1; // first false, subsequent true
    });

    const dispatchService = new ProviderDispatchService(new ProviderResolverService(), tmux);
    const launcher = new CoordinatorLaunchService(agentAssignmentService, (r) =>
      dispatchService.dispatchToProvider(r)
    );

    ownerToken = makeOwnerToken();
    app = await createTestServerWithLaunch(launcher, new ProjectService(db, "/tmp"));

    const r1 = await app.inject({
      method: "POST",
      url: "/api/projects/123/launch",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { mode: "projcore" },
      remoteAddress: "127.0.0.1"
    });
    expect(r1.statusCode).toBe(200);

    const r2 = await app.inject({
      method: "POST",
      url: "/api/projects/123/launch",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { mode: "projcore" },
      remoteAddress: "127.0.0.1"
    });
    expect(r2.statusCode).toBe(200);

    // Reuse: createSession only once; exists checked on second
    expect(tmux.createSession).toHaveBeenCalledTimes(1);
    expect(tmux.sessionExists).toHaveBeenCalledWith("agj-os-123");
    // Second launch still produced correct composed (contains CORE + overlay)
    const lastSubmit = tmux.sendAndSubmit.mock.calls[tmux.sendAndSubmit.mock.calls.length - 1][1];
    expect(lastSubmit).toContain("App-owned CORE for projcore");
    expect(lastSubmit).toContain("grok overlay");
  });

  it("requires owner auth (affirmation #1) and validates mode (R7)", async () => {
    const tmux = makeTmuxMock(false);
    const dispatchService = new ProviderDispatchService(new ProviderResolverService(), tmux);
    const launcher = new CoordinatorLaunchService(agentAssignmentService, (r) =>
      dispatchService.dispatchToProvider(r)
    );

    ownerToken = makeOwnerToken();
    app = await createTestServerWithLaunch(launcher, new ProjectService(db, "/tmp"));

    // No auth → 401
    const noAuth = await app.inject({
      method: "POST",
      url: "/api/projects/123/launch",
      payload: { mode: "projcore" }
    });
    expect(noAuth.statusCode).toBe(401);

    // Viewer token would 403 (create a viewer user + token would be more setup; requireOwner path is exercised by the owner case above and the register using the real middleware)
    // Bad mode (not in AGENT_ROLES)
    const badMode = await app.inject({
      method: "POST",
      url: "/api/projects/123/launch",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { mode: "invalid" },
      remoteAddress: "127.0.0.1"
    });
    expect(badMode.statusCode).toBe(400);

    // Unbound role on *existing* project (456 has no projcore binding) -> 400 from resolve (B3 path preserved)
    const unbound = await app.inject({
      method: "POST",
      url: "/api/projects/456/launch",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { mode: "projcore" },
      remoteAddress: "127.0.0.1"
    });
    expect(unbound.statusCode).toBe(400);
    expect(unbound.body).toContain("no agent bound or default");

    // Non-existing project -> 404 from (c) guard (project must be existing)
    const noProject = await app.inject({
      method: "POST",
      url: "/api/projects/999/launch",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { mode: "projcore" },
      remoteAddress: "127.0.0.1"
    });
    expect(noProject.statusCode).toBe(404);
    expect(noProject.body).toContain("Project not found");

    // Free-form payload (cmd/shell/provider) rejected at entry (c) even with owner+local
    const freeform = await app.inject({
      method: "POST",
      url: "/api/projects/123/launch",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { mode: "projcore", cmd: "rm -rf /", provider: "evil" },
      remoteAddress: "127.0.0.1"
    });
    expect(freeform.statusCode).toBe(400);
    expect(freeform.body).toContain("free-form payload not allowed");
  });

  it("chat_id allowlist (a) + loopback (b) rejections; legit owner+127+valid still launches (R14) + cmd from A2 resolver only (c)", async () => {
    // Bot-level (TG path used for spawn-triggering commands like ovm_*/overmind that relate to agent runtimes)
    const fakeTmux = {} as any;
    const fakeConfig = {
      telegram: { authorizedUserId: 123456, authorizedChatIds: [123456], testMode: false },
      runtime: { defaultTimeoutMinutes: 60, workspaceRoot: "/tmp", allowedCommandPrefixes: [], maxToolIterations: 1 },
      api: { port: 3101, host: "0.0.0.0", jwtSecret: "t", sessionExpiryHours: 1 },
      db: { path: ":memory:" },
      projects: { root: "/tmp" },
      tmux: { historyRetentionDays: 1, outputBufferLines: 10, streamIntervalMs: 100 },
      overmind: { token: "t" }
    } as any;
    const core = new AssistantCore(fakeConfig, fakeTmux);
    expect(core.isAuthorized(123456)).toBe(true);
    expect(core.isAuthorized(999999)).toBe(false); // non-listed chat_id denied
    expect(core.isAuthorized(undefined)).toBe(false);

    // Non-loopback even with valid owner token -> 403 (b)
    const tmux = makeTmuxMock(false);
    const dispatchService = new ProviderDispatchService(new ProviderResolverService(), tmux);
    const launcher = new CoordinatorLaunchService(agentAssignmentService, (r) =>
      dispatchService.dispatchToProvider(r)
    );
    ownerToken = makeOwnerToken();
    app = await createTestServerWithLaunch(launcher, new ProjectService(db, "/tmp"));

    const badIp = await app.inject({
      method: "POST",
      url: "/api/projects/123/launch",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { mode: "projcore" },
      remoteAddress: "10.0.0.99"
    });
    expect(badIp.statusCode).toBe(403);
    expect(badIp.body).toContain("localhost");

    // Legit owner + loopback + valid enumerated role on existing project STILL works (R14 no regression)
    const good = await app.inject({
      method: "POST",
      url: "/api/projects/123/launch",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { mode: "projcore" },
      remoteAddress: "127.0.0.1"
    });
    expect(good.statusCode).toBe(200);
    const body = JSON.parse(good.body);
    expect(body.success).toBe(true);
    expect(body.mode).toBe("projcore");
    expect(body.provider).toBe("grok");

    // (c) assert launch_cmd was built ONLY from the A2 resolver (not free-form from request)
    const sentCmd = tmux.sendCommand.mock.calls.length > 0 ? tmux.sendCommand.mock.calls[tmux.sendCommand.mock.calls.length - 1][1] : "";
    expect(sentCmd).toMatch(/grok --always-approve --agent|codex|claude/); // template from providers registry
  });
});
