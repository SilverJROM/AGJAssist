import { FastifyInstance } from "fastify";
import { ChatSettingsService } from "../../services/chat-settings-service.js";
import { createAuthMiddleware } from "../../auth/auth-middleware.js";
import { AuthService } from "../../auth/auth-service.js";

export function registerChatSettingsRoutes(
  app: FastifyInstance,
  authService: AuthService,
  chatSettingsService: ChatSettingsService
): void {
  const authMiddleware = createAuthMiddleware(authService);

  app.get(
    "/api/chat-settings",
    { preHandler: authMiddleware },
    async () => {
      return {
        settings: chatSettingsService.getAll()
      };
    }
  );

  app.get<{ Params: { key: string } }>(
    "/api/chat-settings/:key",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const value = chatSettingsService.get(request.params.key);
      if (value === undefined) return reply.code(404).send({ error: "Setting not found" });
      return { key: request.params.key, value };
    }
  );

  app.put<{ Params: { key: string }; Body: { value: string } }>(
    "/api/chat-settings/:key",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }

      const { value } = request.body || {};
      if (value === undefined) return reply.code(400).send({ error: "value is required" });

      chatSettingsService.set(request.params.key, value);
      return { key: request.params.key, value };
    }
  );

  app.delete<{ Params: { key: string } }>(
    "/api/chat-settings/:key",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }

      const deleted = chatSettingsService.delete(request.params.key);
      if (!deleted) return reply.code(404).send({ error: "Setting not found" });
      return { ok: true };
    }
  );
}
