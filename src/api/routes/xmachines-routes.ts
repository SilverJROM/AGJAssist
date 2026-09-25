import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { callCarriesClientArm, resolveXmachinesRuntime } from "../../services/xmachines/runtime.js";
import { AuthService } from "../../auth/auth-service.js";
import { createAuthMiddleware, requireOwner } from "../../auth/auth-middleware.js";

const CLIENT_ARM_REJECTED = { ok: false, actuated: false, error: "client-arm-rejected" };

const CANONICAL_HOST = "agjasst.silverjrom.app";
const CANONICAL_ORIGIN = `https://${CANONICAL_HOST}`;
const LOCAL_TEST_HOSTS = new Set(["localhost:3101", "127.0.0.1:3101", "localhost", "127.0.0.1"]);
const LOCAL_TEST_ORIGINS = new Set(["http://localhost:3101", "http://127.0.0.1:3101"]);

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
  if (!host) return false;
  const [hostname, port] = host.split(":");
  if (hostname === CANONICAL_HOST) return true;
  if (LOCAL_TEST_HOSTS.has(host)) return true;
  return false;
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

async function power(
  request: FastifyRequest,
  reply: FastifyReply,
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
  const result = action === "off" ? await runtime.gateway.down(name) : await runtime.gateway.up(name);
  return reply.code(200).send({
    ok: true,
    actuated: result.actuated,
    mode: "armed",
    machine: name,
    action,
  });
}

export function registerXmachinesRoutes(app: FastifyInstance, authService?: AuthService): void {
  const authMiddleware = authService ? createAuthMiddleware(authService) : async () => {};
  app.addHook("preHandler", async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.url?.startsWith("/api/xmachines")) {
      await authMiddleware(request, reply);
      if (request.sessionUser?.role !== "owner") {
        reply.code(403).send({ error: "Owner role required" });
        return;
      }
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
    { config: { rateLimit: { max: 10, timeWindow: "1 minute", keyGenerator: (req: FastifyRequest) => `${req.sessionUser?.id ?? "anon"}:off` } } },
    async (request, reply) => power(request, reply, request.params.name, "off")
  );

  app.post<{ Params: { name: string } }>(
    "/api/xmachines/machines/:name/power/on",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute", keyGenerator: (req: FastifyRequest) => `${req.sessionUser?.id ?? "anon"}:on` } } },
    async (request, reply) => power(request, reply, request.params.name, "on")
  );
}
