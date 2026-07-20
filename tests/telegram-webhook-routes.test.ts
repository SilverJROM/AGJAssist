import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { AppConfig } from "../src/config/config.js";
import { registerTelegramWebhookRoutes } from "../src/api/routes/telegram-webhook-routes.js";
import type { TelegramAssistant } from "../src/bot/telegram-bot.js";

function testConfig(): AppConfig {
  return {
    telegram: {
      botToken: "test-token",
      authorizedUserId: 1000000001,
      authorizedChatIds: [1000000001],
      testMode: true,
      updateMode: "webhook",
      webhookUrl: "https://example.test/api/telegram/webhook",
      webhookPath: "/api/telegram/webhook",
      webhookSecretToken: "test-webhook-secret"
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

describe("Telegram webhook route", () => {
  let app: FastifyInstance;
  let telegramAssistant: Pick<TelegramAssistant, "processUpdate">;

  beforeEach(async () => {
    telegramAssistant = {
      processUpdate: vi.fn()
    };
    app = Fastify({ logger: false });
    registerTelegramWebhookRoutes(app, testConfig(), telegramAssistant as TelegramAssistant);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  it("rejects requests without Telegram's webhook secret header", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/telegram/webhook",
      payload: { update_id: 1 }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ ok: false, error: "invalid_webhook_secret" });
    expect(telegramAssistant.processUpdate).not.toHaveBeenCalled();
  });

  it("rejects malformed webhook payloads", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/telegram/webhook",
      headers: {
        "x-telegram-bot-api-secret-token": "test-webhook-secret"
      },
      payload: { message: { text: "/help" } }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ ok: false, error: "invalid_update" });
    expect(telegramAssistant.processUpdate).not.toHaveBeenCalled();
  });

  it("passes valid Telegram updates to the bot wrapper", async () => {
    const update = {
      update_id: 123,
      message: {
        message_id: 1,
        date: 1,
        chat: { id: 1000000001, type: "private" },
        text: "/help"
      }
    };

    const response = await app.inject({
      method: "POST",
      url: "/api/telegram/webhook",
      headers: {
        "x-telegram-bot-api-secret-token": "test-webhook-secret"
      },
      payload: update
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(telegramAssistant.processUpdate).toHaveBeenCalledWith(update);
  });
});
