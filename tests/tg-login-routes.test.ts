import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { AppConfig } from "../src/config/config.js";
import { registerTgLoginRoutes } from "../src/api/routes/tg-login-routes.js";
import { helmLoginChallengeStore } from "../src/bot/helm-login-store.js";
import type { TelegramAssistant } from "../src/bot/telegram-bot.js";

const OWNER_CHAT_ID = 1000000001;
const SECOND_PERMITTED_CHAT_ID = 6180223491;

function testConfig(): AppConfig {
  return {
    telegram: {
      botToken: "test-token",
      authorizedUserId: OWNER_CHAT_ID,
      authorizedChatIds: [OWNER_CHAT_ID, SECOND_PERMITTED_CHAT_ID],
      testMode: true
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
      token: "test-overmind-token"
    }
  };
}

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    challengeId: "challenge-1",
    chatId: OWNER_CHAT_ID,
    displayNumber: 42,
    buttons: [42, 17, 88],
    prompt: "Sign-in attempt for Helm - tap the number you see on screen:",
    callbackUrl: "http://127.0.0.1:3110/api/auth/tg-callback",
    ...overrides
  };
}

describe("Telegram login challenge route", () => {
  let app: FastifyInstance;
  let telegramAssistant: Pick<TelegramAssistant, "sendHelmChallenge">;

  beforeEach(async () => {
    helmLoginChallengeStore.clear();
    telegramAssistant = {
      sendHelmChallenge: vi.fn(async () => undefined)
    };
    app = Fastify({ logger: false });
    registerTgLoginRoutes(app, testConfig(), telegramAssistant as TelegramAssistant);
    await app.ready();
  });

  afterEach(async () => {
    helmLoginChallengeStore.clear();
    await app.close();
    vi.restoreAllMocks();
  });

  it("rejects non-loopback callers", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/tg/login-challenge",
      remoteAddress: "10.0.0.5",
      payload: validPayload()
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ ok: false, error: "loopback_required" });
    expect(telegramAssistant.sendHelmChallenge).not.toHaveBeenCalled();
  });

  it("rejects chat IDs outside the permitted-target allowlist without sending Telegram", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/tg/login-challenge",
      remoteAddress: "127.0.0.1",
      payload: validPayload({ chatId: 12345 })
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ ok: false, error: "invalid_chat_id" });
    expect(telegramAssistant.sendHelmChallenge).not.toHaveBeenCalled();
  });

  it("accepts a challenge for any chat ID present in the permitted-target allowlist, not only the primary owner", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/tg/login-challenge",
      remoteAddress: "127.0.0.1",
      payload: validPayload({ challengeId: "challenge-second-user", chatId: SECOND_PERMITTED_CHAT_ID })
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(telegramAssistant.sendHelmChallenge).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: SECOND_PERMITTED_CHAT_ID })
    );
  });

  it("rejects malformed button and display-number payloads", async () => {
    const badButtons = await app.inject({
      method: "POST",
      url: "/api/tg/login-challenge",
      remoteAddress: "127.0.0.1",
      payload: validPayload({ buttons: [17, 88, 99] })
    });

    expect(badButtons.statusCode).toBe(400);
    expect(badButtons.json()).toEqual({ ok: false, error: "invalid_buttons" });

    const badDisplay = await app.inject({
      method: "POST",
      url: "/api/tg/login-challenge",
      remoteAddress: "127.0.0.1",
      payload: validPayload({ challengeId: "challenge-2", displayNumber: 7, buttons: [7, 17, 88] })
    });

    expect(badDisplay.statusCode).toBe(400);
    expect(badDisplay.json()).toEqual({ ok: false, error: "invalid_display_number" });
    expect(telegramAssistant.sendHelmChallenge).not.toHaveBeenCalled();
  });

  it("accepts a valid challenge, stores it, and sends the inline keyboard through the bot bridge", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/tg/login-challenge",
      remoteAddress: "127.0.0.1",
      payload: validPayload()
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(telegramAssistant.sendHelmChallenge).toHaveBeenCalledWith({
      chatId: OWNER_CHAT_ID,
      prompt: "Sign-in attempt for Helm - tap the number you see on screen:",
      challengeId: "challenge-1",
      buttons: [42, 17, 88]
    });
    expect(helmLoginChallengeStore.get("challenge-1")).toMatchObject({
      challengeId: "challenge-1",
      displayNumber: 42,
      callbackUrl: "http://127.0.0.1:3110/api/auth/tg-callback"
    });
  });

  it("surfaces Telegram send failure and removes the stored challenge", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    telegramAssistant.sendHelmChallenge = vi.fn(async () => {
      throw new Error("telegram unavailable");
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/tg/login-challenge",
      remoteAddress: "127.0.0.1",
      payload: validPayload()
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ ok: false, error: "telegram_send_failed" });
    expect(helmLoginChallengeStore.get("challenge-1")).toBeNull();
    consoleError.mockRestore();
  });
});
