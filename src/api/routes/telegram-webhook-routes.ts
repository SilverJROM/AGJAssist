import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import crypto from "node:crypto";
import type TelegramBot from "node-telegram-bot-api";
import type { AppConfig } from "../../config/config.js";
import type { TelegramAssistant } from "../../bot/telegram-bot.js";

function timingSafeEqualString(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

const DEFAULT_WEBHOOK_PATH = "/api/telegram/webhook";

function hasValidWebhookSecret(request: FastifyRequest, expectedSecret: string): boolean {
  const received = request.headers["x-telegram-bot-api-secret-token"];
  return typeof received === "string" && timingSafeEqualString(received, expectedSecret);
}

function isTelegramUpdate(value: unknown): value is TelegramBot.Update {
  return Boolean(
    value &&
    typeof value === "object" &&
    Number.isInteger((value as { update_id?: unknown }).update_id)
  );
}

export function registerTelegramWebhookRoutes(
  app: FastifyInstance,
  config: AppConfig,
  telegramAssistant?: TelegramAssistant | null
): void {
  const webhookPath = config.telegram.webhookPath || DEFAULT_WEBHOOK_PATH;

  app.post(webhookPath, async (request, reply: FastifyReply) => {
    const expectedSecret = config.telegram.webhookSecretToken;
    if (!expectedSecret || !hasValidWebhookSecret(request, expectedSecret)) {
      reply.code(403).send({ ok: false, error: "invalid_webhook_secret" });
      return;
    }

    if (!telegramAssistant) {
      reply.code(503).send({ ok: false, error: "telegram_unavailable" });
      return;
    }

    if (!isTelegramUpdate(request.body)) {
      reply.code(400).send({ ok: false, error: "invalid_update" });
      return;
    }

    telegramAssistant.processUpdate(request.body);
    reply.send({ ok: true });
  });
}
