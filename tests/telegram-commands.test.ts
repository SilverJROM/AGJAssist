import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";

const telegramMock = vi.hoisted(() => ({
  setMyCommands: vi.fn(async () => undefined),
  setChatMenuButton: vi.fn(async () => undefined),
  on: vi.fn(),
  deleteWebHook: vi.fn(async () => true),
  setWebHook: vi.fn(async () => true),
  startPolling: vi.fn(async () => undefined),
  processUpdate: vi.fn(),
  sendMessage: vi.fn(async () => undefined),
  editMessageText: vi.fn(async () => undefined),
  answerCallbackQuery: vi.fn(async () => undefined)
}));

vi.mock("node-telegram-bot-api", () => ({
  default: vi.fn(() => telegramMock)
}));

import { TelegramAssistant } from "../src/bot/telegram-bot.js";
import { AssistantCore } from "../src/bot/assistant-core.js";
import type { AppConfig } from "../src/config/config.js";
import { lokalaiLinkCodeStore } from "../src/bot/lokalai-link-code-store.js";

describe("Telegram command menu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("includes OVM and existing Overmind commands in setMyCommands", async () => {
    const assistant = new TelegramAssistant("test-token", {} as AssistantCore);

    await assistant.start();

    const commands = telegramMock.setMyCommands.mock.calls[0][0].map(
      (entry: { command: string }) => entry.command
    );
    // Menu trimmed to 10 essentials (om_tasks/om_drop removed from the menu — handlers still work).
    expect(commands).toEqual(
      expect.arrayContaining([
        "overmind",
        "om_pause",
        "om_resume",
        "ovm_start",
        "ovm_end",
        "lokalai_link"
      ])
    );
    expect(commands).not.toContain("om_tasks");
    expect(commands).not.toContain("om_drop");
  });

  it("keeps the existing weblogin callback path intact", async () => {
    const handlers = new Map<string, (payload: any) => Promise<void>>();
    telegramMock.on.mockImplementation((event: string, handler: (payload: any) => Promise<void>) => {
      handlers.set(event, handler);
      return telegramMock;
    });
    const core = {
      isAuthorized: vi.fn(() => true),
      handleCommand: vi.fn(async () => "login-code-response")
    } as unknown as AssistantCore;
    const assistant = new TelegramAssistant("test-token", core);

    await assistant.start();
    await handlers.get("callback_query")?.({
      id: "callback-1",
      data: "weblogin:2",
      from: { id: 1000000001 }
    });

    expect(core.isAuthorized).toHaveBeenCalledWith(1000000001);
    expect(core.handleCommand).toHaveBeenCalledWith("/weblogin 2");
    expect(telegramMock.answerCallbackQuery).toHaveBeenCalledWith("callback-1", undefined);
    expect(telegramMock.sendMessage).toHaveBeenCalledWith(1000000001, "login-code-response", undefined);
  });

  it("routes a user-initiated /lokalai_link command to the contacting Telegram id", async () => {
    const handlers = new Map<string, (payload: any) => Promise<void>>();
    telegramMock.on.mockImplementation((event: string, handler: (payload: any) => Promise<void>) => {
      handlers.set(event, handler);
      return telegramMock;
    });
    const core = {
      isAuthorized: vi.fn(() => true),
      isOvmChatMode: vi.fn(() => false),
      handleCommand: vi.fn(async () => "lokalAI link code: abc123")
    } as unknown as AssistantCore;
    const assistant = new TelegramAssistant("test-token", core);

    await assistant.start();
    await handlers.get("message")?.({
      chat: { id: 1000000001 },
      from: { id: 1000000001 },
      text: "/lokalai_link"
    });

    expect(core.isAuthorized).toHaveBeenCalledWith(1000000001);
    expect(core.handleCommand).toHaveBeenCalledWith("/lokalai_link", 1000000001);
    expect(telegramMock.sendMessage).toHaveBeenCalledWith(1000000001, "lokalAI link code: abc123", undefined);
  });

  it("never sends /lokalai_link output to an unsolicited chat outside the permitted-target allowlist", async () => {
    const handlers = new Map<string, (payload: any) => Promise<void>>();
    telegramMock.on.mockImplementation((event: string, handler: (payload: any) => Promise<void>) => {
      handlers.set(event, handler);
      return telegramMock;
    });
    const core = {
      isAuthorized: vi.fn(() => false),
      isOvmChatMode: vi.fn(() => false),
      handleCommand: vi.fn(async () => "lokalAI link code: abc123")
    } as unknown as AssistantCore;
    const assistant = new TelegramAssistant("test-token", core);

    await assistant.start();
    await handlers.get("message")?.({
      chat: { id: 99999 },
      from: { id: 99999 },
      text: "/lokalai_link"
    });

    expect(core.handleCommand).not.toHaveBeenCalled();
    expect(telegramMock.sendMessage).toHaveBeenCalledWith(99999, "Unauthorized access.", undefined);
  });
});

describe("AssistantCore /lokalai_link re-checks the permitted-target allowlist", () => {
  const AUTHORIZED_ID = 1000000001;
  const REVOKED_ID = 60000001;

  function testConfig(authorizedChatIds: number[]): AppConfig {
    return {
      telegram: {
        botToken: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
        authorizedUserId: authorizedChatIds[0] ?? AUTHORIZED_ID,
        authorizedChatIds,
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
        path: "data/test-lokalai-link-core.sqlite"
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

  afterEach(() => {
    lokalaiLinkCodeStore.clear();
  });

  it("issues a code for a Telegram id on the permitted-target allowlist", async () => {
    const core = new AssistantCore(testConfig([AUTHORIZED_ID]), {} as any);

    const response = await core.handleCommand("/lokalai_link", AUTHORIZED_ID);

    expect(response).toMatch(/^lokalAI link code: /);
  });

  it("refuses to mint a code once the contacting id is no longer on the permitted-target allowlist, even if handleCommand is reached directly", async () => {
    const core = new AssistantCore(testConfig([AUTHORIZED_ID]), {} as any);

    const response = await core.handleCommand("/lokalai_link", REVOKED_ID);

    expect(response).toBe("Unauthorized access.");
  });
});
