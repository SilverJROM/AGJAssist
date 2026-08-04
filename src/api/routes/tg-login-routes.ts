import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppConfig } from "../../config/config.js";
import type { TelegramAssistant } from "../../bot/telegram-bot.js";
import { helmLoginChallengeStore } from "../../bot/helm-login-store.js";

interface HelmLoginChallengeBody {
  challengeId?: unknown;
  chatId?: unknown;
  displayNumber?: unknown;
  buttons?: unknown;
  prompt?: unknown;
  callbackUrl?: unknown;
}

const DEFAULT_PROMPT = "Sign-in attempt for Helm - tap the number you see on screen:";

function isLoopbackAddress(ip: string | undefined | null): boolean {
  if (!ip) return false;
  const v = String(ip).trim().replace(/^\[/, "").replace(/\]$/, "");
  if (v === "127.0.0.1" || v === "::1" || v === "::ffff:127.0.0.1") return true;
  if (v.startsWith("127.")) return true;
  return false;
}

function requireLoopback(request: FastifyRequest, reply: FastifyReply, done: () => void): void {
  const direct = (request.raw as any)?.socket?.remoteAddress || (request.raw as any)?.connection?.remoteAddress;
  const ip = direct || request.ip || String((request.headers["x-forwarded-for"] as string) || "").split(",")[0].trim();
  if (!isLoopbackAddress(ip)) {
    reply.code(403).send({ ok: false, error: "loopback_required" });
    return;
  }
  done();
}

function isTwoDigitInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 10 && Number(value) <= 99;
}

function isPermittedChatId(value: unknown, permitted: readonly number[]): value is number {
  return typeof value === "number" && permitted.includes(value);
}

function isLoopbackHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && isLoopbackAddress(url.hostname);
  } catch {
    return false;
  }
}

function validationError(reply: FastifyReply, error: string): void {
  reply.code(400).send({ ok: false, error });
}

export function registerTgLoginRoutes(
  app: FastifyInstance,
  config: AppConfig,
  telegramAssistant?: TelegramAssistant | null
): void {
  app.post(
    "/api/tg/login-challenge",
    { preHandler: requireLoopback },
    async (request, reply) => {
      const body = request.body as HelmLoginChallengeBody | undefined;

      if (!body || typeof body !== "object") {
        validationError(reply, "invalid_body");
        return;
      }

      if (typeof body.challengeId !== "string" || body.challengeId.trim().length === 0) {
        validationError(reply, "invalid_challenge_id");
        return;
      }

      const permittedChatIds = config.telegram.authorizedChatIds || [config.telegram.authorizedUserId];
      if (!isPermittedChatId(body.chatId, permittedChatIds)) {
        validationError(reply, "invalid_chat_id");
        return;
      }

      if (!isTwoDigitInteger(body.displayNumber)) {
        validationError(reply, "invalid_display_number");
        return;
      }

      if (
        !Array.isArray(body.buttons) ||
        body.buttons.length !== 3 ||
        !body.buttons.every(isTwoDigitInteger) ||
        !body.buttons.includes(body.displayNumber)
      ) {
        validationError(reply, "invalid_buttons");
        return;
      }

      const prompt = typeof body.prompt === "string" && body.prompt.trim().length > 0
        ? body.prompt
        : DEFAULT_PROMPT;

      if (typeof body.callbackUrl !== "string" || !isLoopbackHttpUrl(body.callbackUrl)) {
        validationError(reply, "invalid_callback_url");
        return;
      }

      if (!telegramAssistant) {
        reply.code(503).send({ ok: false, error: "telegram_unavailable" });
        return;
      }

      const challengeId = body.challengeId.trim();
      const stored = helmLoginChallengeStore.put({
        challengeId,
        displayNumber: body.displayNumber,
        callbackUrl: body.callbackUrl
      });

      if (!stored.ok) {
        reply.code(409).send({ ok: false, error: "challenge_exists" });
        return;
      }

      try {
        await telegramAssistant.sendHelmChallenge({
          chatId: body.chatId,
          prompt,
          challengeId,
          buttons: body.buttons
        });
      } catch (error) {
        helmLoginChallengeStore.consume(challengeId);
        console.error("Helm Telegram challenge send failed:", error);
        reply.code(502).send({ ok: false, error: "telegram_send_failed" });
        return;
      }

      reply.send({ ok: true });
    }
  );
}
