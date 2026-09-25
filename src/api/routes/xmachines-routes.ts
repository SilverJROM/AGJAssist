import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { callCarriesClientArm, resolveXmachinesRuntime } from "../../services/xmachines/runtime.js";
import { ActionCoordinator } from "../../services/xmachines/action-coordinator.js";
import { AuthService } from "../../auth/auth-service.js";
import { createAuthMiddleware } from "../../auth/auth-middleware.js";

const CLIENT_ARM_REJECTED = { ok: false, actuated: false, error: "client-arm-rejected" };

const CANONICAL_HOST = "agjasst.silverjrom.app";
const CANONICAL_ORIGIN = `https://${CANONICAL_HOST}`;
// Complete lowercased host[:port]. The canonical name is listed only without a port.
const ALLOWED_HOSTS = new Set([
  CANONICAL_HOST,
  "localhost:3101",
  "127.0.0.1:3101",
  "localhost",
  "127.0.0.1",
]);
const LOCAL_TEST_ORIGINS = new Set(["http://localhost:3101", "http://127.0.0.1:3101"]);
const POWER_LIMIT = { max: 10, timeWindow: "1 minute" };

function clientArm(request: FastifyRequest): boolean {
  return callCarriesClientArm({
    query: request.query,
    body: request.body,
    headers: request.headers as Record<string, unknown>,
  });
}

function hostFromRequest(request: FastifyRequest): string {
  const fh = (request.headers["x-forwarded-host"] as string)?.split(",")[0]?.trim().toLowerCase();
  if (fh) return fh;
  const h = (request.headers.host as string)?.toLowerCase();
  return h ?? "";
}

function originFromRequest(request: FastifyRequest): string {
  const o = (request.headers.origin as string)?.toLowerCase();
  return o ?? "";
}

function isHostAllowed(host: string): boolean {
  return ALLOWED_HOSTS.has(host);
}

function powerAction(url: string): "on" | "off" | null {
  const pathOnly = url.split("?")[0] ?? "";
  if (pathOnly.endsWith("/power/off")) return "off";
  if (pathOnly.endsWith("/power/on")) return "on";
  return null;
}

function ownerKey(request: FastifyRequest): string {
  const id = request.sessionUser?.id;
  return id === undefined || id === null ? "anon" : String(id);
}

function headerValue(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" ? raw.trim() : "";
}

function idempotencyKeyFromRequest(request: FastifyRequest): string {
  const primary = headerValue(request.headers["idempotency-key"]);
  if (primary) return primary;
  return headerValue(request.headers["x-idempotency-key"]);
}

function limitExceeded(result: { isAllowed: boolean; isExceeded?: boolean }): boolean {
  return result.isAllowed === false && result.isExceeded === true;
}

function isOriginAllowed(origin: string): boolean {
  if (!origin) return false;
  if (origin === CANONICAL_ORIGIN) return true;
  if (LOCAL_TEST_ORIGINS.has(origin)) return true;
  return false;
}

function requireCanonicalHost(request: FastifyRequest, reply: FastifyReply): boolean {
  const host = hostFromRequest(request);
  if (!isHostAllowed(host)) {
    reply.code(403).send({ error: "host_not_allowed" });
    return false;
  }
  return true;
}

function requireCanonicalOrigin(request: FastifyRequest, reply: FastifyReply): boolean {
  const origin = originFromRequest(request);
  if (origin && !isOriginAllowed(origin)) {
    reply.code(403).send({ error: "origin_not_allowed" });
    return false;
  }
  return true;
}

function power(
  request: FastifyRequest,
  reply: FastifyReply,
  coordinator: ActionCoordinator,
  name: string,
  action: "on" | "off"
) {
  if (clientArm(request)) {
    return reply.code(400).send(CLIENT_ARM_REJECTED);
  }
  if (!requireCanonicalHost(request, reply)) return;
  if (!requireCanonicalOrigin(request, reply)) return;
  const runtime = resolveXmachinesRuntime(process.env);
  const known = runtime.telemetry.forMachine(name);
  if (!known) {
    return reply.code(404).send({ ok: false, actuated: false, error: "unknown-machine" });
  }
  if (!runtime.armed) {
    return reply.code(403).send({
      ok: false,
      actuated: false,
      mode: "fake",
      reason: "unarmed",
      machine: name,
      action,
    });
  }
  const result = coordinator.handle({
    machine: name,
    action,
    idempotencyKey: idempotencyKeyFromRequest(request),
    ownerId: ownerKey(request),
  });
  const code = result.status === "in-progress" ? 202 : 400;
  return reply.code(code).send(result);
}

export function registerXmachinesRoutes(app: FastifyInstance, authService?: AuthService): void {
  const coordinator = new ActionCoordinator();
  const authMiddleware = authService ? createAuthMiddleware(authService) : async () => {};
  const perActionLimit = {
    off: app.createRateLimit({
      ...POWER_LIMIT,
      keyGenerator: (req) => `${ownerKey(req)}:off`,
    }),
    on: app.createRateLimit({
      ...POWER_LIMIT,
      keyGenerator: (req) => `${ownerKey(req)}:on`,
    }),
  };
  const allPowerLimit = app.createRateLimit({
    ...POWER_LIMIT,
    keyGenerator: (req) => `${ownerKey(req)}:all-power`,
  });

  app.addHook("preHandler", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.url?.startsWith("/api/xmachines")) return;
    await authMiddleware(request, reply);
    if (reply.sent) return;
    if (!request.sessionUser) return;
    if (request.sessionUser.role !== "owner") {
      reply.code(403).send({ error: "Owner role required" });
      return;
    }
    if (request.method !== "POST") return;
    const action = powerAction(request.url);
    if (!action) return;
    const perAction = await perActionLimit[action](request);
    const allPower = await allPowerLimit(request);
    if (limitExceeded(perAction) || limitExceeded(allPower)) {
      const err = new Error("rate_limited") as Error & { statusCode: number };
      err.statusCode = 429;
      throw err;
    }
  });

  app.get("/api/xmachines/telemetry", async (request, reply) => {
    if (clientArm(request)) {
      return reply.code(400).send(CLIENT_ARM_REJECTED);
    }
    if (!requireCanonicalHost(request, reply)) return;
    if (!requireCanonicalOrigin(request, reply)) return;
    const runtime = resolveXmachinesRuntime(process.env);
    return {
      mode: runtime.armed ? "armed" : "fake",
      armed: runtime.armed,
      machines: runtime.telemetry.generate(),
    };
  });

  app.get<{ Params: { name: string } }>("/api/xmachines/machines/:name", async (request, reply) => {
    if (clientArm(request)) {
      return reply.code(400).send(CLIENT_ARM_REJECTED);
    }
    if (!requireCanonicalHost(request, reply)) return;
    if (!requireCanonicalOrigin(request, reply)) return;
    const runtime = resolveXmachinesRuntime(process.env);
    const machine = runtime.telemetry.forMachine(request.params.name);
    if (!machine) {
      return reply.code(404).send({ ok: false, actuated: false, error: "unknown-machine" });
    }
    return {
      mode: runtime.armed ? "armed" : "fake",
      armed: runtime.armed,
      machine,
    };
  });

  app.post<{ Params: { name: string } }>(
    "/api/xmachines/machines/:name/power/off",
    async (request, reply) => power(request, reply, coordinator, request.params.name, "off")
  );

  app.post<{ Params: { name: string } }>(
    "/api/xmachines/machines/:name/power/on",
    async (request, reply) => power(request, reply, coordinator, request.params.name, "on")
  );
}
