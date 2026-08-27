import { describe, it, expect } from "vitest";
import { AssistantCore } from "../src/bot/assistant-core.js";
import type { AppConfig } from "../src/config/config.js";

function testConfig(): AppConfig {
  return {
    telegram: {
      botToken: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
      authorizedUserId: 111222,
      authorizedChatIds: [],
      testMode: true,
      updateMode: "polling",
      webhookUrl: null,
      webhookPath: "/api/telegram/webhook",
      webhookSecretToken: "test-secret"
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
      jwtSecret: "test-secret",
      sessionExpiryHours: 24
    },
    db: {
      path: ":memory:"
    },
    projects: {
      root: "/tmp"
    },
    tmux: {
      historyRetentionDays: 7,
      outputBufferLines: 5000,
      streamIntervalMs: 100
    },
    overmind: {
      token: "ovm-test-token"
    }
  };
}

describe("Overmind command removal", () => {
  it("treats removed overmind/ovm commands as unknown", async () => {
    const core = new AssistantCore(testConfig(), {} as any);
    const removedCommands = [
      "/overmind",
      "/om_tasks 1",
      "/om_pause 1",
      "/om_resume 1",
      "/om_drop 1",
      "/ovm_start",
      "/ovm_end"
    ];

    for (const cmd of removedCommands) {
      const result = await core.handleCommand(cmd, 111222);
      expect(result).toBe("Unknown command. Use /help.");
    }
  });

  it("help text does not list removed commands", async () => {
    const core = new AssistantCore(testConfig(), {} as any);
    const help = await core.handleCommand("/help", 111222);
    const forbidden = [
      "/overmind",
      "/om_tasks",
      "/om_pause",
      "/om_resume",
      "/om_drop",
      "/ovm_start",
      "/ovm_end"
    ];
    for (const token of forbidden) {
      expect(help).not.toContain(token);
    }
  });
});
