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

describe("xmachines history routes C2", () => {
  let app: any;
  let db: DatabaseService;

  beforeEach(async () => {
    db = new DatabaseService(":memory:");
    const services = stubServices();
    services.db = db;
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

  it("history route returns 401 without session", async () => {
    const res = await app.inject({ method: "GET", url: "/api/xmachines/machines/quartz/history?metric=temperature", headers: {} });
    expect(res.statusCode).toBe(401);
  });

  it("history route returns 403 for non-owner", async () => {
    const res = await app.inject({ method: "GET", url: "/api/xmachines/machines/quartz/history?metric=temperature", headers: viewerHeaders() });
    expect(res.statusCode).toBe(403);
  });

  it("history route returns 400 for invalid metric", async () => {
    const res = await app.inject({ method: "GET", url: "/api/xmachines/machines/quartz/history?metric=invalid", headers: ownerHeaders() });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toHaveProperty("error", "invalid_metric");
  });

  it("history route returns series from xm_samples for owner", async () => {
    db.raw.prepare(`
      INSERT INTO xm_samples (machine_name, gpu_uuid, sample_time, temperature, power_watts, utilization_gpu)
      VALUES
        ('quartz', 'gpu-1', '2026-09-01T00:00:00Z', 60, 120, 10),
        ('quartz', 'gpu-1', '2026-09-01T01:00:00Z', 62, 125, 12),
        ('quartz', 'gpu-2', '2026-09-01T00:00:00Z', 58, 110, 8)
    `).run();

    const tempRes = await app.inject({ method: "GET", url: "/api/xmachines/machines/quartz/history?metric=temperature", headers: ownerHeaders() });
    expect(tempRes.statusCode).toBe(200);
    const tempBody = tempRes.json();
    expect(tempBody.machine).toBe("quartz");
    expect(tempBody.metric).toBe("temperature");
    expect(Array.isArray(tempBody.series)).toBe(true);
    expect(tempBody.series).toHaveLength(3);
    const tempValues = tempBody.series.map((s: any) => s.value);
    expect(tempValues).toEqual(expect.arrayContaining([58, 60, 62]));
    expect(tempBody.series[2]).toMatchObject({ time: "2026-09-01T01:00:00Z", value: 62 });

    const powerRes = await app.inject({ method: "GET", url: "/api/xmachines/machines/quartz/history?metric=power", headers: ownerHeaders() });
    expect(powerRes.statusCode).toBe(200);
    const powerBody = powerRes.json();
    expect(powerBody.metric).toBe("power");
    expect(powerBody.series).toHaveLength(3);
    const powerValues = powerBody.series.map((s: any) => s.value);
    expect(powerValues).toEqual(expect.arrayContaining([110, 120, 125]));

    const utilRes = await app.inject({ method: "GET", url: "/api/xmachines/machines/quartz/history?metric=utilization", headers: ownerHeaders() });
    expect(utilRes.statusCode).toBe(200);
    const utilBody = utilRes.json();
    expect(utilBody.metric).toBe("utilization");
    const utilValues = utilBody.series.map((s: any) => s.value);
    expect(utilValues).toEqual(expect.arrayContaining([8, 10, 12]));
  });

  it("history route respects time window", async () => {
    db.raw.prepare(`
      INSERT INTO xm_samples (machine_name, gpu_uuid, sample_time, temperature, power_watts, utilization_gpu)
      VALUES
        ('quartz', 'gpu-1', '2026-09-01T00:00:00Z', 60, 120, 10),
        ('quartz', 'gpu-1', '2026-09-01T01:00:00Z', 62, 125, 12)
    `).run();

    const res = await app.inject({ method: "GET", url: "/api/xmachines/machines/quartz/history?metric=temperature&from=2026-09-01T00:30:00Z&to=2026-09-01T02:00:00Z", headers: ownerHeaders() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.series).toHaveLength(1);
    expect(body.series[0].value).toBe(62);
  });
});
