import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerMcpRoutes } from "../src/api/routes/mcp-routes.js";
import { DatabaseService } from "../src/db/database.js";
import { McpBearerService } from "../src/mcp/mcp-bearer-service.js";
import { McpClientService } from "../src/mcp/mcp-client-service.js";
import { McpGrantService } from "../src/mcp/mcp-grant-service.js";
import { McpPoolService } from "../src/mcp/mcp-pool-service.js";
import {
  MCP_TOOLS_CALL_LIMIT,
  MCP_TOOLS_CALL_WINDOW_MS,
  McpRateLimiter
} from "../src/mcp/mcp-rate-limit.js";
import { McpScopeService } from "../src/mcp/mcp-scope-service.js";
import { McpTokenService } from "../src/mcp/mcp-token-service.js";
import { AuditService } from "../src/services/audit-service.js";
import { TerminalGroupsService } from "../src/services/terminal-groups-service.js";
import { TmuxService } from "../src/tmux/tmux-service.js";

const HOST = "localhost:3101";
const ORIGIN = "http://localhost:3101";
const AUDIENCE = `${ORIGIN}/mcp`;
const PROTOCOL_VERSION = "2025-06-18";
const WWW_AUTHENTICATE =
  `Bearer realm="mcp", error="invalid_token", ` +
  `resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource"`;

interface HttpResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  text: string;
  json: Record<string, any>;
}

interface TestContext {
  app: FastifyInstance;
  db: DatabaseService;
  address: URL;
  bearer: McpBearerService;
  tokens: McpTokenService;
  tmux: TmuxService;
  accessToken: string;
  grantId: number;
}

let context: TestContext | null = null;
let tempDir = "";

async function boot(options: {
  permissions?: string[];
  limiter?: McpRateLimiter;
} = {}): Promise<TestContext> {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agj-mcp-routes-"));
  const db = new DatabaseService(path.join(tempDir, "test.sqlite"));
  db.ensureOwner(111);
  const ownerId = (db.prepare("SELECT id FROM users WHERE telegram_id = 111").get() as {
    id: number;
  }).id;
  const audit = new AuditService(db);
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
      title: "north"
    }
  ]);
  vi.spyOn(tmux, "peekPane").mockResolvedValue("idle");
  vi.spyOn(tmux, "capturePane").mockResolvedValue("idle");
  pool.replaceSet(ownerId, ["NORTH"]);
  const client = clients.register({
    client_name: "mcp-route-fixture",
    redirect_uris: ["https://client.example/callback"]
  });
  const grant = grants.create({
    clientId: client.id,
    grantedBy: ownerId,
    scopeType: "sessions",
    scopeRef: JSON.stringify(["NORTH"]),
    permissions: options.permissions ?? ["list_sessions", "read_session"]
  });
  const pair = tokens.mintPair({ grantId: grant.id, audience: AUDIENCE });
  const bearer = new McpBearerService(tokens, grants, scope, tmux);
  const app = Fastify({ logger: false });
  registerMcpRoutes(app, {
    bearer,
    limiter: options.limiter ?? new McpRateLimiter(),
    audit,
    tmux,
    db
  });
  const address = new URL(await app.listen({ host: "127.0.0.1", port: 0 }));
  context = {
    app,
    db,
    address,
    bearer,
    tokens,
    tmux,
    accessToken: pair.accessToken,
    grantId: grant.id
  };
  return context;
}

function request(
  ctx: TestContext,
  method: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<HttpResult> {
  const payload = body === undefined ? "" : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: ctx.address.port,
        path: "/mcp",
        method,
        headers: {
          host: HOST,
          accept: "application/json, text/event-stream",
          ...(body === undefined
            ? {}
            : {
                "content-type": "application/json",
                "content-length": String(Buffer.byteLength(payload))
              }),
          ...headers
        }
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            text,
            json: text ? JSON.parse(text) as Record<string, any> : {}
          });
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function rpc(
  ctx: TestContext,
  token: string | null,
  body: unknown,
  extraHeaders: Record<string, string> = {}
): Promise<HttpResult> {
  return request(ctx, "POST", body, {
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    "mcp-protocol-version": PROTOCOL_VERSION,
    ...extraHeaders
  });
}

