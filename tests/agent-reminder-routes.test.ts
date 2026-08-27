import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { DatabaseService } from "../src/db/database.js";
import { registerAgentReminderRoutes } from "../src/api/routes/agent-reminder-routes.js";
import { AuthService } from "../src/auth/auth-service.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agjassist-agent-reminder-routes-"));
  return path.join(dir, "test.sqlite");
}

describe("agent-reminder-routes C4", () => {
  let app: any;
  let db: DatabaseService;
  let dbPath: string;
  let ownerToken = "owner-token";
  let viewerToken = "viewer-token";
  let ownerUserId: number;

  beforeEach(async () => {
    dbPath = tempDb();
    db = new DatabaseService(dbPath);
    // create users
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
    registerAgentReminderRoutes(app, authService, db);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
    // cleanup temp dir
    try {
      fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
    } catch {}
  });

  it("GET /api/agent-reminders/active returns active reminders for owner", async () => {
    // create a reminder directly via service
    const { AgentSolicitService } = await import("../src/services/agent-solicit-service.js");
    const svc = new AgentSolicitService(db);
    svc.create({
      user_id: ownerUserId,
      folder_group: "g1",
      cadence_minutes: 30,
      recipients: [{ agent_name: "a1", include: 1 }],
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/agent-reminders/active",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.reminders).toHaveLength(1);
    expect(body.reminders[0].folder_group).toBe("g1");
  });

  it("GET /api/agent-reminders/active fails for non-owner", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/agent-reminders/active",
      headers: { authorization: `Bearer ${viewerToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST creates reminder with owner token, fails for non-owner", async () => {
    const resOwner = await app.inject({
      method: "POST",
      url: "/api/agent-reminders",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        folder_group: "g2",
        cadence_minutes: 15,
        repeat_limit: 3,
        recipients: [{ agent_name: "a2", include: 0 }],
      },
    });
    expect(resOwner.statusCode).toBe(201);
    const body = JSON.parse(resOwner.body);
    expect(body.reminder.folder_group).toBe("g2");
    expect(body.reminder.cadence_minutes).toBe(15);

    const resViewer = await app.inject({
      method: "POST",
      url: "/api/agent-reminders",
      headers: { authorization: `Bearer ${viewerToken}` },
      payload: { folder_group: "g3", cadence_minutes: 10 },
    });
    expect(resViewer.statusCode).toBe(403);
  });

  it("POST fails closed on malformed cadence and repeat", async () => {
    const resBadCadence = await app.inject({
      method: "POST",
      url: "/api/agent-reminders",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { folder_group: "g", cadence_minutes: 0 },
    });
    expect(resBadCadence.statusCode).toBe(400);

    const resBadRepeat = await app.inject({
      method: "POST",
      url: "/api/agent-reminders",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { folder_group: "g", cadence_minutes: 10, repeat_limit: -1 },
    });
    expect(resBadRepeat.statusCode).toBe(400);
  });

  it("PATCH updates reminder and include/skip, fails for non-owner", async () => {
    const { AgentSolicitService } = await import("../src/services/agent-solicit-service.js");
    const svc = new AgentSolicitService(db);
    const r = svc.create({
      user_id: ownerUserId,
      folder_group: "g-upd",
      cadence_minutes: 20,
      recipients: [{ agent_name: "a1", include: 1 }],
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/api/agent-reminders/${r.id}`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        cadence_minutes: 40,
        recipients: [{ agent_name: "a1", include: 0 }, { agent_name: "a2", include: 1 }],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.reminder.cadence_minutes).toBe(40);
    expect(body.reminder.recipients).toHaveLength(2);
    expect(body.reminder.recipients.find((x: any) => x.agent_name === "a1").include).toBe(0);

    const resViewer = await app.inject({
      method: "PATCH",
      url: `/api/agent-reminders/${r.id}`,
      headers: { authorization: `Bearer ${viewerToken}` },
      payload: { cadence_minutes: 50 },
    });
    expect(resViewer.statusCode).toBe(403);
  });

  it("PATCH fails closed on malformed cadence", async () => {
    const { AgentSolicitService } = await import("../src/services/agent-solicit-service.js");
    const svc = new AgentSolicitService(db);
    const r = svc.create({
      user_id: ownerUserId,
      folder_group: "g-bad",
      cadence_minutes: 10,
      recipients: [],
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/api/agent-reminders/${r.id}`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { cadence_minutes: -5 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("DELETE cancels reminder, fails for non-owner", async () => {
    const { AgentSolicitService } = await import("../src/services/agent-solicit-service.js");
    const svc = new AgentSolicitService(db);
    const r = svc.create({
      user_id: ownerUserId,
      folder_group: "g-del",
      cadence_minutes: 10,
      recipients: [],
    });

    const resOwner = await app.inject({
      method: "DELETE",
      url: `/api/agent-reminders/${r.id}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(resOwner.statusCode).toBe(204);

    // recreate for viewer test
    const r2 = svc.create({
      user_id: ownerUserId,
      folder_group: "g-del2",
      cadence_minutes: 10,
      recipients: [],
    });
    const resViewer = await app.inject({
      method: "DELETE",
      url: `/api/agent-reminders/${r2.id}`,
      headers: { authorization: `Bearer ${viewerToken}` },
    });
    expect(resViewer.statusCode).toBe(403);
  });
});
