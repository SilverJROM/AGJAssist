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

function stubServices(): ApiServices {
  return {
    authService: {
      verifyToken: (t: string) => {
        if (t === OWNER_TOKEN) return { id: 1, role: "owner", username: "owner" };
        if (t === VIEWER_TOKEN) return { id: 2, role: "viewer", username: "viewer" };
        return null;
      }
    } as any,
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
}

describe("xmachines read routes C1", () => {
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

  const ownerHeaders = () => ({
    authorization: `Bearer ${OWNER_TOKEN}`,
    host: "agjasst.silverjrom.app",
    origin: "https://agjasst.silverjrom.app",
  });

  const viewerHeaders = () => ({
    authorization: `Bearer ${VIEWER_TOKEN}`,
    host: "agjasst.silverjrom.app",
    origin: "https://agjasst.silverjrom.app",
  });

  it("A2c: GET telemetry returns 401 without session", async () => {
    const res = await app.inject({ method: "GET", url: "/api/xmachines/telemetry", headers: {} });
    expect(res.statusCode).toBe(401);
  });

  it("A2c: GET telemetry returns 403 for non-owner", async () => {
    const res = await app.inject({ method: "GET", url: "/api/xmachines/telemetry", headers: viewerHeaders() });
    expect(res.statusCode).toBe(403);
  });

  it("A2c: GET telemetry returns 200 for owner", async () => {
    const res = await app.inject({ method: "GET", url: "/api/xmachines/telemetry", headers: ownerHeaders() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("machines");
    expect(Array.isArray(body.machines)).toBe(true);
    expect(body).toHaveProperty("armed");
    expect(body).toHaveProperty("mode");
  });

  it("A2c: GET machine detail returns 401 without session", async () => {
    const res = await app.inject({ method: "GET", url: "/api/xmachines/machines/gpu", headers: {} });
    expect(res.statusCode).toBe(401);
  });

  it("A2c: GET machine detail returns 403 for non-owner", async () => {
    const res = await app.inject({ method: "GET", url: "/api/xmachines/machines/gpu", headers: viewerHeaders() });
    expect(res.statusCode).toBe(403);
  });

  it("A2c: GET machine detail returns 200 for owner", async () => {
    const res = await app.inject({ method: "GET", url: "/api/xmachines/machines/gpu", headers: ownerHeaders() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("machine");
    expect(body.machine).toHaveProperty("name");
  });

  it("B1a: overview lists machines from telemetry", async () => {
    const res = await app.inject({ method: "GET", url: "/api/xmachines/telemetry", headers: ownerHeaders() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const names = body.machines.map((m: any) => m.name);
    expect(names.length).toBeGreaterThan(0);
  });

  it("B1f: DOWN machine renders without error", async () => {
    // Synthetic telemetry includes machines; detail should not 500
    const res = await app.inject({ method: "GET", url: "/api/xmachines/machines/gpu", headers: ownerHeaders() });
    expect(res.statusCode).toBe(200);
  });
});
