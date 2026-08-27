import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { DatabaseService } from "../src/db/database.js";
import { registerAgentWakeupRoutes } from "../src/api/routes/agent-wakeup-routes.js";
import { AuthService } from "../src/auth/auth-service.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agjassist-agent-wakeup-routes-"));
  return path.join(dir, "test.sqlite");
}

describe("agent-wakeup-routes E3", () => {
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
    registerAgentWakeupRoutes(app, authService, db);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
    try {
      fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
    } catch {}
  });

  it("GET /api/agent-wakeups/pending returns pending for owner", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/agent-wakeups/pending",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.wakeups)).toBe(true);
  });

  it("GET /api/agent-wakeups/pending fails for non-owner", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/agent-wakeups/pending",
      headers: { authorization: `Bearer ${viewerToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST creates wakeup with owner, fails for non-owner", async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const resOwner = await app.inject({
      method: "POST",
      url: "/api/agent-wakeups",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        pane_target: "proj:session:pane",
        manual_fire_time: future,
        action: "echo hi",
      },
    });
    expect(resOwner.statusCode).toBe(201);
    const body = JSON.parse(resOwner.body);
    expect(body.wakeup.pane_target).toBe("proj:session:pane");
    expect(body.wakeup.action).toBe("echo hi");
    expect(body.wakeup.status).toBe("pending");

    const resViewer = await app.inject({
      method: "POST",
      url: "/api/agent-wakeups",
      headers: { authorization: `Bearer ${viewerToken}` },
      payload: {
        pane_target: "proj:session:pane",
        manual_fire_time: future,
        action: "echo hi",
      },
    });
    expect(resViewer.statusCode).toBe(403);
  });

  it("POST fails closed on past time and empty action", async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const resPast = await app.inject({
      method: "POST",
      url: "/api/agent-wakeups",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        pane_target: "proj:session:pane",
        manual_fire_time: past,
        action: "echo hi",
      },
    });
    expect(resPast.statusCode).toBe(400);

    const future = new Date(Date.now() + 60_000).toISOString();
    const resEmptyAction = await app.inject({
      method: "POST",
      url: "/api/agent-wakeups",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        pane_target: "proj:session:pane",
        manual_fire_time: future,
        action: "   ",
      },
    });
    expect(resEmptyAction.statusCode).toBe(400);
  });

  it("POST fails closed on cross-pane access (invalid pane_target)", async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const res = await app.inject({
      method: "POST",
      url: "/api/agent-wakeups",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        pane_target: "proj/session/pane", // slash not allowed
        manual_fire_time: future,
        action: "echo hi",
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("DELETE cancels wakeup for owner, fails for non-owner", async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const createRes = await app.inject({
      method: "POST",
      url: "/api/agent-wakeups",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        pane_target: "proj:session:pane",
        manual_fire_time: future,
        action: "echo hi",
      },
    });
    const { wakeup } = JSON.parse(createRes.body);
    const id = wakeup.id;

    const resOwner = await app.inject({
      method: "DELETE",
      url: `/api/agent-wakeups/${id}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(resOwner.statusCode).toBe(204);

    // recreate for viewer test
    const createRes2 = await app.inject({
      method: "POST",
      url: "/api/agent-wakeups",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        pane_target: "proj:session:pane2",
        manual_fire_time: future,
        action: "echo hi",
      },
    });
    const { wakeup: wakeup2 } = JSON.parse(createRes2.body);
    const resViewer = await app.inject({
      method: "DELETE",
      url: `/api/agent-wakeups/${wakeup2.id}`,
      headers: { authorization: `Bearer ${viewerToken}` },
    });
    expect(resViewer.statusCode).toBe(403);
  });

  it("GET pending returns created wakeup", async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    await app.inject({
      method: "POST",
      url: "/api/agent-wakeups",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        pane_target: "proj:session:pane",
        manual_fire_time: future,
        action: "echo hi",
      },
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/agent-wakeups/pending",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.wakeups).toHaveLength(1);
    expect(body.wakeups[0].pane_target).toBe("proj:session:pane");
  });
});
