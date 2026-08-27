import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { DatabaseService } from "../src/db/database.js";
import { registerSummaryRoutes } from "../src/api/routes/summary-routes.js";
import { AuthService } from "../src/auth/auth-service.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agjassist-summary-routes-"));
  return path.join(dir, "test.sqlite");
}

describe("summary-routes D4", () => {
  let app: any;
  let db: DatabaseService;
  let dbPath: string;
  let ownerToken = "owner-token";
  let viewerToken = "viewer-token";
  let ownerUserId: number;

  beforeEach(async () => {
    dbPath = tempDb();
    db = new DatabaseService(dbPath);
    db.prepare("INSERT INTO users (telegram_id, role) VALUES (111, 'owner')").run();
    db.prepare("INSERT INTO users (telegram_id, role) VALUES (222, 'viewer')").run();
    ownerUserId = db.prepare("SELECT id FROM users WHERE telegram_id = 111").get() as { id: number };
    ownerUserId = ownerUserId.id;

    const authService = {
      verifyToken: (t: string) => {
        if (t === ownerToken) return { id: ownerUserId, role: "owner", username: "owner" };
        if (t === viewerToken) return { id: 2, role: "viewer", username: "viewer" };
        return null;
      }
    } as unknown as AuthService;

    app = Fastify({ logger: false });
    registerSummaryRoutes(app, authService, db);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
    try {
      fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
    } catch {}
  });

  it("GET /api/summary-endpoints lists endpoints for owner", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/summary-endpoints",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.endpoints).toBeDefined();
    expect(body.endpoints.length).toBeGreaterThanOrEqual(1);
    const seeded = body.endpoints.find((e: any) => e.name === "140");
    expect(seeded).toBeDefined();
  });

  it("GET /api/summary-endpoints rejects viewer", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/summary-endpoints",
      headers: { authorization: `Bearer ${viewerToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST creates endpoint with valid OpenAI-compatible base URL", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/summary-endpoints",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        name: "test-ep",
        base_url: "http://localhost:8080/v1",
        model: "test-model",
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.endpoint.name).toBe("test-ep");
    expect(body.endpoint.base_url).toBe("http://localhost:8080/v1");
    expect(body.endpoint.model).toBe("test-model");
  });

  it("POST rejects invalid base URL", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/summary-endpoints",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        name: "bad-ep",
        base_url: "http://localhost:8080", // missing /v1
        model: "m",
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH updates endpoint with valid base URL", async () => {
    // create first
    const createRes = await app.inject({
      method: "POST",
      url: "/api/summary-endpoints",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: "upd-ep", base_url: "http://a/v1", model: "m1" },
    });
    const created = JSON.parse(createRes.body).endpoint;
    const patchRes = await app.inject({
      method: "PATCH",
      url: `/api/summary-endpoints/${created.id}`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { base_url: "https://b.example/v1", model: "m2" },
    });
    expect(patchRes.statusCode).toBe(200);
    const body = JSON.parse(patchRes.body);
    expect(body.endpoint.base_url).toBe("https://b.example/v1");
    expect(body.endpoint.model).toBe("m2");
  });

  it("PATCH rejects invalid base URL", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/summary-endpoints",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: "upd-bad", base_url: "http://a/v1", model: "m1" },
    });
    const created = JSON.parse(createRes.body).endpoint;
    const patchRes = await app.inject({
      method: "PATCH",
      url: `/api/summary-endpoints/${created.id}`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { base_url: "not-a-url" },
    });
    expect(patchRes.statusCode).toBe(400);
  });

  it("POST rejects base URL with embedded credentials", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/summary-endpoints",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        name: "cred-ep",
        base_url: "https://token:supersecret@example.com/v1",
        model: "m",
      },
    });
    expect(res.statusCode).toBe(400);
    const body = res.body;
    expect(body).not.toContain("supersecret");
  });

  it("POST rejects base URL with query string", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/summary-endpoints",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        name: "query-ep",
        base_url: "https://example.com/v1?api_key=leakme",
        model: "m",
      },
    });
    expect(res.statusCode).toBe(400);
    const body = res.body;
    expect(body).not.toContain("leakme");
  });

  it("PATCH rejects base URL with embedded credentials", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/summary-endpoints",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: "patch-cred", base_url: "http://a/v1", model: "m1" },
    });
    const created = JSON.parse(createRes.body).endpoint;
    const patchRes = await app.inject({
      method: "PATCH",
      url: `/api/summary-endpoints/${created.id}`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { base_url: "https://token:supersecret@example.com/v1" },
    });
    expect(patchRes.statusCode).toBe(400);
    expect(patchRes.body).not.toContain("supersecret");
  });

  it("PATCH rejects base URL with query string", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/summary-endpoints",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: "patch-query", base_url: "http://a/v1", model: "m1" },
    });
    const created = JSON.parse(createRes.body).endpoint;
    const patchRes = await app.inject({
      method: "PATCH",
      url: `/api/summary-endpoints/${created.id}`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { base_url: "https://example.com/v1?api_key=leakme" },
    });
    expect(patchRes.statusCode).toBe(400);
    expect(patchRes.body).not.toContain("leakme");
  });

  it("POST /api/summary-endpoints/:id/default sets default", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/summary-endpoints",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: "def-ep", base_url: "http://c/v1", model: "m" },
    });
    const created = JSON.parse(createRes.body).endpoint;
    const defRes = await app.inject({
      method: "POST",
      url: `/api/summary-endpoints/${created.id}/default`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(defRes.statusCode).toBe(200);
    const body = JSON.parse(defRes.body);
    expect(body.endpoint.is_default).toBe(1);
  });

  it("DELETE removes non-default endpoint", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/summary-endpoints",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: "del-ep", base_url: "http://d/v1", model: "m" },
    });
    const created = JSON.parse(createRes.body).endpoint;
    const delRes = await app.inject({
      method: "DELETE",
      url: `/api/summary-endpoints/${created.id}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(delRes.statusCode).toBe(204);
  });

  it("DELETE rejects removal of default endpoint", async () => {
    const listRes = await app.inject({
      method: "GET",
      url: "/api/summary-endpoints",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const endpoints = JSON.parse(listRes.body).endpoints;
    const def = endpoints.find((e: any) => e.is_default === 1);
    const delRes = await app.inject({
      method: "DELETE",
      url: `/api/summary-endpoints/${def.id}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(delRes.statusCode).toBe(400);
  });

  it("GET /api/summary-agents/:agentName/summaries returns newest first", async () => {
    // Insert two summaries with different timestamps
    const svc = db.prepare("INSERT INTO agent_summaries (agent_name, endpoint_id, summary_text, provenance) VALUES (?, ?, ?, ?)");
    // Use first endpoint id
    const epId = db.prepare("SELECT id FROM summary_llm_endpoints LIMIT 1").get() as { id: number };
    svc.run("agent-x", epId.id, "first", "system");
    // slight delay to ensure different created_at
    await new Promise(r => setTimeout(r, 10));
    svc.run("agent-x", epId.id, "second", "system");

    const res = await app.inject({
      method: "GET",
      url: "/api/summary-agents/agent-x/summaries",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.summaries).toHaveLength(2);
    expect(body.summaries[0].summary_text).toBe("second");
    expect(body.summaries[1].summary_text).toBe("first");
  });
});
