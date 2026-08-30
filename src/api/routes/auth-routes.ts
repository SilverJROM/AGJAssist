import { FastifyInstance } from "fastify";
import type { AppConfig } from "../../config/config.js";
import type { TelegramAssistant } from "../../bot/telegram-bot.js";
import { AuthService } from "../../auth/auth-service.js";
import { createAuthMiddleware, requireOwner } from "../../auth/auth-middleware.js";

export function registerAuthRoutes(
  app: FastifyInstance,
  authService: AuthService,
  config?: AppConfig,
  telegramAssistant?: TelegramAssistant | null
): void {
  const authMiddleware = createAuthMiddleware(authService);

  // ---- 2FA (TOTP) + Telegram number-match web login ----
  // Enter your 6-digit 2FA code -> the bot sends 3 numbers, you tap the one shown
  // on the web -> logged in. (Runs alongside the /weblogin-code login.)
  app.post<{ Body: { totp?: string; hours?: number } }>(
    "/api/auth/tg2fa/start",
    async (request, reply) => {
      const { totp, hours } = request.body || {};
      if (!totp || !/^\d{6}$/.test(String(totp).trim())) {
        return reply.code(400).send({ error: "A 6-digit 2FA code is required" });
      }
      if (!config || !telegramAssistant) {
        return reply.code(503).send({ error: "Telegram sign-in is unavailable" });
      }
      const ownerId = config.telegram.authorizedUserId;
      const sessionHours = Number.isFinite(Number(hours)) && Number(hours) > 0 ? Number(hours) : undefined;
      const challenge = authService.startTgChallenge(ownerId, String(totp).trim(), sessionHours);
      if (!challenge) {
        return reply.code(401).send({ error: "Invalid 2FA code" });
      }
      try {
        await telegramAssistant.sendTgAuthChallenge(ownerId, challenge.challengeId, challenge.buttons);
      } catch {
        return reply.code(502).send({ error: "Could not send the Telegram challenge" });
      }
      return { challengeId: challenge.challengeId, displayNumber: challenge.displayNumber };
    }
  );

  app.post<{ Body: { challengeId?: string } }>(
    "/api/auth/tg2fa/poll",
    async (request, reply) => {
      const { challengeId } = request.body || {};
      if (!challengeId || typeof challengeId !== "string") {
        return reply.code(400).send({ error: "challengeId is required" });
      }
      const result = authService.pollTgChallenge(challengeId);
      if ("token" in result) {
        return result;
      }
      if (result.status === "pending") {
        return reply.code(200).send({ status: "pending" });
      }
      return reply.code(401).send({ status: result.status });
    }
  );

  app.post<{ Body: { initData: string; surface?: "miniapp" | "web" } }>(
    "/api/auth/telegram",
    async (request, reply) => {
      const { initData, surface = "web" } = request.body || {};
      if (!initData) {
        return reply.code(400).send({ error: "initData is required" });
      }

      const result = authService.authenticateTelegram(initData, surface);
      if (!result) {
        return reply.code(401).send({ error: "Authentication failed" });
      }

      return result;
    }
  );

  app.post<{ Body: { code: string; totp?: string } }>(
    "/api/auth/code",
    async (request, reply) => {
      const { code, totp } = request.body || {};
      if (!code) {
        return reply.code(400).send({ error: "code is required" });
      }

      const result = authService.authenticateWithCode(code, totp);
      if (!result) {
        return reply.code(401).send({ error: "Invalid code, expired, or invalid 2FA" });
      }

      return result;
    }
  );

  // Check if 2FA is required for a login code (before authenticating)
  app.post<{ Body: { code: string } }>(
    "/api/auth/2fa/check",
    async (request, reply) => {
      const { code } = request.body || {};
      if (!code) {
        return reply.code(400).send({ error: "code is required" });
      }

      const requires2FA = authService.codeRequires2FA(code);
      return { requires2FA };
    }
  );

  app.get(
    "/api/auth/me",
    { preHandler: authMiddleware },
    async (request) => {
      return {
        user: request.sessionUser,
        totp_enabled: authService.is2FAEnabled(request.sessionUser!.id)
      };
    }
  );

  app.post(
    "/api/auth/logout",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const token = request.headers.authorization?.slice(7);
      if (token) {
        authService.logout(token);
      }
      return reply.code(204).send();
    }
  );

  // 2FA setup — generates secret + QR code
  app.get(
    "/api/auth/2fa/setup",
    { preHandler: [authMiddleware, requireOwner] },
    async (request, reply) => {
      const result = await authService.setup2FA(request.sessionUser!.id);
      if (!result) {
        return reply.code(400).send({ error: "2FA setup failed" });
      }
      return result;
    }
  );

  // 2FA confirm — verify TOTP to activate
  app.post<{ Body: { token: string } }>(
    "/api/auth/2fa/confirm",
    { preHandler: [authMiddleware, requireOwner] },
    async (request, reply) => {
      const { token } = request.body || {};
      if (!token) {
        return reply.code(400).send({ error: "token is required" });
      }

      const ok = authService.confirm2FA(request.sessionUser!.id, token);
      if (!ok) {
        return reply.code(400).send({ error: "Invalid code. Try again." });
      }

      return { enabled: true };
    }
  );

  // 2FA disable
  app.post(
    "/api/auth/2fa/disable",
    { preHandler: [authMiddleware, requireOwner] },
    async (request, reply) => {
      const { token } = (request.body || {}) as { token?: string };
      if (!token) {
        return reply.code(400).send({ error: "Current TOTP token required to disable 2FA" });
      }

      // Verify current TOTP before allowing disable
      const user = request.sessionUser!;
      const row = authService.getUserRow(user.id);
      if (!row?.totp_secret || !row.totp_enabled) {
        return reply.code(400).send({ error: "2FA is not enabled" });
      }

      const otp = await import("otplib");
      if (!otp.verifySync({ token, secret: row.totp_secret }).valid) {
        return reply.code(400).send({ error: "Invalid TOTP code" });
      }

      authService.disable2FA(user.id);
      return { enabled: false };
    }
  );
}
