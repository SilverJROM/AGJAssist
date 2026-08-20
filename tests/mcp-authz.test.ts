import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerMcpManagementRoutes } from "../src/api/routes/mcp-management-routes.js";
import { registerMcpRoutes } from "../src/api/routes/mcp-routes.js";
import { AuthService } from "../src/auth/auth-service.js";
import { DatabaseService } from "../src/db/database.js";
import { McpBearerService } from "../src/mcp/mcp-bearer-service.js";
import { McpClientService } from "../src/mcp/mcp-client-service.js";
import { McpGrantService } from "../src/mcp/mcp-grant-service.js";
import { McpPoolService } from "../src/mcp/mcp-pool-service.js";
import { McpRateLimiter } from "../src/mcp/mcp-rate-limit.js";
import { McpScopeService } from "../src/mcp/mcp-scope-service.js";
import { McpTokenService } from "../src/mcp/mcp-token-service.js";
import { AuditService } from "../src/services/audit-service.js";
import { FileService } from "../src/services/file-service.js";
import { ProjectService } from "../src/services/project-service.js";
import { TerminalGroupsService } from "../src/services/terminal-groups-service.js";
import { TmuxService } from "../src/tmux/tmux-service.js";

const HOST = "localhost:3101";
const ORIGIN = "http://localhost:3101";
const AUDIENCE = `${ORIGIN}/mcp`;
const PROTOCOL_VERSION = "2025-06-18";

interface TestContext {
  app: FastifyInstance;
  db: DatabaseService;
  address: URL;
  ownerId: number;
  tokens: McpTokenService;
  grants: McpGrantService;
  pool: McpPoolService;
  accessToken: string;
  grantId: number;
  grokId: string;
}

let context: TestContext | null = null;
let tempDir = "";

async function boot(): Promise<TestContext> {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agj-mcp-authz-"));
  const db = new DatabaseService(path.join(tempDir, "test.sqlite"));
  db.ensureOwner(111);
  const ownerId = (db.prepare("SELECT id FROM users WHERE telegram_id = 111").get() as { id: number }).id;
  const audit = new AuditService(db);
  const authService = {
    verifyToken: (token: string) => {
      if (token === "owner-jwt") {
        return { id: ownerId, telegramId: 111, username: "jrom", displayName: "JROM", role: "owner" };
      }
      if (token === "viewer-jwt") {
        return { id: ownerId, telegramId: 111, username: "view", displayName: "V", role: "viewer" };
      }
      return null;
    }
  } as unknown as AuthService;
  const clients = new McpClientService(db);
  const tokens = new McpTokenService(db, audit);
  const grants = new McpGrantService(db, tokens, audit);
  const pool = new McpPoolService(db, audit);
  const groups = new TerminalGroupsService(db);
  const scope = new McpScopeService(db, groups, pool);
  const tmux = new TmuxService();
  vi.spyOn(tmux, "listPanes").mockResolvedValue([
    {
      target: "NORTH:0.0",
      session: "NORTH",
      window: "0",
      pane: "0",
      command: "node",
      title: "north",
      activity: 1
    },
    {
      target: "OTHER:0.0",
      session: "OTHER",
      window: "0",
      pane: "0",
      command: "node",
      title: "other",
      activity: 1
    }
  ]);
  vi.spyOn(tmux, "peekPane").mockResolvedValue("idle");
  pool.replaceSet(ownerId, ["NORTH", "OTHER"]);
  const grok = clients.register({
    client_name: "grok",
    redirect_uris: ["https://client.example/callback"]
  });
  const grant = grants.create({
    clientId: grok.id,
    grantedBy: ownerId,
    scopeType: "sessions",
    scopeRef: JSON.stringify(["NORTH"]),
    permissions: ["list_sessions", "read_session", "send_message"]
  });
  const pair = tokens.mintPair({ grantId: grant.id, audience: AUDIENCE });
  const bearer = new McpBearerService(tokens, grants, scope, tmux);
  const app = Fastify({ logger: false });
  registerMcpRoutes(app, {
    bearer,
    limiter: new McpRateLimiter(),
    audit,
    tmux,
    db,
    files: new FileService(),
    projects: new ProjectService(db, path.join(tempDir, "projects"))
  });
  registerMcpManagementRoutes(app, { db, authService, pool, grants, clients, audit });
  const address = new URL(await app.listen({ host: "127.0.0.1", port: 0 }));
  context = {
    app,
    db,
    address,
    ownerId,
    tokens,
    grants,
    pool,
    accessToken: pair.accessToken,
    grantId: grant.id,
    grokId: grok.id
  };
  return context;
}

