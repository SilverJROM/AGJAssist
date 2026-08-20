import { afterEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import formbody from "@fastify/formbody";
import rateLimit from "@fastify/rate-limit";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AuthService } from "../src/auth/auth-service.js";
import { registerMcpOauthRoutes } from "../src/api/routes/mcp-oauth-routes.js";
import { DatabaseService } from "../src/db/database.js";
import { McpClientService } from "../src/mcp/mcp-client-service.js";
import { McpCodeService } from "../src/mcp/mcp-code-service.js";
import { McpGrantService } from "../src/mcp/mcp-grant-service.js";
import { McpPoolService } from "../src/mcp/mcp-pool-service.js";
import { McpTokenService } from "../src/mcp/mcp-token-service.js";
import { TerminalGroupsService } from "../src/services/terminal-groups-service.js";

let dir = "";
let app: FastifyInstance | null = null;

async function boot() {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "agj-mcp-oauth-rl-"));
  const db = new DatabaseService(path.join(dir, "test.sqlite"));
  db.ensureOwner(111);
  const authService = {
    verifyToken: () => null
  } as unknown as AuthService;
  const clients = new McpClientService(db);
  const tokens = new McpTokenService(db);
  const codes = new McpCodeService(db, tokens);
  const grants = new McpGrantService(db, tokens);
  const pool = new McpPoolService(db);
  const groups = new TerminalGroupsService(db);
  app = Fastify({ logger: false });
  await app.register(formbody);
  await app.register(rateLimit, { global: false });
  registerMcpOauthRoutes(app, { db, authService, clients, tokens, codes, grants, pool, groups });
  await app.ready();
}

afterEach(async () => {
  if (app) await app.close();
  app = null;
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = "";
});

describe("OAuth HTTP rate limit (B14 AC-20)", () => {
  it("AC-20: flooding POST /oauth/register returns HTTP 429", async () => {
    await boot();
    const headers = {
      host: "localhost:3101",
      "content-type": "application/json"
    };
    const payload = {
      client_name: "flood",
      redirect_uris: ["https://app.example.com/cb"]
    };
    let last = 0;
    for (let i = 0; i < 10; i++) {
      const res = await app!.inject({
        method: "POST",
        url: "/oauth/register",
        headers,
        payload,
        remoteAddress: "203.0.113.9"
      });
      last = res.statusCode;
      expect(res.statusCode).toBe(201);
    }
    expect(last).toBe(201);
    const blocked = await app!.inject({
      method: "POST",
      url: "/oauth/register",
      headers,
      payload,
      remoteAddress: "203.0.113.9"
    });
    expect(blocked.statusCode).toBe(429);
  });
});
