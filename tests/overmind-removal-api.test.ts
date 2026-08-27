import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createApiServer } from "../src/api/server.js";
import { AppConfig } from "../src/config/config.js";

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

describe("overmind removal B2 API layer", () => {
  it("server.ts does not import registerOvermindRoutes", () => {
    const src = readFileSync(new URL("../src/api/server.ts", import.meta.url), "utf8");
    expect(src).not.toContain("registerOvermindRoutes");
  });

  it("server.ts does not import OvermindStreamManager", () => {
    const src = readFileSync(new URL("../src/api/server.ts", import.meta.url), "utf8");
    expect(src).not.toContain("OvermindStreamManager");
  });

  it("ApiServices interface has no overmind fields", () => {
    const src = readFileSync(new URL("../src/api/server.ts", import.meta.url), "utf8");
    expect(src).not.toContain("overmindService");
    expect(src).not.toContain("overmindNotify");
    expect(src).not.toContain("overmindStreamManager");
  });

  it("GET /api/overmind/projects is not registered", async () => {
    const app = await createApiServer(minimalConfig(), {
      authService: {} as any,
      projectService: {} as any,
      safetyService: {} as any,
      auditService: {} as any,
      tmuxService: {} as any,
      tmuxStreamManager: {} as any,
      db: {} as any,
      delegationService: {} as any,
      noteService: {} as any,
      planService: {} as any,
      taskService: {} as any,
      fileService: {} as any,
      stepTemplateService: {} as any,
      personalTaskService: {} as any,
      reminderService: {} as any,
      agentAssignmentService: {} as any,
      appSettingsService: {} as any,
      agentEventsStreamManager: {} as any
    } as any);
    const res = await app.inject({ method: "GET", url: "/api/overmind/projects" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("POST /api/overmind/register is not registered", async () => {
    const app = await createApiServer(minimalConfig(), {
      authService: {} as any,
      projectService: {} as any,
      safetyService: {} as any,
      auditService: {} as any,
      tmuxService: {} as any,
      tmuxStreamManager: {} as any,
      db: {} as any,
      delegationService: {} as any,
      noteService: {} as any,
      planService: {} as any,
      taskService: {} as any,
      fileService: {} as any,
      stepTemplateService: {} as any,
      personalTaskService: {} as any,
      reminderService: {} as any,
      agentAssignmentService: {} as any,
      appSettingsService: {} as any,
      agentEventsStreamManager: {} as any
    } as any);
    const res = await app.inject({ method: "POST", url: "/api/overmind/register", payload: { run_dir: "/tmp", token: "t" } });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("GET /api/overmind/describe is not registered", async () => {
    const app = await createApiServer(minimalConfig(), {
      authService: {} as any,
      projectService: {} as any,
      safetyService: {} as any,
      auditService: {} as any,
      tmuxService: {} as any,
      tmuxStreamManager: {} as any,
      db: {} as any,
      delegationService: {} as any,
      noteService: {} as any,
      planService: {} as any,
      taskService: {} as any,
      fileService: {} as any,
      stepTemplateService: {} as any,
      personalTaskService: {} as any,
      reminderService: {} as any,
      agentAssignmentService: {} as any,
      appSettingsService: {} as any,
      agentEventsStreamManager: {} as any
    } as any);
    const res = await app.inject({ method: "GET", url: "/api/overmind/describe" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
