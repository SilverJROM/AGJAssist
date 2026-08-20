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
import { MCP_ERROR } from "../src/mcp/mcp-constants.js";
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
  clients: McpClientService;
  grokGrantId: number;
  grokToken: string;
  claudeGrantId: number;
  claudeToken: string;
  grokClientId: string;
  unusedClientId: string;
}

let context: TestContext | null = null;
let tempDir = "";

async function boot(): Promise<TestContext> {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agj-mcp-live-edit-"));
  const db = new DatabaseService(path.join(tempDir, "test.sqlite"));
  db.ensureOwner(111);
  const ownerId = (db.prepare("SELECT id FROM users WHERE telegram_id = 111").get() as { id: number }).id;
  const audit = new AuditService(db);
  const authService = {
    verifyToken: (token: string) =>
      token === "owner-jwt"
        ? { id: ownerId, telegramId: 111, username: "jrom", displayName: "JROM", role: "owner" }
        : null
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
  vi.spyOn(tmux, "sendCommand").mockResolvedValue({ message: "sent", blocked: false });
  pool.replaceSet(ownerId, ["NORTH", "OTHER"]);
  const grok = clients.register({
    client_name: "grok",
    redirect_uris: ["https://client.example/g"]
  });
  const claude = clients.register({
    client_name: "claude",
    redirect_uris: ["https://client.example/c"]
  });
  const unused = clients.register({
    client_name: "unused",
    redirect_uris: ["https://client.example/u"]
  });
  const grokGrant = grants.create({
    clientId: grok.id,
    grantedBy: ownerId,
    scopeType: "sessions",
    scopeRef: JSON.stringify(["NORTH"]),
    permissions: ["list_sessions", "read_session", "send_message"]
  });
  const claudeGrant = grants.create({
    clientId: claude.id,
    grantedBy: ownerId,
    scopeType: "sessions",
    scopeRef: JSON.stringify(["OTHER"]),
    permissions: ["list_sessions", "read_session"]
  });
  const grokPair = tokens.mintPair({ grantId: grokGrant.id, audience: AUDIENCE });
  const claudePair = tokens.mintPair({ grantId: claudeGrant.id, audience: AUDIENCE });
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
    clients,
    grokGrantId: grokGrant.id,
    grokToken: grokPair.accessToken,
    claudeGrantId: claudeGrant.id,
    claudeToken: claudePair.accessToken,
    grokClientId: grok.id,
    unusedClientId: unused.id
  };
  return context;
}

