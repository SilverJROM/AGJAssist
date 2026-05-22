import { describe, it, expect } from "vitest";
import { AssistantCore } from "../../src/bot/assistant-core.js";
import { AppConfig } from "../../src/config/config.js";

class FakeTmuxService {
  async listJobsSummary(): Promise<string> {
    return "- build:0.0 | cmd=node | title=runner";
  }

  async peekPane(target: string, lines = 200): Promise<string> {
    return `peek ${target} ${lines}`;
  }

  async sendCommand(target: string, command: string, pressEnter = true): Promise<{ message: string; blocked: boolean }> {
    return { message: `sent ${command} -> ${target} (enter=${pressEnter})`, blocked: false };
  }
}

const config: AppConfig = {
  telegram: {
    botToken: "test",
    authorizedUserId: 123,
    testMode: true
  },
  llm: {
    ollamaBaseUrl: "http://localhost:11434",
    ollamaModel: "llama3",
    ollamaTimeoutMs: 1000,
    openrouterApiKey: "key",
    openrouterBaseUrl: "https://openrouter.ai/api/v1",
    openrouterModel: "z-ai/glm-4.5-air:free",
    openrouterTimeoutMs: 1000
  },
  runtime: {
    workspaceRoot: "/home/agjrom",
    allowedCommandPrefixes: ["tmux", "ls"],
    maxToolIterations: 4,
    defaultTimeoutMinutes: 60
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

describe("AssistantCore e2e", () => {
  it("supports manual tmux command path", async () => {
    const core = new AssistantCore(config, new FakeTmuxService() as any);

    const result = await core.handleCommand("/jobs");
    expect(result).toContain("build:0.0");
  });

  it("supports manual tmux_send command path", async () => {
    const core = new AssistantCore(config, new FakeTmuxService() as any);

    const result = await core.handleCommand("/tmux_send build:0.0 npm run test");
    expect(result).toContain("sent npm run test");
  });
});
