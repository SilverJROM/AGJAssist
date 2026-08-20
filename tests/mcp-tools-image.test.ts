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
import { FileService } from "../src/services/file-service.js";
import { ProjectService } from "../src/services/project-service.js";
import { TerminalGroupsService } from "../src/services/terminal-groups-service.js";
import { TmuxService, type TmuxPane } from "../src/tmux/tmux-service.js";

const HOST = "localhost:3101";
const ORIGIN = "http://localhost:3101";
const AUDIENCE = `${ORIGIN}/mcp`;
const PROTOCOL_VERSION = "2025-06-18";
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

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
  accessToken: string;
  projectRoot: string;
  files: FileService;
}

let context: TestContext | null = null;
let tempDir = "";

async function boot(): Promise<TestContext> {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agj-mcp-tools-image-"));
  const projectsRoot = path.join(tempDir, "projects");
  const projectRoot = path.join(projectsRoot, "north-app");
  fs.mkdirSync(projectRoot, { recursive: true });
  const db = new DatabaseService(path.join(tempDir, "test.sqlite"));
  db.ensureOwner(111);
  const ownerId = (db.prepare("SELECT id FROM users WHERE telegram_id = 111").get() as {
    id: number;
  }).id;
  db.prepare("INSERT INTO projects (directory_name, display_name, status, active) VALUES (?, ?, 'active', 1)").run(
    "north-app",
    "North"
  );
  const projectId = (db.prepare("SELECT id FROM projects WHERE directory_name = 'north-app'").get() as {
    id: number;
  }).id;
  db.prepare(
    "INSERT INTO tmux_sessions (project_id, session_name, created_by, status) VALUES (?, 'NORTH', ?, 'active')"
  ).run(projectId, ownerId);
  db.prepare(
    "INSERT INTO tmux_sessions (project_id, session_name, created_by, status) VALUES (NULL, 'UNMAPPED', ?, 'active')"
  ).run(ownerId);

  const audit = new AuditService(db);
  const clients = new McpClientService(db);
  const tokens = new McpTokenService(db, audit);
  const grants = new McpGrantService(db, tokens, audit);
  const pool = new McpPoolService(db, audit);
  const groups = new TerminalGroupsService(db);
  const scope = new McpScopeService(db, groups, pool);
  const tmux = new TmuxService();
  const files = new FileService();
  const projects = new ProjectService(db, projectsRoot);
  vi.spyOn(tmux, "listPanes").mockResolvedValue([pane("NORTH"), pane("UNMAPPED"), pane("ORPHAN")]);
  pool.replaceSet(ownerId, ["NORTH", "UNMAPPED"]);
  const client = clients.register({
    client_name: "imager",
    redirect_uris: ["https://client.example/callback"]
  });
  const grant = grants.create({
    clientId: client.id,
    grantedBy: ownerId,
    scopeType: "sessions",
    scopeRef: JSON.stringify(["NORTH", "UNMAPPED"]),
    permissions: ["upload_image", "read_image"]
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
    files,
    projects
  });
  const address = new URL(await app.listen({ host: "127.0.0.1", port: 0 }));
  context = { app, db, address, accessToken: pair.accessToken, projectRoot, files };
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

const IMAGE_NOT_FOUND = {
  isError: true,
  content: [{ type: "text", text: MCP_ERROR.imageNotFound.text }],
  structuredContent: { code: MCP_ERROR.imageNotFound.code }
};

describe("MCP image tools (B18 AC-18)", () => {
  it("rejects an 11MB upload, path-traversal filename, and no-project session", async () => {
    const ctx = await boot();
    const huge = await rpc(
      ctx,
      callTool(1, "upload_image", {
        session: "NORTH",
        filename: "big.png",
        data_base64: Buffer.alloc(11 * 1024 * 1024, 1).toString("base64")
      })
    );
    expect(huge.status).toBe(200);
    expect(huge.json.result).toMatchObject(IMAGE_NOT_FOUND);

    const traversal = await rpc(
      ctx,
      callTool(2, "upload_image", {
        session: "NORTH",
        filename: "../../etc/x.png",
        data_base64: TINY_PNG.toString("base64")
      })
    );
    expect(traversal.json.result).toMatchObject(IMAGE_NOT_FOUND);
    expect(JSON.stringify(traversal.json.result)).toBe(JSON.stringify(huge.json.result));

    const unmapped = await rpc(
      ctx,
      callTool(3, "upload_image", {
        session: "UNMAPPED",
        filename: "shot.png",
        data_base64: TINY_PNG.toString("base64")
      })
    );
    expect(unmapped.json.result).toMatchObject(IMAGE_NOT_FOUND);
    expect(fs.existsSync(path.join(ctx.projectRoot, "tmp"))).toBe(false);
  });

  it("writes a valid PNG under the mapped project root and reads it back", async () => {
    const ctx = await boot();
    const uploaded = await rpc(
      ctx,
      callTool(1, "upload_image", {
        session: "NORTH",
        filename: "photo.png",
        data_base64: TINY_PNG.toString("base64")
      })
    );
    expect(uploaded.status).toBe(200);
    expect(uploaded.json.result.isError).not.toBe(true);
    const rel = uploaded.json.result.structuredContent.path as string;
    expect(rel).toMatch(/^tmp\/term-.+-photo\.png$/);
    const abs = path.join(ctx.projectRoot, rel);
    expect(abs.startsWith(ctx.projectRoot + path.sep)).toBe(true);
    expect(fs.readFileSync(abs)).toEqual(TINY_PNG);

    const read = await rpc(ctx, callTool(2, "read_image", { session: "NORTH", path: rel }));
    expect(read.json.result.isError).not.toBe(true);
    expect(read.json.result.structuredContent).toEqual({
      data_base64: TINY_PNG.toString("base64"),
      mime: "image/png",
      size: TINY_PNG.length
    });
  });

  it("maps traversal, symlink escape, and missing files to mcp_image_not_found", async () => {
    const ctx = await boot();
    const passwd = await rpc(
      ctx,
      callTool(1, "read_image", { session: "NORTH", path: "../../../etc/passwd" })
    );
    expect(passwd.json.result).toMatchObject(IMAGE_NOT_FOUND);

    fs.mkdirSync(path.join(ctx.projectRoot, "tmp"), { recursive: true });
    const outside = path.join(tempDir, "secret.png");
    fs.writeFileSync(outside, TINY_PNG);
    fs.symlinkSync(outside, path.join(ctx.projectRoot, "tmp", "escape.png"));
    const escaped = await rpc(
      ctx,
      callTool(2, "read_image", { session: "NORTH", path: "tmp/escape.png" })
    );
    expect(escaped.json.result).toMatchObject(IMAGE_NOT_FOUND);
    expect(JSON.stringify(escaped.json.result)).toBe(JSON.stringify(passwd.json.result));
  });
});
