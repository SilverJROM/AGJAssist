import { describe, expect, it, vi } from "vitest";
import {
  isTelegramNetworkError,
  startTelegramNonFatal
} from "../src/startup/telegram-resilience.js";

function logger() {
  return {
    log: vi.fn(),
    error: vi.fn()
  };
}

describe("Telegram startup resilience", () => {
  it("classifies Telegram request/network errors without matching generic failures", () => {
    const telegramError = Object.assign(
      new Error("RequestError: AggregateError: connect ETIMEDOUT"),
      {
        name: "RequestError",
        code: "ETIMEDOUT",
        stack: "RequestError\n at request-promise-core\n at node-telegram-bot-api\n https://api.telegram.org"
      }
    );

    expect(isTelegramNetworkError(telegramError)).toBe(true);
    expect(isTelegramNetworkError(new Error("AggregateError in unrelated code"))).toBe(false);
    expect(isTelegramNetworkError(new Error("TypeError: cannot read properties of undefined"))).toBe(false);
  });

  it("logs and continues when Telegram start fails", async () => {
    const log = logger();
    const telegram = {
      start: vi.fn(async () => {
        throw Object.assign(new Error("RequestError: AggregateError"), {
          name: "RequestError",
          code: "ETIMEDOUT",
          stack: "RequestError at node-telegram-bot-api"
        });
      })
    };

    const started = await startTelegramNonFatal(telegram, log);

    expect(started).toBe(false);
    expect(telegram.start).toHaveBeenCalledOnce();
    expect(log.error).toHaveBeenCalledWith(
      "Telegram bot startup failed; API, dashboard, and Overmind watcher remain online:",
      expect.stringContaining("RequestError")
    );
  });
});