function mcpRpc(ctx: TestContext, token: string | null, body: unknown) {
  const payload = JSON.stringify(body);
  return new Promise<{ status: number; json: Record<string, any> }>((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: ctx.address.port,
        path: "/mcp",
        method: "POST",
        headers: {
          host: HOST,
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
          "content-length": String(Buffer.byteLength(payload)),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          "mcp-protocol-version": PROTOCOL_VERSION
        }
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (c: Buffer) => chunks.push(c));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: response.statusCode ?? 0,
            json: text ? (JSON.parse(text) as Record<string, any>) : {}
          });
        });
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

afterEach(async () => {
  if (context) {
    await context.app.close();
    context.db.close();
  }
  context = null;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = "";
  vi.restoreAllMocks();
});

function walkTs(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) out.push(...walkTs(full));
    else if (name.endsWith(".ts") || name.endsWith(".js")) out.push(full);
  }
  return out;
}

describe("MCP owner admin authz (B19)", () => {
  it("AC-14: MCP access token is 401 on owner APIs; viewer is 403", async () => {
    const ctx = await boot();
    const mcpOnPool = await ctx.app.inject({
      method: "GET",
      url: "/api/mcp/pool",
      headers: { authorization: `Bearer ${ctx.accessToken}` }
    });
    expect(mcpOnPool.statusCode).toBe(401);

    const viewer = await ctx.app.inject({
      method: "GET",
      url: "/api/mcp/pool",
      headers: { authorization: "Bearer viewer-jwt" }
    });
    expect(viewer.statusCode).toBe(403);

    const jwtOnMcp = await mcpRpc(ctx, "owner-jwt", {
      jsonrpc: "2.0",
      id: 1,
      method: "ping",
      params: {}
    });
    expect(jwtOnMcp.status).toBe(401);
  });

  it("AC-11: owner revoke 401s the next /mcp call", async () => {
    const ctx = await boot();
    const before = await mcpRpc(ctx, ctx.accessToken, {
      jsonrpc: "2.0",
      id: 1,
      method: "ping",
      params: {}
    });
    expect(before.status).toBe(200);

    const revoked = await ctx.app.inject({
      method: "POST",
      url: `/api/mcp/grants/${ctx.grantId}/revoke`,
      headers: { authorization: "Bearer owner-jwt" }
    });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json().status).toBe("revoked");

    const after = await mcpRpc(ctx, ctx.accessToken, {
      jsonrpc: "2.0",
      id: 2,
      method: "ping",
      params: {}
    });
    expect(after.status).toBe(401);
    const row = ctx.db
      .prepare("SELECT action_type FROM audit_log WHERE action_type = 'mcp_grant_revoked' ORDER BY id DESC LIMIT 1")
      .get() as { action_type: string };
    expect(row.action_type).toBe("mcp_grant_revoked");
  });

  it("AC-24: pool persists in SQLite and MCP sources do not use localStorage groups", async () => {
    const ctx = await boot();
    ctx.pool.replaceSet(ctx.ownerId, []);
    const empty = await ctx.app.inject({
      method: "GET",
      url: "/api/mcp/pool",
      headers: { authorization: "Bearer owner-jwt" }
    });
    expect(empty.json()).toEqual({ sessions: [] });

    const put = await ctx.app.inject({
      method: "PUT",
      url: "/api/mcp/pool",
      headers: { authorization: "Bearer owner-jwt" },
      payload: { sessions: ["NORTH"] }
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().sessions).toEqual(["NORTH"]);

    const got = await ctx.app.inject({
      method: "GET",
      url: "/api/mcp/pool",
      headers: { authorization: "Bearer owner-jwt" }
    });
    expect(got.json().sessions).toEqual(["NORTH"]);
    const stored = ctx.db
      .prepare("SELECT session_name FROM mcp_grantable_pool ORDER BY session_name")
      .all() as { session_name: string }[];
    expect(stored.map((r) => r.session_name)).toEqual(["NORTH"]);

    const files = [
      ...walkTs(path.join(process.cwd(), "src/mcp")),
      ...walkTs(path.join(process.cwd(), "src/api/routes")).filter((f) => path.basename(f).startsWith("mcp-"))
    ];
    const hits = files.filter((f) => {
      const text = fs.readFileSync(f, "utf8");
      return /agj_terminal_groups|localStorage/.test(text);
    });
    expect(hits).toEqual([]);
  });

  it("GET /api/mcp/audit is forced to surface=mcp and paginated", async () => {
    const ctx = await boot();
    ctx.db
      .prepare(
        "INSERT INTO audit_log (user_id, action_type, details, surface) VALUES (?, 'web_only', '{}', 'web')"
      )
      .run(ctx.ownerId);
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/mcp/audit?limit=50&offset=0&surface=web",
      headers: { authorization: "Bearer owner-jwt" }
    });
    expect(res.statusCode).toBe(200);
    const entries = res.json().entries as Array<{ surface: string; action_type: string }>;
    expect(entries.every((e) => e.surface === "mcp")).toBe(true);
    expect(entries.some((e) => e.action_type === "web_only")).toBe(false);
    expect(res.json().limit).toBe(50);
  });
});
