import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseService } from "../src/db/database.js";
import { createApiServer, type ApiServices } from "../src/api/server.js";
import { AppConfig } from "../src/config/config.js";

const OWNER_TOKEN = "owner-token";
const VIEWER_TOKEN = "viewer-token";

function minimalConfig(): AppConfig {
  return {
    telegram: {
      botToken: "123:ABC",
      authorizedUserId: 1,
      authorizedChatIds: [1],
      testMode: true,
      updateMode: "polling",
      webhookUrl: null,
      webhookPath: "/api/telegram/webhook",
      webhookSecretToken: "s"
    },
    runtime: {
      workspaceRoot: "/tmp",
      allowedCommandPrefixes: [],
      maxToolIterations: 1,
      defaultTimeoutMinutes: 1
    },
    api: {
      port: 0,
      host: "127.0.0.1",
      jwtSecret: "s",
      sessionExpiryHours: 24
    },
    db: { path: ":memory:" },
    projects: { root: "/tmp" },
    tmux: { historyRetentionDays: 1, outputBufferLines: 100, streamIntervalMs: 100 },
    overmind: { token: "t" }
  };
}

function stubServices(authServiceOverride?: any): ApiServices {
  const base = {
    authService: authServiceOverride ?? {
      verifyToken: (t: string) => {
        if (t === OWNER_TOKEN) return { id: 1, role: "owner", username: "owner" };
        if (t === VIEWER_TOKEN) return { id: 2, role: "viewer", username: "viewer" };
        return null;
      }
    },
    projectService: {} as any,
    safetyService: {} as any,
    auditService: {} as any,
    tmuxService: {} as any,
    tmuxStreamManager: {} as any,
    db: new DatabaseService(":memory:"),
    delegationService: {} as any,
    noteService: {} as any,
    planService: {} as any,
    taskService: {} as any,
    fileService: {} as any,
    stepTemplateService: {} as any,
    personalTaskService: {} as any,
    reminderService: {} as any,
    agentAssignmentService: {} as any,
  };
  return base;
}

describe("xmachines auth/origin route guards A6", () => {
  let app: any;
  let db: DatabaseService;

  beforeEach(async () => {
    db = new DatabaseService(":memory:");
    const services = stubServices();
    app = await createApiServer(minimalConfig(), services);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  const ownerHeaders = (extra: Record<string, string> = {}) => ({
    authorization: `Bearer ${OWNER_TOKEN}`,
    host: "agjasst.silverjrom.app",
    origin: "https://agjasst.silverjrom.app",
    ...extra
  });

  const viewerHeaders = (extra: Record<string, string> = {}) => ({
    authorization: `Bearer ${VIEWER_TOKEN}`,
    host: "agjasst.silverjrom.app",
    origin: "https://agjasst.silverjrom.app",
    ...extra
  });

  const routes = [
    { method: "GET" as const, url: "/api/xmachines/telemetry" },
    { method: "GET" as const, url: "/api/xmachines/machines/gpu" },
    { method: "POST" as const, url: "/api/xmachines/machines/gpu/power/off" },
    { method: "POST" as const, url: "/api/xmachines/machines/gpu/power/on" },
  ];

  it("A2c/H1a: missing auth returns 401 on every xmachines route", async () => {
    for (const route of routes) {
      const res = await app.inject({ method: route.method, url: route.url, headers: {} });
      expect(res.statusCode, `${route.method} ${route.url}`).toBe(401);
    }
  });

  it("A2c/H1a: invalid auth returns 401 on every xmachines route", async () => {
    for (const route of routes) {
      const res = await app.inject({
        method: route.method,
        url: route.url,
        headers: { authorization: "Bearer not-a-session", host: "agjasst.silverjrom.app" },
      });
      expect(res.statusCode, `${route.method} ${route.url}`).toBe(401);
    }
  });

  it("A2c/H1a: viewer auth returns 403 on every xmachines route", async () => {
    for (const route of routes) {
      const res = await app.inject({ method: route.method, url: route.url, headers: viewerHeaders() });
      expect(res.statusCode, `${route.method} ${route.url}`).toBe(403);
    }
  });

  it("H1a: GET telemetry returns 200 for owner with canonical host/origin", async () => {
    const res = await app.inject({ method: "GET", url: "/api/xmachines/telemetry", headers: ownerHeaders() });
    expect(res.statusCode).toBe(200);
  });

  it("H1b/H1c/L6b/L6c: power route rejects non-canonical Host", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/xmachines/machines/gpu/power/off",
      headers: ownerHeaders({ host: "evil.example.com" })
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "host_not_allowed" });
  });

  it("H1b/L6b: canonical host with a noncanonical port is refused", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/xmachines/machines/gpu/power/off",
      headers: ownerHeaders({ host: "agjasst.silverjrom.app:9999" })
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "host_not_allowed" });
  });

  it("H1b/L6b: X-Forwarded-Host canonical alias with a noncanonical port is refused", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/xmachines/machines/gpu/power/off",
      headers: ownerHeaders({ "x-forwarded-host": "agjasst.silverjrom.app:9999" })
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "host_not_allowed" });
  });

  it("H1b/H1c/L6b/L6c: power route rejects non-canonical Origin", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/xmachines/machines/gpu/power/off",
      headers: ownerHeaders({ origin: "https://evil.example.com" })
    });
    expect(res.statusCode).toBe(403);
  });

  it("L6a: power route accepts POST only", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/xmachines/machines/gpu/power/off",
      headers: ownerHeaders()
    });
    // Fastify returns 404 for unknown method on defined route; accept 404 or 405
    expect([404, 405]).toContain(res.statusCode);
  });

  it("L6j: loopback peer with non-canonical Host is refused", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/xmachines/machines/gpu/power/off",
      headers: ownerHeaders({ host: "127.0.0.1:9999", origin: "http://127.0.0.1:9999" })
    });
    expect(res.statusCode).toBe(403);
  });

  const unarmed = (action: "on" | "off") => ({
    ok: false,
    actuated: false,
    mode: "fake",
    reason: "unarmed",
    machine: "gpu",
    action,
  });

  it("L6d: the 11th request on one power route is 429", async () => {
    const url = "/api/xmachines/machines/gpu/power/off";
    for (let i = 0; i < 10; i++) {
      const res = await app.inject({ method: "POST", url, headers: ownerHeaders() });
      expect(res.statusCode, `request ${i + 1}`).toBe(403);
      expect(res.json(), `request ${i + 1}`).toEqual(unarmed("off"));
    }
    const blocked = await app.inject({ method: "POST", url, headers: ownerHeaders() });
    expect(blocked.statusCode).toBe(429);
  });

  it("L6e: the 11th alternating owner power request is 429", async () => {
    const services = stubServices();
    const fresh = await createApiServer(minimalConfig(), services);
    await fresh.ready();
    try {
      const urls = [
        "/api/xmachines/machines/gpu/power/off",
        "/api/xmachines/machines/gpu/power/on",
      ] as const;
      for (let i = 0; i < 10; i++) {
        const action = i % 2 === 0 ? "off" : "on";
        const res = await fresh.inject({ method: "POST", url: urls[i % 2], headers: ownerHeaders() });
        expect(res.statusCode, `request ${i + 1}`).toBe(403);
        expect(res.json(), `request ${i + 1}`).toEqual(unarmed(action));
      }
      const blocked = await fresh.inject({ method: "POST", url: urls[0], headers: ownerHeaders() });
      expect(blocked.statusCode).toBe(429);
    } finally {
      await fresh.close();
      services.db.close();
    }
  });
});
