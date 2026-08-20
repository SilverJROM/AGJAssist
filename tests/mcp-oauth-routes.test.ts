import { afterEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import formbody from "@fastify/formbody";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseService } from "../src/db/database.js";
import { AuthService } from "../src/auth/auth-service.js";
import { registerMcpOauthRoutes } from "../src/api/routes/mcp-oauth-routes.js";
import { McpClientService } from "../src/mcp/mcp-client-service.js";
import { McpCodeService } from "../src/mcp/mcp-code-service.js";
import { McpGrantService } from "../src/mcp/mcp-grant-service.js";
import { McpPoolService } from "../src/mcp/mcp-pool-service.js";
import { McpTokenService } from "../src/mcp/mcp-token-service.js";
import { TerminalGroupsService } from "../src/services/terminal-groups-service.js";

let dir = "";
let app: FastifyInstance | null = null;

async function boot() {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "agj-mcp-oauth-"));
  const db = new DatabaseService(path.join(dir, "test.sqlite"));
  db.ensureOwner(111);
  const ownerId = (db.prepare("SELECT id FROM users WHERE telegram_id = 111").get() as { id: number }).id;
  const authService = {
    verifyToken: (token: string) => {
      if (token === "owner-token") return { id: ownerId, role: "owner", username: "jrom" };
      return null;
    }
  } as unknown as AuthService;
  const clients = new McpClientService(db);
  const tokens = new McpTokenService(db);
  const codes = new McpCodeService(db, tokens);
  const grants = new McpGrantService(db, tokens);
  const pool = new McpPoolService(db);
  const groups = new TerminalGroupsService(db);
  app = Fastify({ logger: false });
  await app.register(formbody);
  registerMcpOauthRoutes(app, { db, authService, clients, tokens, codes, grants, pool, groups });
  await app.ready();
  return { db, ownerId, clients, tokens, grants };
}

afterEach(async () => {
  if (app) await app.close();
  app = null;
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = "";
});

describe("MCP OAuth HTTP surface (B10)", () => {
  it("AC-3 forged Host → 404; allowlisted hosts return S256-only metadata", async () => {
    await boot();
    const forged = await app!.inject({
      method: "GET",
      url: "/.well-known/oauth-authorization-server",
      headers: { host: "evil.example" }
    });
    expect(forged.statusCode).toBe(404);

    const local = await app!.inject({
      method: "GET",
      url: "/.well-known/oauth-authorization-server",
      headers: { host: "localhost:3101" }
    });
    expect(local.statusCode).toBe(200);
    const as = local.json();
    expect(as.issuer).toBe("http://localhost:3101");
    expect(as.code_challenge_methods_supported).toEqual(["S256"]);
    expect(as.code_challenge_methods_supported).not.toContain("plain");

    const pr = await app!.inject({
      method: "GET",
      url: "/.well-known/oauth-protected-resource",
      headers: { host: "127.0.0.1:3101" }
    });
    expect(pr.statusCode).toBe(200);
    expect(pr.json().resource).toBe("http://127.0.0.1:3101/mcp");
    expect(pr.json().authorization_servers).toEqual(["http://127.0.0.1:3101"]);
  });

  it("register 400s a non-loopback http redirect URI", async () => {
    await boot();
    const res = await app!.inject({
      method: "POST",
      url: "/oauth/register",
      headers: { host: "localhost:3101", "content-type": "application/json" },
      payload: { client_name: "grok", redirect_uris: ["http://evil.example/cb"] }
    });
    expect(res.statusCode).toBe(400);
  });

  it("AC-33 RFC 7009: unknown token → 200; known access token is revoked", async () => {
    const { ownerId, clients, tokens, grants } = await boot();
    const client = clients.register({
      client_name: "grok",
      redirect_uris: ["https://app.example.com/cb"]
    });
    const grant = grants.create({
      clientId: client.id,
      grantedBy: ownerId,
      scopeType: "sessions",
      scopeRef: JSON.stringify(["NORTH"]),
      permissions: ["list_sessions"]
    });
    const pair = tokens.mintPair({ grantId: grant.id, audience: "http://localhost:3101/mcp" });
    expect(tokens.verifyAccessToken(`Bearer ${pair.accessToken}`, "http://localhost:3101/mcp")).toBeTruthy();

    const unknown = await app!.inject({
      method: "POST",
      url: "/oauth/revoke",
      headers: { host: "localhost:3101", "content-type": "application/x-www-form-urlencoded" },
      payload: "token=not-a-real-token"
    });
    expect(unknown.statusCode).toBe(200);

    const known = await app!.inject({
      method: "POST",
      url: "/oauth/revoke",
      headers: { host: "localhost:3101", "content-type": "application/x-www-form-urlencoded" },
      payload: `token=${encodeURIComponent(pair.accessToken)}`
    });
    expect(known.statusCode).toBe(200);
    expect(tokens.verifyAccessToken(`Bearer ${pair.accessToken}`, "http://localhost:3101/mcp")).toBeNull();
  });
});
