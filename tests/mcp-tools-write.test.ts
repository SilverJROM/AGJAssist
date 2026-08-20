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
import { MCP_ERROR } from "../src/mcp/mcp-constants.js";
import { McpGrantService } from "../src/mcp/mcp-grant-service.js";
import { McpPoolService } from "../src/mcp/mcp-pool-service.js";
import { McpRateLimiter } from "../src/mcp/mcp-rate-limit.js";
import { McpScopeService } from "../src/mcp/mcp-scope-service.js";
import { McpTokenService } from "../src/mcp/mcp-token-service.js";
import { AuditService } from "../src/services/audit-service.js";
import { SafetyService } from "../src/services/safety-service.js";
import { TerminalGroupsService } from "../src/services/terminal-groups-service.js";
import { TmuxService, type TmuxPane } from "../src/tmux/tmux-service.js";

const HOST = "localhost:3101";
const ORIGIN = "http://localhost:3101";
const AUDIENCE = `${ORIGIN}/mcp`;
const PROTOCOL_VERSION = "2025-06-18";

function pane(session: string): TmuxPane {
  return {
    target: `${session}:0.0`,
    session,
    window: "0",
    pane: "0",
    command: "node",
    title: session.toLowerCase(),
    activity: 1
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
  paneText: { value: string };
}

let context: TestContext | null = null;
let tempDir = "";

async function boot(): Promise<TestContext> {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agj-mcp-tools-write-"));
  const db = new DatabaseService(path.join(tempDir, "test.sqlite"));
  db.ensureOwner(111);
  const ownerId = (db.prepare("SELECT id FROM users WHERE telegram_id = 111").get() as {
    id: number;
  }).id;
  const audit = new AuditService(db);
  const safety = new SafetyService(db);
  const clients = new McpClientService(db);
  const tokens = new McpTokenService(db, audit);
  const grants = new McpGrantService(db, tokens, audit);
  const pool = new McpPoolService(db, audit);
  const groups = new TerminalGroupsService(db);
  const scope = new McpScopeService(db, groups, pool);
  const tmux = new TmuxService();
  tmux.setSafetyService(safety);
  const paneText = { value: "prompt ❯" };
  vi.spyOn(tmux, "listPanes").mockResolvedValue([pane("NORTH"), pane("OTHER"), pane("ORPHAN")]);
  vi.spyOn(tmux, "peekPane").mockImplementation(async () => paneText.value);
  vi.spyOn(tmux, "capturePane").mockImplementation(async () => paneText.value);
  vi.spyOn(tmux, "sendAndSubmit");
  vi.spyOn(tmux, "sendCommand").mockImplementation(async (target, text, pressEnter = true, skipSafetyCheck = false) => {
    if (!skipSafetyCheck) {
      const check = safety.checkCommand(text);
      if (check.blocked) {
        return {
          message: `Command blocked by safety pattern: ${check.pattern?.pattern}`,
          safetyCheck: check,
          blocked: true
        };
      }
    }
    paneText.value = `${paneText.value}\n${text}`;
    return {
      message: `Sent command to ${target}${pressEnter ? " and pressed Enter" : ""}: ${text}`,
      blocked: false
    };
  });
  vi.spyOn(tmux, "sendNamedKeys").mockResolvedValue({
    message: "Sent 1 key(s) to NORTH",
    blocked: false
  });
  pool.replaceSet(ownerId, ["NORTH", "OTHER"]);
  const client = clients.register({
    client_name: "writer",
    redirect_uris: ["https://client.example/callback"]
  });
  const grant = grants.create({
    clientId: client.id,
    grantedBy: ownerId,
    scopeType: "sessions",
    scopeRef: JSON.stringify(["NORTH"]),
    permissions: ["list_sessions", "read_session", "send_message", "send_keys"]
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
  context = { app, db, address, tmux, accessToken: pair.accessToken, paneText };
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

describe("MCP write tools (B17)", () => {
  it("AC-15: rm -rf / is blocked, pane unchanged, blocked:true audited, skipSafetyCheck is false", async () => {
    const ctx = await boot();
    const before = ctx.paneText.value;
    const res = await rpc(ctx, callTool(1, "send_message", { session: "NORTH", text: "rm -rf /" }));
    expect(res.status).toBe(200);
    expect(res.json.result.isError).toBe(true);
    expect(res.json.result.structuredContent).toEqual({ blocked: true, pattern: "rm -rf" });
    expect(String(res.json.result.content[0].text)).toContain("rm -rf");
    expect(ctx.paneText.value).toBe(before);
    expect(ctx.tmux.sendCommand).toHaveBeenCalledWith("NORTH", "rm -rf /", true, false);
    expect(ctx.tmux.sendAndSubmit).not.toHaveBeenCalled();
    const row = ctx.db
      .prepare(
        "SELECT details FROM audit_log WHERE action_type = 'mcp_send_message' ORDER BY id DESC LIMIT 1"
      )
      .get() as { details: string };
    expect(JSON.parse(row.details).blocked).toBe(true);
    expect(JSON.parse(row.details).pattern).toBe("rm -rf");
  });

  it("AC-16: send_message uses sendCommand settle path and read_session sees the text", async () => {
    const ctx = await boot();
    const sent = await rpc(
      ctx,
      callTool(1, "send_message", { session: "NORTH", text: "hello from mcp" })
    );
    expect(sent.status).toBe(200);
    expect(sent.json.result.isError).not.toBe(true);
    expect(sent.json.result.structuredContent.submitted).toBe(true);
    expect(ctx.tmux.sendCommand).toHaveBeenCalledWith("NORTH", "hello from mcp", true, false);
    expect(ctx.tmux.sendAndSubmit).not.toHaveBeenCalled();
    const read = await rpc(ctx, callTool(2, "read_session", { session: "NORTH" }));
    expect(read.json.result.structuredContent.output).toContain("hello from mcp");
  });

  it("AC-17: a non-allowlisted key rejects the whole call with zero sends", async () => {
    const ctx = await boot();
    const res = await rpc(
      ctx,
      callTool(1, "send_keys", { session: "NORTH", keys: ["Down", "C-d"] })
    );
    expect(res.status).toBe(200);
    expect(res.json.result.isError).toBe(true);
    expect(ctx.tmux.sendNamedKeys).not.toHaveBeenCalled();
    expect(ctx.tmux.sendAndSubmit).not.toHaveBeenCalled();
    expect(ctx.tmux.sendCommand).not.toHaveBeenCalled();
  });

  it("Blocker 4 / AC-9 write: send_message and send_keys denials are byte-identical and skip tmux", async () => {
    const ctx = await boot();
    (ctx.tmux.sendCommand as unknown as ReturnType<typeof vi.fn>).mockClear();
    (ctx.tmux.sendNamedKeys as unknown as ReturnType<typeof vi.fn>).mockClear();
    const bodies: string[] = [];
    const targets = ["OTHER", "ORPHAN", "no-such-sess"];
    let id = 1;
    for (const tool of ["send_message", "send_keys"] as const) {
      for (const session of targets) {
        const args =
          tool === "send_message"
            ? { session, text: "hello" }
            : { session, keys: ["Enter"] };
        const res = await rpc(ctx, callTool(id++, tool, args));
        expect(res.status).toBe(200);
        expect(res.json.result).toMatchObject(NOT_FOUND);
        bodies.push(JSON.stringify(res.json.result));
      }
    }
    expect(new Set(bodies).size).toBe(1);
    expect(ctx.tmux.sendCommand).not.toHaveBeenCalled();
    expect(ctx.tmux.sendNamedKeys).not.toHaveBeenCalled();
    expect(ctx.tmux.sendAndSubmit).not.toHaveBeenCalled();
    const denials = ctx.db
      .prepare("SELECT details FROM audit_log WHERE action_type = 'mcp_tool_denied' ORDER BY id")
      .all() as { details: string }[];
    const reasons = denials.map((row) => JSON.parse(row.details));
    expect(reasons.filter((d) => d.reason === "scope" && d.tool === "send_message")).toHaveLength(3);
    expect(reasons.filter((d) => d.reason === "scope" && d.tool === "send_keys")).toHaveLength(3);
  });
});
