import { FastifyInstance } from "fastify";
import { AuthService } from "../../auth/auth-service.js";
import { createAuthMiddleware, requireOwner } from "../../auth/auth-middleware.js";
import { TerminalGroupsService } from "../../services/terminal-groups-service.js";

export function registerTerminalGroupsRoutes(
  app: FastifyInstance,
  authService: AuthService,
  terminalGroupsService: TerminalGroupsService
): void {
  const authMiddleware = createAuthMiddleware(authService);

  app.get(
    "/api/terminal/groups",
    { preHandler: [authMiddleware, requireOwner] },
    async (request) => {
      return terminalGroupsService.get(request.sessionUser!.id);
    }
  );

  app.put<{ Body: { groups?: unknown; activeGroup?: unknown } }>(
    "/api/terminal/groups",
    { preHandler: [authMiddleware, requireOwner] },
    async (request, reply) => {
      const body = request.body;
      if (body == null || typeof body !== "object" || Array.isArray(body)) {
        return reply.code(400).send({ error: "body must be an object with groups and activeGroup" });
      }
      return terminalGroupsService.put(request.sessionUser!.id, body);
    }
  );
}
