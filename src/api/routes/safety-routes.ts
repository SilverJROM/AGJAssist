import { FastifyInstance } from "fastify";
import { SafetyService } from "../../services/safety-service.js";
import { createAuthMiddleware, requireOwner } from "../../auth/auth-middleware.js";
import { AuthService } from "../../auth/auth-service.js";

export function registerSafetyRoutes(
  app: FastifyInstance,
  authService: AuthService,
  safetyService: SafetyService
): void {
  const authMiddleware = createAuthMiddleware(authService);

  app.get(
    "/api/safety/patterns",
    { preHandler: authMiddleware },
    async () => {
      return { patterns: safetyService.listPatterns() };
    }
  );

  app.post<{ Body: { pattern: string; description?: string; is_regex?: boolean } }>(
    "/api/safety/patterns",
    { preHandler: [authMiddleware, requireOwner] },
    async (request, reply) => {
      const { pattern, description, is_regex } = request.body || {};
      if (!pattern) {
        return reply.code(400).send({ error: "pattern is required" });
      }
      const created = safetyService.addPattern(pattern, description || null, is_regex || false);
      return reply.code(201).send({ pattern: created });
    }
  );

  app.patch<{
    Params: { id: string };
    Body: { pattern?: string; description?: string; is_regex?: boolean; active?: boolean };
  }>(
    "/api/safety/patterns/:id",
    { preHandler: [authMiddleware, requireOwner] },
    async (request, reply) => {
      const updated = safetyService.updatePattern(
        Number(request.params.id),
        request.body || {}
      );
      if (!updated) {
        return reply.code(404).send({ error: "Pattern not found" });
      }
      return { pattern: updated };
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/api/safety/patterns/:id",
    { preHandler: [authMiddleware, requireOwner] },
    async (request, reply) => {
      const deleted = safetyService.deletePattern(Number(request.params.id));
      if (!deleted) {
        return reply.code(404).send({ error: "Pattern not found" });
      }
      return reply.code(204).send();
    }
  );

  app.post<{ Body: { command: string } }>(
    "/api/safety/check",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const { command } = request.body || {};
      if (!command) {
        return reply.code(400).send({ error: "command is required" });
      }
      return safetyService.checkCommand(command);
    }
  );
}
