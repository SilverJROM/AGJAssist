import { afterEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import formbody from "@fastify/formbody";
import fs from "node:fs";
import os from "node:os";
import path from "path";
import * as otplib from "otplib";
import { AuthService } from "../src/auth/auth-service.js";
import { registerAuthRoutes } from "../src/api/routes/auth-routes.js";
import { registerMcpOauthRoutes } from "../src/api/routes/mcp-oauth-routes.js";
import { DatabaseService } from "../src/db/database.js";
import { McpClientService } from "../src/mcp/mcp-client-service.js";
import { createPkceS256Challenge, McpCodeService } from "../src/mcp/mcp-code-service.js";
import { McpGrantService } from "../src/mcp/mcp-grant-service.js";
import { McpPoolService } from "../src/mcp/mcp-pool-service.js";
import { McpTokenService } from "../src/mcp/mcp-token-service.js";
import { TerminalGroupsService } from "../src/services/terminal-groups-service.js";

const HOST = "localhost:3101";
const AUDIENCE = "http://localhost:3101/mcp";
const REDIRECT = "https://app.example.com/cb";
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";

let dir = "";
let app: FastifyInstance | null = null;
let db: DatabaseService | null = null;

async function boot() {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "agj-mcp-oauth-e2e-"));
  db = new DatabaseService(path.join(dir, "test.sqlite"));
  db.ensureOwner(111);
  const ownerId = (db.prepare("SELECT id FROM users WHERE telegram_id = 111").get() as { id: number }).id;
  const authService = new AuthService(db, "123456:test-bot-token", "test-jwt-secret", 24);
  const setup = await authService.setup2FA(ownerId);
  if (!setup) throw new Error("setup2FA failed");
  const totp = otplib.generateSync({ secret: setup.secret });
  if (!authService.confirm2FA(ownerId, totp)) throw new Error("confirm2FA failed");
  const clients = new McpClientService(db);
  const tokens = new McpTokenService(db);
  const codes = new McpCodeService(db, tokens);
  const grants = new McpGrantService(db, tokens);
  const pool = new McpPoolService(db);
  const groups = new TerminalGroupsService(db);
  app = Fastify({ logger: false });
  await app.register(formbody);
  registerAuthRoutes(app, authService);
  registerMcpOauthRoutes(app, { db, authService, clients, tokens, codes, grants, pool, groups });
  await app.ready();
  return { ownerId, authService, clients, tokens, grants, pool, totpSecret: setup.secret };
}

afterEach(async () => {
  if (app) await app.close();
  app = null;
  if (db) db.close();
  db = null;
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = "";
});

describe("MCP OAuth e2e (B13 AC-6 / AC-32)", () => {
  it("AC-32: GET /oauth/authorize carries CSP frame-ancestors none and X-Frame-Options DENY", async () => {
    const { clients } = await boot();
    const client = clients.register({
      client_name: "grok",
      redirect_uris: [REDIRECT]
    });
    const params = new URLSearchParams({
      response_type: "code",
      client_id: client.id,
      redirect_uri: REDIRECT,
      code_challenge: createPkceS256Challenge(VERIFIER),
      code_challenge_method: "S256",
      state: "st"
    });
    const res = await app!.inject({
      method: "GET",
      url: `/oauth/authorize?${params.toString()}`,
      headers: { host: HOST }
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(String(res.headers["content-security-policy"])).toMatch(/frame-ancestors 'none'/);
    expect(String(res.headers["content-security-policy"])).toMatch(/script-src 'self'/);
    expect(res.body).toContain("Grant MCP access");
    expect(res.body).toContain('src="/mcp-consent.js"');
    expect(res.body).not.toMatch(/<script(?![^>]*\bsrc=)/);
  });

  it("AC-6: login + TOTP → approve → code → token; deny issues no grant", async () => {
    const { authService, clients, pool, ownerId, tokens, totpSecret } = await boot();
    pool.replaceSet(ownerId, ["NORTH"]);
    const client = clients.register({
      client_name: "grok",
      redirect_uris: [REDIRECT]
    });
    const challenge = createPkceS256Challenge(VERIFIER);
    const oauth = {
      response_type: "code",
      client_id: client.id,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "st"
    };

    const loginCode = authService.generateLoginCode(111);
    const check = await app!.inject({
      method: "POST",
      url: "/api/auth/2fa/check",
      payload: { code: loginCode }
    });
    expect(check.statusCode).toBe(200);
    expect(check.json().requires2FA).toBe(true);

    const totp = otplib.generateSync({ secret: totpSecret });
    const login = await app!.inject({
      method: "POST",
      url: "/api/auth/code",
      payload: { code: loginCode, totp }
    });
    expect(login.statusCode).toBe(200);
    const ownerJwt = login.json().token as string;
    expect(ownerJwt).toBeTruthy();

    const deny = await app!.inject({
      method: "POST",
      url: "/api/mcp/consent/decision",
      headers: { host: HOST, authorization: `Bearer ${ownerJwt}` },
      payload: { ...oauth, decision: "deny" }
    });
    expect(deny.statusCode).toBe(200);
    expect(deny.json().error).toBe("access_denied");
    expect(deny.json().code).toBeUndefined();
    const grantsAfterDeny = db!.prepare("SELECT COUNT(*) AS n FROM mcp_grants").get() as { n: number };
    expect(grantsAfterDeny.n).toBe(0);

    const approve = await app!.inject({
      method: "POST",
      url: "/api/mcp/consent/decision",
      headers: { host: HOST, authorization: `Bearer ${ownerJwt}` },
      payload: {
        ...oauth,
        decision: "approve",
        scope_type: "sessions",
        scope_ref: JSON.stringify(["NORTH"]),
        permissions: [
          "list_sessions",
          "read_session",
          "send_message",
          "send_keys",
          "upload_image",
          "read_image"
        ]
      }
    });
    expect(approve.statusCode).toBe(200);
    const code = approve.json().code as string;
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(approve.json().iss).toBe("http://localhost:3101");

    const token = await app!.inject({
      method: "POST",
      url: "/oauth/token",
      headers: { host: HOST, "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: client.id,
        code,
        code_verifier: VERIFIER,
        redirect_uri: REDIRECT
      }).toString()
    });
    expect(token.statusCode).toBe(200);
    const access = token.json().access_token as string;
    expect(tokens.verifyAccessToken(`Bearer ${access}`, AUDIENCE)).toBeTruthy();
  });
});
