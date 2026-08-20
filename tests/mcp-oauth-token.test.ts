import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import formbody from "@fastify/formbody";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AuthService } from "../src/auth/auth-service.js";
import { registerMcpOauthRoutes } from "../src/api/routes/mcp-oauth-routes.js";
import { DatabaseService } from "../src/db/database.js";
import { McpClientService } from "../src/mcp/mcp-client-service.js";
import { createPkceS256Challenge, McpCodeService } from "../src/mcp/mcp-code-service.js";
import { McpGrantService } from "../src/mcp/mcp-grant-service.js";
import { McpPoolService } from "../src/mcp/mcp-pool-service.js";
import { hashMcpSecret, McpTokenService } from "../src/mcp/mcp-token-service.js";
import { TerminalGroupsService } from "../src/services/terminal-groups-service.js";

const execFileAsync = promisify(execFile);
const LOCAL_HOST = "localhost:3101";
const LOCAL_AUDIENCE = "http://localhost:3101/mcp";
const REDIRECT_URI = "https://app.example.com/oauth/callback";
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";

interface TestContext {
  app: FastifyInstance;
  db: DatabaseService;
  ownerId: number;
  clients: McpClientService;
  tokens: McpTokenService;
  pool: McpPoolService;
}

let context: TestContext | null = null;
let tempDir = "";

async function boot(): Promise<TestContext> {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agj-mcp-oauth-token-"));
  const db = new DatabaseService(path.join(tempDir, "test.sqlite"));
  db.ensureOwner(111);
  const ownerId = (db.prepare("SELECT id FROM users WHERE telegram_id = 111").get() as {
    id: number;
  }).id;
  const authService = {
    verifyToken: (token: string) =>
      token === "owner-token" ? { id: ownerId, role: "owner", username: "jrom" } : null
  } as unknown as AuthService;
  const clients = new McpClientService(db);
  const tokens = new McpTokenService(db);
  const codes = new McpCodeService(db, tokens);
  const grants = new McpGrantService(db, tokens);
  const pool = new McpPoolService(db);
  const groups = new TerminalGroupsService(db);
  const app = Fastify({ logger: false });
  await app.register(formbody);
  registerMcpOauthRoutes(app, {
    db,
    authService,
    clients,
    tokens,
    codes,
    grants,
    pool,
    groups
  });
  await app.ready();
  context = { app, db, ownerId, clients, tokens, pool };
  return context;
}

async function issueCode(
  ctx: TestContext,
  options: { host?: string; lifetime?: boolean } = {}
): Promise<{ clientId: string; code: string }> {
  const host = options.host ?? LOCAL_HOST;
  ctx.pool.replaceSet(ctx.ownerId, ["NORTH"]);
  const client = ctx.clients.register({
    client_name: "token-test-agent",
    redirect_uris: [REDIRECT_URI]
  });
  const response = await ctx.app.inject({
    method: "POST",
    url: "/api/mcp/consent/decision",
    headers: { host, authorization: "Bearer owner-token" },
    payload: {
      response_type: "code",
      client_id: client.id,
      redirect_uri: REDIRECT_URI,
      code_challenge: createPkceS256Challenge(VERIFIER),
      code_challenge_method: "S256",
      state: "token-test-state",
      decision: "approve",
      scope_type: "sessions",
      scope_ref: JSON.stringify(["NORTH"]),
      permissions: ["list_sessions"],
      lifetime: options.lifetime === true
    }
  });
  expect(response.statusCode).toBe(200);
  return { clientId: client.id, code: response.json().code as string };
}

function form(values: Record<string, string>): string {
  return new URLSearchParams(values).toString();
}

