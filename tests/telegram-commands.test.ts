import { describe, expect, it, vi, beforeEach } from "vitest";

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
        "ovm_end"
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
});
