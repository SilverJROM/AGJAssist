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
      if (token === "viewer-token") return { id: ownerId, role: "viewer", username: "view" };
      if (token.startsWith("inactive-")) {
        const id = Number(token.slice("inactive-".length));
        return { id, role: "owner", username: "gone" };
      }
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
  return { db, ownerId, clients, tokens, grants, pool };
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

const CHALLENGE = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG"; // 43 chars, S256-shaped

function authQuery(clientId: string, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: "https://app.example.com/cb",
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    state: "st",
    ...extra
  });
  return `/oauth/authorize?${params.toString()}`;
}

describe("MCP authorize + consent (B11)", () => {
  it("AC-5: missing/plain PKCE, wrong response_type, overlong state, mismatched redirect → 400 without Location", async () => {
    const { clients } = await boot();
    const client = clients.register({
      client_name: "grok",
      redirect_uris: ["https://app.example.com/cb"]
    });
    const headers = { host: "localhost:3101" };
    const cases = [
      authQuery(client.id).replace("code_challenge_method=S256", "code_challenge_method=plain"),
      authQuery(client.id).replace(/code_challenge=[^&]+&/, ""),
      authQuery(client.id, { response_type: "token" }),
      authQuery(client.id, { state: "x".repeat(513) }),
      authQuery(client.id, { redirect_uri: "https://evil.example/cb" })
    ];
    for (const url of cases) {
      const res = await app!.inject({ method: "GET", url, headers });
      expect(res.statusCode).toBe(400);
      expect(res.headers.location).toBeUndefined();
    }
  });

  it("serves the consent shell with FR-24 headers on a valid authorize", async () => {
    const { clients } = await boot();
    const client = clients.register({
      client_name: "grok",
      redirect_uris: ["https://app.example.com/cb"]
    });
    const res = await app!.inject({
      method: "GET",
      url: authQuery(client.id),
      headers: { host: "localhost:3101" }
    });
    expect(res.statusCode).toBe(200);
    expect(String(res.headers["content-type"])).toMatch(/text\/html/);
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(String(res.headers["content-security-policy"])).toMatch(/frame-ancestors 'none'/);
    expect(res.body).toContain("Grant MCP access");
  });

  it("approve issues a code; deny returns access_denied without a grant/code", async () => {
    const { ownerId, clients, pool, db } = await boot();
    pool.replaceSet(ownerId, ["NORTH"]);
    const client = clients.register({
      client_name: "grok",
      redirect_uris: ["https://app.example.com/cb"]
    });
    const oauth = {
      response_type: "code",
      client_id: client.id,
      redirect_uri: "https://app.example.com/cb",
      code_challenge: CHALLENGE,
      code_challenge_method: "S256",
      state: "st"
    };
    const deny = await app!.inject({
      method: "POST",
      url: "/api/mcp/consent/decision",
      headers: { host: "localhost:3101", authorization: "Bearer owner-token" },
      payload: { ...oauth, decision: "deny" }
    });
    expect(deny.statusCode).toBe(200);
    expect(deny.json().error).toBe("access_denied");
    expect(deny.json().code).toBeUndefined();
    const grants = db.prepare("SELECT COUNT(*) AS n FROM mcp_grants").get() as { n: number };
    expect(grants.n).toBe(0);

    const approve = await app!.inject({
      method: "POST",
      url: "/api/mcp/consent/decision",
      headers: { host: "localhost:3101", authorization: "Bearer owner-token" },
      payload: {
        ...oauth,
        decision: "approve",
        scope_type: "sessions",
        scope_ref: JSON.stringify(["NORTH"]),
        permissions: ["list_sessions"]
      }
    });
    expect(approve.statusCode).toBe(200);
    expect(approve.json().code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(approve.json().iss).toBe("http://localhost:3101");
  });

  it("viewer and inactive owner get 403; empty pool cannot approve", async () => {
    const { db, clients } = await boot();
    const client = clients.register({
      client_name: "grok",
      redirect_uris: ["https://app.example.com/cb"]
    });
    const oauth = {
      response_type: "code",
      client_id: client.id,
      redirect_uri: "https://app.example.com/cb",
      code_challenge: CHALLENGE,
      code_challenge_method: "S256",
      decision: "approve",
      scope_type: "sessions",
      scope_ref: JSON.stringify(["NORTH"]),
      permissions: ["list_sessions"]
    };
    const viewer = await app!.inject({
      method: "POST",
      url: "/api/mcp/consent/decision",
      headers: { host: "localhost:3101", authorization: "Bearer viewer-token" },
      payload: oauth
    });
    expect(viewer.statusCode).toBe(403);

    db.prepare("INSERT INTO users (telegram_id, role, active) VALUES (222, 'owner', 0)").run();
    const inactiveId = (db.prepare("SELECT id FROM users WHERE telegram_id = 222").get() as { id: number }).id;
    const inactive = await app!.inject({
      method: "POST",
      url: "/api/mcp/consent/decision",
      headers: { host: "localhost:3101", authorization: `Bearer inactive-${inactiveId}` },
      payload: oauth
    });
    expect(inactive.statusCode).toBe(403);

    const empty = await app!.inject({
      method: "POST",
      url: "/api/mcp/consent/decision",
      headers: { host: "localhost:3101", authorization: "Bearer owner-token" },
      payload: oauth
    });
    expect(empty.statusCode).toBe(403);
  });

  it("AC-31: a second approve supersedes the prior active grant", async () => {
    const { ownerId, clients, pool, db } = await boot();
    pool.replaceSet(ownerId, ["NORTH", "OTHER"]);
    const client = clients.register({
      client_name: "grok",
      redirect_uris: ["https://app.example.com/cb"]
    });
    const oauth = {
      response_type: "code",
      client_id: client.id,
      redirect_uri: "https://app.example.com/cb",
      code_challenge: CHALLENGE,
      code_challenge_method: "S256",
      decision: "approve",
      scope_type: "sessions",
      permissions: ["list_sessions"]
    };
    const first = await app!.inject({
      method: "POST",
      url: "/api/mcp/consent/decision",
      headers: { host: "localhost:3101", authorization: "Bearer owner-token" },
      payload: { ...oauth, scope_ref: JSON.stringify(["NORTH"]) }
    });
    expect(first.statusCode).toBe(200);
    const id1 = (db.prepare("SELECT id FROM mcp_grants WHERE status = 'active'").get() as { id: number }).id;
    const second = await app!.inject({
      method: "POST",
      url: "/api/mcp/consent/decision",
      headers: { host: "localhost:3101", authorization: "Bearer owner-token" },
      payload: { ...oauth, scope_ref: JSON.stringify(["OTHER"]) }
    });
    expect(second.statusCode).toBe(200);
    const active = db
      .prepare("SELECT id, scope_ref FROM mcp_grants WHERE client_id = ? AND status = 'active'")
      .all(client.id) as { id: number; scope_ref: string }[];
    expect(active).toHaveLength(1);
    expect(active[0].id).not.toBe(id1);
    expect(JSON.parse(active[0].scope_ref)).toEqual(["OTHER"]);
  });
});
