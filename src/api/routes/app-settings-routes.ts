import { FastifyInstance } from "fastify";
import { AuthService } from "../../auth/auth-service.js";
import { createAuthMiddleware } from "../../auth/auth-middleware.js";
import { AppSettingsService, OvermindCooldowns } from "../../services/app-settings-service.js";

interface PatchOvermindBody {
  idle_nudge_cooldown_minutes?: number;
  task_stale_ask_cooldown_minutes?: number;
  task_stale_recent_update_grace_minutes?: number;
}

export function registerAppSettingsRoutes(
  app: FastifyInstance,
  authService: AuthService,
  appSettingsService: AppSettingsService
): void {
  const authMiddleware = createAuthMiddleware(authService);

  // GET /api/app-settings — returns the overmind cooldowns object.
  app.get(
    "/api/app-settings",
    { preHandler: authMiddleware },
    async () => {
      const overmind = appSettingsService.get();
      return { overmind };
    }
  );

  // PATCH /api/app-settings/overmind — update one or more overmind cooldown values.
  app.patch<{ Body: PatchOvermindBody }>(
    "/api/app-settings/overmind",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }

      const body = request.body ?? {};
      const validKeys: Array<keyof OvermindCooldowns> = [
        "idle_nudge_cooldown_minutes",
        "task_stale_ask_cooldown_minutes",
        "task_stale_recent_update_grace_minutes"
      ];

      // Validate all provided keys before writing any.
      for (const key of validKeys) {
        const val = body[key];
        if (val === undefined) continue;
        if (typeof val !== "number" || !Number.isFinite(val) || val < 0) {
          return reply.code(400).send({
            error: `Invalid value for ${key}: must be a non-negative number`
          });
        }
      }

      // Apply updates.
      for (const key of validKeys) {
        const val = body[key];
        if (val === undefined) continue;
        await appSettingsService.setOvermindCooldown(key, val);
      }

      const updated = appSettingsService.get();
      return { overmind: updated };
    }
  );
}