function mcpRpc(ctx: TestContext, token: string, body: unknown) {
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
          authorization: `Bearer ${token}`,
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

function listCall(id: number) {
  return { jsonrpc: "2.0", id, method: "tools/call", params: { name: "list_sessions", arguments: {} } };
}

function readCall(id: number, session: string) {
  return {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name: "read_session", arguments: { session } }
  };
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

describe("MCP live-edit APIs (B19)", () => {
  it("AC-25/26: live scope edit takes effect; outside-pool is 400 and unchanged", async () => {
    const ctx = await boot();
    const listed = await mcpRpc(ctx, ctx.grokToken, listCall(1));
    expect(listed.json.result.structuredContent.sessions.map((s: { session: string }) => s.session)).toEqual([
      "NORTH"
    ]);

    const bad = await ctx.app.inject({
      method: "PATCH",
      url: `/api/mcp/grants/${ctx.grokGrantId}/scope`,
      headers: { authorization: "Bearer owner-jwt" },
      payload: { sessions: ["NORTH", "NOTINPOOL"] }
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe("outside_pool");
    const still = await mcpRpc(ctx, ctx.grokToken, listCall(2));
    expect(still.json.result.structuredContent.sessions.map((s: { session: string }) => s.session)).toEqual([
      "NORTH"
    ]);

    const ok = await ctx.app.inject({
      method: "PATCH",
      url: `/api/mcp/grants/${ctx.grokGrantId}/scope`,
      headers: { authorization: "Bearer owner-jwt" },
      payload: { sessions: ["NORTH", "OTHER"] }
    });
    expect(ok.statusCode).toBe(200);
    const expanded = await mcpRpc(ctx, ctx.grokToken, listCall(3));
    expect(expanded.json.result.structuredContent.sessions.map((s: { session: string }) => s.session).sort()).toEqual(
      ["NORTH", "OTHER"]
    );

    await ctx.app.inject({
      method: "PATCH",
      url: `/api/mcp/grants/${ctx.grokGrantId}/scope`,
      headers: { authorization: "Bearer owner-jwt" },
      payload: { sessions: ["OTHER"] }
    });
    const northDenied = await mcpRpc(ctx, ctx.grokToken, readCall(4, "NORTH"));
    expect(northDenied.json.result.structuredContent.code).toBe(MCP_ERROR.sessionNotFound.code);
    const otherOk = await mcpRpc(ctx, ctx.grokToken, readCall(5, "OTHER"));
    expect(otherOk.json.result.isError).not.toBe(true);
  });

  it("AC-27: removing a name from the pool caps effective scope and does not restore on re-add", async () => {
    const ctx = await boot();
    await ctx.app.inject({
      method: "PATCH",
      url: `/api/mcp/grants/${ctx.grokGrantId}/scope`,
      headers: { authorization: "Bearer owner-jwt" },
      payload: { sessions: ["NORTH", "OTHER"] }
    });
    const cap = await ctx.app.inject({
      method: "PUT",
      url: "/api/mcp/pool",
      headers: { authorization: "Bearer owner-jwt" },
      payload: { sessions: ["NORTH"] }
    });
    expect(cap.statusCode).toBe(200);
    const listed = await mcpRpc(ctx, ctx.grokToken, listCall(1));
    expect(listed.json.result.structuredContent.sessions.map((s: { session: string }) => s.session)).toEqual([
      "NORTH"
    ]);
    const denied = await mcpRpc(ctx, ctx.grokToken, readCall(2, "OTHER"));
    expect(denied.json.result.structuredContent.code).toBe(MCP_ERROR.sessionNotFound.code);

    await ctx.app.inject({
      method: "PUT",
      url: "/api/mcp/pool",
      headers: { authorization: "Bearer owner-jwt" },
      payload: { sessions: ["NORTH", "OTHER"] }
    });
    const still = await mcpRpc(ctx, ctx.grokToken, listCall(3));
    expect(still.json.result.structuredContent.sessions.map((s: { session: string }) => s.session)).toEqual([
      "NORTH"
    ]);
  });

  it("AC-28: permission toggle affects tools/list and tools/call without a new token", async () => {
    const ctx = await boot();
    const off = await ctx.app.inject({
      method: "PATCH",
      url: `/api/mcp/grants/${ctx.grokGrantId}/permissions`,
      headers: { authorization: "Bearer owner-jwt" },
      payload: { permissions: ["list_sessions", "read_session"] }
    });
    expect(off.statusCode).toBe(200);
    const listed = await mcpRpc(ctx, ctx.grokToken, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {}
    });
    expect(listed.json.result.tools.map((t: { name: string }) => t.name)).toEqual([
      "list_sessions",
      "read_session"
    ]);
    const denied = await mcpRpc(ctx, ctx.grokToken, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "send_message", arguments: { session: "NORTH", text: "hi" } }
    });
    expect(denied.json.result.structuredContent.code).toBe("mcp_tool_denied");

    await ctx.app.inject({
      method: "PATCH",
      url: `/api/mcp/grants/${ctx.grokGrantId}/permissions`,
      headers: { authorization: "Bearer owner-jwt" },
      payload: { permissions: ["list_sessions", "read_session", "send_message"] }
    });
    const restored = await mcpRpc(ctx, ctx.grokToken, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/list",
      params: {}
    });
    expect(restored.json.result.tools.map((t: { name: string }) => t.name)).toContain("send_message");
  });

  it("AC-29/30: revoked grant PATCH is 409; editing grok does not change claude", async () => {
    const ctx = await boot();
    const claudeBefore = await mcpRpc(ctx, ctx.claudeToken, listCall(1));
    expect(claudeBefore.json.result.structuredContent.sessions.map((s: { session: string }) => s.session)).toEqual([
      "OTHER"
    ]);

    await ctx.app.inject({
      method: "PATCH",
      url: `/api/mcp/grants/${ctx.grokGrantId}/scope`,
      headers: { authorization: "Bearer owner-jwt" },
      payload: { sessions: ["NORTH", "OTHER"] }
    });
    const claudeAfter = await mcpRpc(ctx, ctx.claudeToken, listCall(2));
    expect(claudeAfter.json.result.structuredContent.sessions.map((s: { session: string }) => s.session)).toEqual([
      "OTHER"
    ]);

    await ctx.app.inject({
      method: "POST",
      url: `/api/mcp/grants/${ctx.grokGrantId}/revoke`,
      headers: { authorization: "Bearer owner-jwt" }
    });
    const patched = await ctx.app.inject({
      method: "PATCH",
      url: `/api/mcp/grants/${ctx.grokGrantId}/scope`,
      headers: { authorization: "Bearer owner-jwt" },
      payload: { sessions: ["NORTH"] }
    });
    expect(patched.statusCode).toBe(409);
    const missing = await ctx.app.inject({
      method: "PATCH",
      url: "/api/mcp/grants/99999/scope",
      headers: { authorization: "Bearer owner-jwt" },
      payload: { sessions: ["NORTH"] }
    });
    expect(missing.statusCode).toBe(404);

    const claudeStill = await mcpRpc(ctx, ctx.claudeToken, listCall(3));
    expect(claudeStill.json.result.structuredContent.sessions.map((s: { session: string }) => s.session)).toEqual([
      "OTHER"
    ]);
  });

  it("lifetime requires typed confirm; clients DELETE refuses grant history", async () => {
    const ctx = await boot();
    const noConfirm = await ctx.app.inject({
      method: "PATCH",
      url: `/api/mcp/grants/${ctx.grokGrantId}/lifetime`,
      headers: { authorization: "Bearer owner-jwt" },
      payload: { lifetime: true }
    });
    expect(noConfirm.statusCode).toBe(400);

    const on = await ctx.app.inject({
      method: "PATCH",
      url: `/api/mcp/grants/${ctx.grokGrantId}/lifetime`,
      headers: { authorization: "Bearer owner-jwt" },
      payload: { lifetime: true, confirm: "LIFETIME" }
    });
    expect(on.statusCode).toBe(200);
    expect(on.json().lifetime).toBe(true);
    const expiry = ctx.db
      .prepare("SELECT expires_at FROM mcp_tokens WHERE grant_id = ? AND token_type = 'access'")
      .get(ctx.grokGrantId) as { expires_at: string | null };
    expect(expiry.expires_at).toBeNull();

    const listed = await ctx.app.inject({
      method: "GET",
      url: "/api/mcp/grants",
      headers: { authorization: "Bearer owner-jwt" }
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().grants.length).toBeGreaterThanOrEqual(2);

    const blocked = await ctx.app.inject({
      method: "DELETE",
      url: `/api/mcp/clients/${ctx.grokClientId}`,
      headers: { authorization: "Bearer owner-jwt" }
    });
    expect(blocked.statusCode).toBe(409);

    const removed = await ctx.app.inject({
      method: "DELETE",
      url: `/api/mcp/clients/${ctx.unusedClientId}`,
      headers: { authorization: "Bearer owner-jwt" }
    });
    expect(removed.statusCode).toBe(204);
  });
});
