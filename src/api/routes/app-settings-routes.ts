import { FastifyInstance } from "fastify";
import { AuthService } from "../../auth/auth-service.js";
import { createAuthMiddleware } from "../../auth/auth-middleware.js";
import { AppSettingsService, OvermindCooldowns } from "../../services/app-settings-service.js";

interface PatchOvermindBody {
  stuck_nudge_cooldown_minutes?: number;
  idle_nudge_cooldown_minutes?: number;
  evidence_read_cadence_minutes?: number;
  unified_idle_threshold_minutes?: number;
  evidence_idle_threshold_minutes?: number;
  // JROM v2.3 back-compat: dashboard clients may still send the old key on the
  // first request after a deploy. Accept it and treat it as the new field —
  // mergeDefaults() inside AppSettings handles the JSON-file side; the route
  // handler maps it here on the PATCH side.
  ask_update_cooldown_minutes?: number;
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
      if (body.idle_nudge_cooldown_minutes !== undefined && body.stuck_nudge_cooldown_minutes === undefined) {
        body.stuck_nudge_cooldown_minutes = body.idle_nudge_cooldown_minutes;
      }
      // Normalise deprecated `ask_update_cooldown_minutes` → new name.
      if (body.ask_update_cooldown_minutes !== undefined && body.unified_idle_threshold_minutes === undefined) {
        body.unified_idle_threshold_minutes = body.ask_update_cooldown_minutes;
      }
      if (body.evidence_idle_threshold_minutes !== undefined && body.unified_idle_threshold_minutes === undefined) {
        body.unified_idle_threshold_minutes = body.evidence_idle_threshold_minutes;
      }
      const validKeys: Array<keyof OvermindCooldowns> = [
        "stuck_nudge_cooldown_minutes",
        "evidence_read_cadence_minutes",
        "unified_idle_threshold_minutes"
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
