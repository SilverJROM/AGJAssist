import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
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

describe("guardian removal B6", () => {
  it("guardian-routes.ts is removed", () => {
    const path = new URL("../src/api/routes/guardian-routes.ts", import.meta.url);
    expect(existsSync(path)).toBe(false);
  });

  it("server.ts no longer imports or calls registerGuardianRoutes", () => {
    const src = readFileSync(new URL("../src/api/server.ts", import.meta.url), "utf8");
    expect(src).not.toContain("registerGuardianRoutes");
  });

  it("POST /api/guardian/escalate is not registered", async () => {
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
      overmindService: {} as any,
      appSettingsService: {} as any
    });
    const res = await app.inject({ method: "POST", url: "/api/guardian/escalate" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("calendar-reminder Telegram paging code is still present", () => {
    const src = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
    expect(src).toContain("Reminder Alert");
    expect(src).toContain("chat_id: config.telegram.authorizedUserId");
  });
});
