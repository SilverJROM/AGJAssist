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
import { McpRateLimiter } from "../src/mcp/mcp-rate-limit.js";
import { McpScopeService } from "../src/mcp/mcp-scope-service.js";
import { McpTokenService } from "../src/mcp/mcp-token-service.js";
import { MCP_ERROR } from "../src/mcp/mcp-constants.js";
import { AuditService } from "../src/services/audit-service.js";
import { TerminalGroupsService } from "../src/services/terminal-groups-service.js";
import { TmuxService, type TmuxPane } from "../src/tmux/tmux-service.js";

const HOST = "localhost:3101";
const ORIGIN = "http://localhost:3101";
const AUDIENCE = `${ORIGIN}/mcp`;
const PROTOCOL_VERSION = "2025-06-18";

function pane(session: string, extras: Partial<TmuxPane> = {}): TmuxPane {
  return {
    target: `${session}:0.0`,
    session,
    window: "0",
    pane: "0",
    command: "node",
    title: session.toLowerCase(),
    activity: 1_700_000_000,
    ...extras
  };
}

interface HttpResult {
  status: number;
  json: Record<string, any>;
}

interface TestContext {
  app: FastifyInstance;
  db: DatabaseService;
  address: URL;
  tmux: TmuxService;
  accessToken: string;
}

let context: TestContext | null = null;
let tempDir = "";

async function boot(): Promise<TestContext> {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agj-mcp-tools-read-"));
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
    pane("NORTH", { activity: 100 }),
    pane("OTHER", { activity: 50 }),
    pane("ORPHAN", { activity: 9 })
  ]);
  const peek = vi.spyOn(tmux, "peekPane").mockImplementation(async (target: string) => {
    if (target.startsWith("NORTH")) return "NORTH output cleaned";
    if (target.startsWith("OTHER")) return "OTHER should not leak";
    return "unexpected peek";
  });
  vi.spyOn(tmux, "capturePane").mockResolvedValue("NORTH\x1b[31mraw\x1b[0m");
  pool.replaceSet(ownerId, ["NORTH", "OTHER"]);
  const client = clients.register({
    client_name: "reader",
    redirect_uris: ["https://client.example/callback"]
  });
  const grant = grants.create({
    clientId: client.id,
    grantedBy: ownerId,
    scopeType: "sessions",
    scopeRef: JSON.stringify(["NORTH"]),
    permissions: ["list_sessions", "read_session"]
  });
  const pair = tokens.mintPair({ grantId: grant.id, audience: AUDIENCE });
  const bearer = new McpBearerService(tokens, grants, scope, tmux);
  const app = Fastify({ logger: false });
  registerMcpRoutes(app, {
    bearer,
    limiter: new McpRateLimiter(),
    audit,
    tmux,
    db
  });
  const address = new URL(await app.listen({ host: "127.0.0.1", port: 0 }));
  context = { app, db, address, tmux, accessToken: pair.accessToken };
  void peek;
  return context;
}

function rpc(ctx: TestContext, body: unknown): Promise<HttpResult> {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
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
          authorization: `Bearer ${ctx.accessToken}`,
          "mcp-protocol-version": PROTOCOL_VERSION
        }
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
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

function callTool(id: number, name: string, args: Record<string, unknown> = {}) {
  return {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: args }
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

const NOT_FOUND = {
  isError: true,
  content: [{ type: "text", text: MCP_ERROR.sessionNotFound.text }],
  structuredContent: { code: MCP_ERROR.sessionNotFound.code }
};

describe("MCP read tools (B16)", () => {
  it("AC-10: list_sessions returns only the grant's effective session", async () => {
    const ctx = await boot();
    const listed = await rpc(ctx, callTool(1, "list_sessions"));
    expect(listed.status).toBe(200);
    expect(listed.json.result.isError).not.toBe(true);
    const sessions = listed.json.result.structuredContent.sessions as Array<{ session: string }>;
    expect(sessions.map((s) => s.session)).toEqual(["NORTH"]);
    expect(JSON.stringify(listed.json.result)).not.toContain("OTHER");
    expect(JSON.stringify(listed.json.result)).not.toContain("ORPHAN");
  });

  it("AC-9(read): in-pool-ungranted, out-of-pool, and nonexistent are byte-identical and skip pane I/O", async () => {
    const ctx = await boot();
    const peek = ctx.tmux.peekPane as unknown as ReturnType<typeof vi.fn>;
    const capture = ctx.tmux.capturePane as unknown as ReturnType<typeof vi.fn>;
    peek.mockClear();
    capture.mockClear();

    const bodies = [];
    for (const [id, session] of [
      [1, "OTHER"],
      [2, "ORPHAN"],
      [3, "no-such-sess"]
    ] as const) {
      const res = await rpc(ctx, callTool(id, "read_session", { session }));
      expect(res.status).toBe(200);
      bodies.push(JSON.stringify(res.json.result));
      expect(res.json.result).toMatchObject(NOT_FOUND);
    }
    expect(bodies[0]).toBe(bodies[1]);
    expect(bodies[1]).toBe(bodies[2]);
    expect(peek).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();

    const denials = ctx.db
      .prepare("SELECT details FROM audit_log WHERE action_type = 'mcp_tool_denied' ORDER BY id")
      .all() as { details: string }[];
    expect(denials.length).toBeGreaterThanOrEqual(3);
    for (const row of denials.slice(-3)) {
      expect(JSON.parse(row.details).reason).toBe("scope");
      expect(JSON.parse(row.details).tool).toBe("read_session");
    }
  });

  it("AC-16(read): peekPane cleaned by default and capturePane when raw=true", async () => {
    const ctx = await boot();
    const cleaned = await rpc(ctx, callTool(1, "read_session", { session: "NORTH" }));
    expect(cleaned.status).toBe(200);
    expect(cleaned.json.result.structuredContent).toMatchObject({
      session: "NORTH",
      target: "NORTH",
      output: "NORTH output cleaned",
      lines: 200
    });
    const raw = await rpc(
      ctx,
      callTool(2, "read_session", { session: "NORTH:0.0", raw: true, lines: 40 })
    );
    expect(raw.json.result.structuredContent).toMatchObject({
      session: "NORTH",
      target: "NORTH:0.0",
      output: "NORTH\x1b[31mraw\x1b[0m",
      lines: 40
    });
    expect(ctx.tmux.peekPane).toHaveBeenCalledWith("NORTH", 200);
    expect(ctx.tmux.capturePane).toHaveBeenCalledWith("NORTH:0.0", 40);
  });
});
