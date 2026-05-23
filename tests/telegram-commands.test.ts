import { describe, expect, it, vi, beforeEach } from "vitest";

const telegramMock = vi.hoisted(() => ({
  setMyCommands: vi.fn(async () => undefined),
  setChatMenuButton: vi.fn(async () => undefined),
  on: vi.fn(),
  startPolling: vi.fn(async () => undefined),
  sendMessage: vi.fn(async () => undefined),
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
});
