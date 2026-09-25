import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { callCarriesClientArm, resolveXmachinesRuntime } from "../../services/xmachines/runtime.js";

const CLIENT_ARM_REJECTED = { ok: false, actuated: false, error: "client-arm-rejected" };

function clientArm(request: FastifyRequest): boolean {
  return callCarriesClientArm({
    query: request.query,
    body: request.body,
    headers: request.headers as Record<string, unknown>,
  });
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

export function registerXmachinesRoutes(app: FastifyInstance): void {
  app.get("/api/xmachines/telemetry", async (request, reply) => {
    if (clientArm(request)) {
      return reply.code(400).send(CLIENT_ARM_REJECTED);
    }
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
    async (request, reply) => power(request, reply, request.params.name, "off")
  );

  app.post<{ Params: { name: string } }>(
    "/api/xmachines/machines/:name/power/on",
    async (request, reply) => power(request, reply, request.params.name, "on")
  );
}