async function tokenRequest(
  ctx: TestContext,
  values: Record<string, string>,
  host = LOCAL_HOST
) {
  return ctx.app.inject({
    method: "POST",
    url: "/oauth/token",
    headers: {
      host,
      "content-type": "application/x-www-form-urlencoded"
    },
    payload: form(values)
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
});

describe("POST /oauth/token B12", () => {
  it("exchanges a PKCE code once and code replay kills the issued family (AC-7)", async () => {
    const ctx = await boot();
    const issued = await issueCode(ctx);

    const wrongVerifier = await tokenRequest(ctx, {
      grant_type: "authorization_code",
      client_id: issued.clientId,
      code: issued.code,
      code_verifier: "x".repeat(43),
      redirect_uri: REDIRECT_URI
    });
    expect(wrongVerifier.statusCode).toBe(400);
    expect(wrongVerifier.json()).toEqual({ error: "invalid_grant" });

    const success = await tokenRequest(ctx, {
      grant_type: "authorization_code",
      client_id: issued.clientId,
      code: issued.code,
      code_verifier: VERIFIER,
      redirect_uri: REDIRECT_URI
    });
    expect(success.statusCode).toBe(200);
    expect(success.headers["cache-control"]).toBe("no-store");
    expect(success.headers.pragma).toBe("no-cache");
    expect(success.json()).toMatchObject({
      token_type: "Bearer",
      expires_in: 7 * 24 * 60 * 60
    });
    expect(Object.keys(success.json()).sort()).toEqual([
      "access_token",
      "expires_in",
      "refresh_token",
      "token_type"
    ]);
    const first = success.json() as { access_token: string; refresh_token: string };
    expect(first.access_token).not.toBe(first.refresh_token);
    expect(ctx.tokens.verifyAccessToken(`Bearer ${first.access_token}`, LOCAL_AUDIENCE)).not.toBeNull();

    const replay = await tokenRequest(ctx, {
      grant_type: "authorization_code",
      client_id: issued.clientId,
      code: issued.code,
      code_verifier: VERIFIER,
      redirect_uri: REDIRECT_URI
    });
    expect(replay.statusCode).toBe(400);
    expect(replay.json()).toEqual({ error: "invalid_grant" });
    expect(ctx.tokens.verifyAccessToken(`Bearer ${first.access_token}`, LOCAL_AUDIENCE)).toBeNull();
    const codeRow = ctx.db
      .prepare("SELECT used_at FROM mcp_authorization_codes WHERE code_hash = ?")
      .get(hashMcpSecret(issued.code)) as { used_at: string | null };
    expect(codeRow.used_at).not.toBeNull();
  });

  it("rotates refresh tokens, revokes prior access, and kills the family on reuse (AC-7)", async () => {
    const ctx = await boot();
    const issued = await issueCode(ctx);
    const firstResponse = await tokenRequest(ctx, {
      grant_type: "authorization_code",
      client_id: issued.clientId,
      code: issued.code,
      code_verifier: VERIFIER,
      redirect_uri: REDIRECT_URI
    });
    const first = firstResponse.json() as { access_token: string; refresh_token: string };

    const rotation = await tokenRequest(ctx, {
      grant_type: "refresh_token",
      client_id: issued.clientId,
      refresh_token: first.refresh_token
    });
    expect(rotation.statusCode).toBe(200);
    const second = rotation.json() as { access_token: string; refresh_token: string };
    expect(second.access_token).not.toBe(first.access_token);
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect(ctx.tokens.verifyAccessToken(`Bearer ${first.access_token}`, LOCAL_AUDIENCE)).toBeNull();
    expect(ctx.tokens.verifyAccessToken(`Bearer ${second.access_token}`, LOCAL_AUDIENCE)).not.toBeNull();

    const reuse = await tokenRequest(ctx, {
      grant_type: "refresh_token",
      client_id: issued.clientId,
      refresh_token: first.refresh_token
    });
    expect(reuse.statusCode).toBe(400);
    expect(reuse.json()).toEqual({ error: "invalid_grant" });
    expect(ctx.tokens.verifyAccessToken(`Bearer ${second.access_token}`, LOCAL_AUDIENCE)).toBeNull();
    expect(
      (ctx.db.prepare("SELECT COUNT(*) AS count FROM mcp_tokens WHERE revoked = 0").get() as {
        count: number;
      }).count
    ).toBe(0);
  });

  it("treats localhost and 127.0.0.1 as distinct token audiences", async () => {
    const ctx = await boot();
    const issued = await issueCode(ctx, { host: LOCAL_HOST });
    const request = {
      grant_type: "authorization_code",
      client_id: issued.clientId,
      code: issued.code,
      code_verifier: VERIFIER,
      redirect_uri: REDIRECT_URI
    };

    const crossOrigin = await tokenRequest(ctx, request, "127.0.0.1:3101");
    expect(crossOrigin.statusCode).toBe(400);
    expect(crossOrigin.json()).toEqual({ error: "invalid_target" });
    const unused = ctx.db
      .prepare("SELECT used_at FROM mcp_authorization_codes WHERE code_hash = ?")
      .get(hashMcpSecret(issued.code)) as { used_at: string | null };
    expect(unused.used_at).toBeNull();

    const correctOrigin = await tokenRequest(ctx, request, LOCAL_HOST);
    expect(correctOrigin.statusCode).toBe(200);
    expect(
      ctx.tokens.verifyAccessToken(
        `Bearer ${correctOrigin.json().access_token as string}`,
        LOCAL_AUDIENCE
      )
    ).not.toBeNull();
  });

  it("omits expires_in for lifetime grants and NULL-expiry tokens", async () => {
    const ctx = await boot();
    const issued = await issueCode(ctx, { lifetime: true });
    const response = await tokenRequest(ctx, {
      grant_type: "authorization_code",
      client_id: issued.clientId,
      code: issued.code,
      code_verifier: VERIFIER,
      redirect_uri: REDIRECT_URI
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).not.toHaveProperty("expires_in");
    const expiries = ctx.db.prepare("SELECT expires_at FROM mcp_tokens").all() as Array<{
      expires_at: string | null;
    }>;
    expect(expiries).toHaveLength(2);
    expect(expiries.every((row) => row.expires_at === null)).toBe(true);
  });

  it("returns RFC 6749 JSON errors for malformed, unsupported, and unknown-client requests", async () => {
    const ctx = await boot();
    const unsupported = await tokenRequest(ctx, {
      grant_type: "password",
      client_id: "anything"
    });
    expect(unsupported.statusCode).toBe(400);
    expect(unsupported.json()).toEqual({ error: "unsupported_grant_type" });

    const missing = await tokenRequest(ctx, { grant_type: "authorization_code" });
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toEqual({ error: "invalid_request" });

    const unknownClient = await tokenRequest(ctx, {
      grant_type: "refresh_token",
      client_id: "unknown-client",
      refresh_token: "x".repeat(43)
    });
    expect(unknownClient.statusCode).toBe(400);
    expect(unknownClient.json()).toEqual({ error: "invalid_client" });

    const jsonBody = await ctx.app.inject({
      method: "POST",
      url: "/oauth/token",
      headers: { host: LOCAL_HOST, "content-type": "application/json" },
      payload: { grant_type: "refresh_token" }
    });
    expect(jsonBody.statusCode).toBe(400);
    expect(jsonBody.json()).toEqual({ error: "invalid_request" });
  });

  it("accepts an actual curl form request against a fresh listening app", async () => {
    const ctx = await boot();
    const issued = await issueCode(ctx);
    const address = await ctx.app.listen({ host: "127.0.0.1", port: 0 });
    const payload = form({
      grant_type: "authorization_code",
      client_id: issued.clientId,
      code: issued.code,
      code_verifier: VERIFIER,
      redirect_uri: REDIRECT_URI
    });
    const { stdout } = await execFileAsync(
      "curl",
      [
        "--silent",
        "--show-error",
        "--max-time",
        "5",
        "--request",
        "POST",
        "--header",
        `Host: ${LOCAL_HOST}`,
        "--header",
        "Content-Type: application/x-www-form-urlencoded",
        "--data",
        payload,
        "--write-out",
        "\n%{http_code}",
        `${address}/oauth/token`
      ],
      { encoding: "utf8" }
    );
    const splitAt = stdout.lastIndexOf("\n");
    const body = JSON.parse(stdout.slice(0, splitAt)) as Record<string, unknown>;
    const status = Number(stdout.slice(splitAt + 1));

    expect(status).toBe(200);
    expect(body.token_type).toBe("Bearer");
    expect(body.access_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.refresh_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