function initialize(id: number = 1) {
  return {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "fixture-client", version: "1.0.0" }
    }
  };
}

function callTool(id: number, name: string) {
  return {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: {} }
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

describe("POST /mcp Streamable HTTP core (B15)", () => {
  it("returns the exact bearer challenge for missing, bad, revoked, and wrong-audience tokens (AC-12)", async () => {
    const ctx = await boot();
    const revoked = ctx.tokens.mintPair({ grantId: ctx.grantId, audience: AUDIENCE });
    ctx.tokens.revokePresentedToken(revoked.accessToken);
    const wrongAudience = ctx.tokens.mintPair({
      grantId: ctx.grantId,
      audience: "http://127.0.0.1:3101/mcp"
    });
    const variants: Array<string | null> = [
      null,
      "A".repeat(43),
      revoked.accessToken,
      wrongAudience.accessToken
    ];

    for (const token of variants) {
      const response = await rpc(ctx, token, initialize());
      expect(response.status).toBe(401);
      expect(response.headers["www-authenticate"]).toBe(WWW_AUTHENTICATE);
      expect(response.json).toEqual({ error: "invalid_token" });
    }
  });

  it("runs initialize, filtered tools/list, and ping over plain stateless HTTP (AC-6)", async () => {
    const ctx = await boot({ permissions: ["list_sessions", "read_session"] });
    const resolved = await ctx.bearer.resolve(`Bearer ${ctx.accessToken}`, ORIGIN);
    expect(resolved?.effectiveScope).toEqual(["NORTH"]);

    const initialized = await rpc(ctx, ctx.accessToken, initialize(1));
    expect(initialized.status).toBe(200);
    expect(initialized.headers["content-type"]).toContain("application/json");
    expect(initialized.headers["content-type"]).not.toContain("text/event-stream");
    expect(initialized.headers["mcp-session-id"]).toBeUndefined();
    expect(initialized.json.result.protocolVersion).toBe(PROTOCOL_VERSION);

    const listed = await rpc(ctx, ctx.accessToken, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {}
    });
    expect(listed.status).toBe(200);
    expect(listed.json.result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "list_sessions",
      "read_session"
    ]);

    const ping = await rpc(ctx, ctx.accessToken, {
      jsonrpc: "2.0",
      id: 3,
      method: "ping",
      params: {}
    });
    expect(ping.status).toBe(200);
    expect(ping.json).toEqual({ jsonrpc: "2.0", id: 3, result: {} });
  });

  it("returns an empty tools/list result when the active grant has no permissions", async () => {
    const ctx = await boot({ permissions: [] });
    const listed = await rpc(ctx, ctx.accessToken, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {}
    });

    expect(listed.status).toBe(200);
    expect(listed.json.result.tools).toEqual([]);
  });

  it("rejects JSON-RPC batches up front with HTTP 400 / -32600 (AC-20)", async () => {
    const ctx = await boot();
    const response = await rpc(ctx, ctx.accessToken, [
      initialize(1),
      { jsonrpc: "2.0", id: 2, method: "ping", params: {} }
    ]);

    expect(response.status).toBe(400);
    expect(response.json).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600, message: "Invalid Request" }
    });
  });

  it("rate-limits the 121st tools/call on one token and recovers after the window (AC-20)", async () => {
    let now = 1_000_000;
    const limiter = new McpRateLimiter({ now: () => now });
    const ctx = await boot({ permissions: ["list_sessions"], limiter });

    for (let i = 1; i <= MCP_TOOLS_CALL_LIMIT; i++) {
      const allowed = await rpc(ctx, ctx.accessToken, callTool(i, "list_sessions"));
      expect(allowed.status).toBe(200);
      expect(allowed.json.result.isError).not.toBe(true);
      expect(allowed.json.result.structuredContent.sessions).toEqual([
        expect.objectContaining({ session: "NORTH" })
      ]);
    }

    const blocked = await rpc(
      ctx,
      ctx.accessToken,
      callTool(MCP_TOOLS_CALL_LIMIT + 1, "list_sessions")
    );
    expect(blocked.status).toBe(200);
    expect(blocked.json.result.isError).toBe(true);
    expect(blocked.json.result.structuredContent.code).toBe("mcp_rate_limited");
    expect(blocked.json.result.structuredContent.retry_after).toBeGreaterThan(0);
    const rateAudit = ctx.db
      .prepare(
        "SELECT surface, details FROM audit_log WHERE action_type = 'mcp_rate_limited' ORDER BY id DESC LIMIT 1"
      )
      .get() as { surface: string; details: string };
    expect(rateAudit.surface).toBe("mcp");
    expect(JSON.parse(rateAudit.details).grant_id).toBe(ctx.grantId);

    now += MCP_TOOLS_CALL_WINDOW_MS + 1;
    const recovered = await rpc(
      ctx,
      ctx.accessToken,
      callTool(MCP_TOOLS_CALL_LIMIT + 2, "list_sessions")
    );
    expect(recovered.status).toBe(200);
    expect(recovered.json.result.isError).not.toBe(true);
    expect(recovered.json.result.structuredContent.sessions).toEqual([
      expect.objectContaining({ session: "NORTH" })
    ]);
  });

  it("denies lifecycle and pane-management tool names without invoking tmux (Blocker 6)", async () => {
    const ctx = await boot({
      permissions: [
        "list_sessions",
        "read_session",
        "send_message",
        "send_keys",
        "upload_image",
        "read_image"
      ]
    });
    const createSession = vi.spyOn(ctx.tmux, "createSession").mockResolvedValue("blocked:0.0");
    const terminateSession = vi.spyOn(ctx.tmux, "terminateSession").mockResolvedValue();
    const createPane = vi.spyOn(ctx.tmux, "createPane").mockResolvedValue("blocked:0.1");
    const terminatePane = vi.spyOn(ctx.tmux, "terminatePane").mockResolvedValue();
    const lifecycleTools = [
      "create_session",
      "terminate_session",
      "create_pane",
      "terminate_pane",
      "kill_pane",
      "split_pane",
      "kill-pane",
      "split-window"
    ];

    for (const [index, tool] of lifecycleTools.entries()) {
      const response = await rpc(ctx, ctx.accessToken, callTool(index + 1, tool));
      expect(response.status).toBe(200);
      expect(response.json.result).toMatchObject({
        isError: true,
        structuredContent: { code: "mcp_tool_denied" }
      });
    }

    const disallowedMethod = await rpc(ctx, ctx.accessToken, {
      jsonrpc: "2.0",
      id: 9,
      method: "resources/list",
      params: {}
    });
    expect(disallowedMethod.status).toBe(200);
    expect(disallowedMethod.json.error).toEqual({
      code: -32601,
      message: "Method not found",
      data: { code: "mcp_tool_denied", reason: "method" }
    });
    const denialReasons = ctx.db
      .prepare("SELECT details FROM audit_log WHERE action_type = 'mcp_tool_denied' ORDER BY id")
      .all()
      .map((row) => JSON.parse((row as { details: string }).details).reason);
    expect(denialReasons).toEqual([
      ...Array(lifecycleTools.length).fill("permission"),
      "method"
    ]);
    expect(createSession).not.toHaveBeenCalled();
    expect(terminateSession).not.toHaveBeenCalled();
    expect(createPane).not.toHaveBeenCalled();
    expect(terminatePane).not.toHaveBeenCalled();
  });

  it("rejects GET and DELETE because the tunnel transport is POST-only", async () => {
    const ctx = await boot();
    for (const method of ["GET", "DELETE"]) {
      const response = await request(ctx, method);
      expect(response.status).toBe(405);
      expect(response.headers.allow).toBe("POST");
    }
  });
});
