import { randomUUID } from "node:crypto";
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { callCarriesClientArm, resolveXmachinesRuntime } from "../../services/xmachines/runtime.js";
import { ActionCoordinator } from "../../services/xmachines/action-coordinator.js";
import { AuthService } from "../../auth/auth-service.js";
import { createAuthMiddleware } from "../../auth/auth-middleware.js";
import type { AuditService } from "../../services/audit-service.js";
import type BetterSqlite from "better-sqlite3";
import type { DatabaseService } from "../../db/database.js";
import { loadMachineEnergyCost, type CostWindow, type MachineCost } from "../../services/xmachines/cost.js";
import { ForceChallengeService } from "../../services/xmachines/force-challenge.js";
import {
  presentWolSafety,
  readWolSafety,
  WOL_UNVERIFIED_WARNING,
  type WolSafetyEvidence,
} from "../../services/xmachines/uptime.js";

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

type AttemptClassification = "on" | "off" | "force" | "denied" | "replayed" | "rate-limited";

function machineFromRequest(request: FastifyRequest): string {
  const pathOnly = request.url.split("?")[0] ?? "";
  const match = pathOnly.match(/\/machines\/([^/]+)\/power\/(?:on|off)$/);
  if (!match?.[1]) return "";
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function bearerToken(request: FastifyRequest): string {
  const header = headerValue(request.headers.authorization);
  const prefix = "bearer ";
  return header.toLowerCase().startsWith(prefix) ? header.slice(prefix.length).trim() : "";
}

function authorizationOf(request: FastifyRequest): { ok: boolean; role: string } {
  const role = request.sessionUser?.role ?? "";
  return { ok: role === "owner", role };
}

function observedPreState(machine: string): string {
  if (!machine) return "";
  return resolveXmachinesRuntime(process.env).telemetry.forMachine(machine)?.state ?? "";
}

function forceReasonFromBody(request: FastifyRequest): string | null {
  const body = request.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  if (record.force !== true) return null;
  return typeof record.force_reason === "string" ? record.force_reason : "";
}

function recordPowerAttempt(
  audit: AuditService | undefined,
  request: FastifyRequest,
  fields: {
    machine: string;
    action: "on" | "off";
    classification: AttemptClassification;
    forceReason: string;
    guards: Record<string, { ok: boolean; detail?: string }>;
    preState: string;
    finalState: string;
  }
): void {
  if (!audit || typeof audit.log !== "function") return;
  const user = request.sessionUser;
  const now = new Date().toISOString();
  audit.log({
    userId: user?.id ?? null,
    agentName: user?.username ?? null,
    actionType: "xmachines_power",
    resourceType: "xmachines",
    resourceId: fields.machine ? `${fields.machine}/${fields.action}` : fields.action,
    surface: "web",
    details: {
      request: {
        machine: fields.machine,
        action: fields.action,
        idempotencyKey: idempotencyKeyFromRequest(request),
      },
      authorization: authorizationOf(request),
      pre_state: fields.preState,
      guards: fields.guards,
      force_reason: fields.forceReason,
      target: fields.machine,
      action: fields.action,
      gateway_status: 0,
      final_state: fields.finalState,
      actor_id: user?.id === undefined || user?.id === null ? "" : String(user.id),
      session_id: bearerToken(request),
      request_id: headerValue(request.headers["x-request-id"]) || randomUUID(),
      request_source: "api",
      timestamps: { requestedAt: now, completedAt: now },
      classification: fields.classification,
    },
  });
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

function wolConfirmFromBody(request: FastifyRequest): { challengeId: string; selectedNumber: number } | null {
  const body = request.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  if (typeof record.challengeId !== "string" || record.challengeId.trim() === "") return null;
  if (typeof record.selectedNumber !== "number" || !Number.isInteger(record.selectedNumber)) return null;
  return { challengeId: record.challengeId.trim(), selectedNumber: record.selectedNumber };
}

function wolConfirmationCopy(machine: string, evidence: WolSafetyEvidence): string {
  const view = presentWolSafety(evidence);
  return [`Force confirmation for ${machine} off`, view.warning ?? WOL_UNVERIFIED_WARNING, `status=${evidence.status}`].join("\n");
}

function power(
  request: FastifyRequest,
  reply: FastifyReply,
  coordinator: ActionCoordinator,
  audit: AuditService | undefined,
  name: string,
  action: "on" | "off",
  wolForceChallenges: ForceChallengeService,
) {
  const auditAttempt = (
    classification: AttemptClassification,
    guards: Record<string, { ok: boolean; detail?: string }>,
    extra?: { forceReason?: string; preState?: string; finalState?: string }
  ) => {
    const preState = extra?.preState ?? "";
    recordPowerAttempt(audit, request, {
      machine: name,
      action,
      classification,
      forceReason: extra?.forceReason ?? "",
      guards,
      preState,
      finalState: extra?.finalState ?? preState,
    });
  };
  if (clientArm(request)) {
    auditAttempt("denied", { client_arm: { ok: false } });
    return reply.code(400).send(CLIENT_ARM_REJECTED);
  }
  if (!requireCanonicalHost(request, reply)) {
    auditAttempt("denied", { host: { ok: false, detail: "host_not_allowed" } });
    return;
  }
  if (!requireCanonicalOrigin(request, reply)) {
    auditAttempt("denied", { origin: { ok: false, detail: "origin_not_allowed" } });
    return;
  }
  const runtime = resolveXmachinesRuntime(process.env);
  const known = runtime.telemetry.forMachine(name);
  if (!known) {
    auditAttempt("denied", { machine: { ok: false, detail: "unknown-machine" } });
    return reply.code(404).send({ ok: false, actuated: false, error: "unknown-machine" });
  }
  const observed = known.state;
  if (!runtime.armed) {
    auditAttempt("denied", { armed: { ok: false, detail: "unarmed" } }, { preState: observed, finalState: observed });
    return reply.code(403).send({
      ok: false,
      actuated: false,
      mode: "fake",
      reason: "unarmed",
      machine: name,
      action,
    });
  }
  // Force confirmation is a later route. Record the attempt and do not emit --force.
  if (action === "off") {
    const forceReason = forceReasonFromBody(request);
    if (forceReason !== null) {
      auditAttempt(
        "force",
        { force_confirmation: { ok: false, detail: "force-confirmation-required" } },
        { forceReason, preState: observed, finalState: "" }
      );
      return reply.code(400).send({ status: "rejected", reason: "force-confirmation-required" });
    }
    const evidence = readWolSafety(name);
    if (evidence && evidence.status !== "verified") {
      const sessionId = bearerToken(request) || `owner:${ownerKey(request)}`;
      const ownerId = typeof request.sessionUser?.id === "number" ? request.sessionUser.id : 0;
      const confirm = wolConfirmFromBody(request);
      if (!confirm) {
        const started = wolForceChallenges.startChallenge(ownerId, sessionId, name, "off");
        auditAttempt(
          "force",
          {
            force_confirmation: { ok: false, detail: "force-confirmation-required" },
            wol_safety: { ok: false, detail: evidence.status },
          },
          { preState: observed, finalState: "" },
        );
        return reply.code(400).send({
          status: "rejected",
          reason: "force-confirmation-required",
          confirmation: wolConfirmationCopy(name, evidence),
          challengeId: started.id,
          displayNumber: started.displayNumber,
        });
      }
      const confirmed = wolForceChallenges.confirmChallenge(
        confirm.challengeId,
        sessionId,
        name,
        "off",
        confirm.selectedNumber,
      );
      if (!confirmed.ok) {
        auditAttempt(
          "force",
          { force_confirmation: { ok: false, detail: confirmed.reason ?? "force-confirmation-required" } },
          { preState: observed, finalState: "" },
        );
        return reply.code(400).send({
          status: "rejected",
          reason: "force-confirmation-required",
          confirmation: wolConfirmationCopy(name, evidence),
        });
      }
    }
  }
  const sessionId = bearerToken(request);
  const { replayed, ...result } = coordinator.handle({
    machine: name,
    action,
    idempotencyKey: idempotencyKeyFromRequest(request),
    ownerId: ownerKey(request),
    sessionId,
  });
  const classification: AttemptClassification = replayed
    ? "replayed"
    : result.status === "rejected"
      ? "denied"
      : action;
  const guards: Record<string, { ok: boolean; detail?: string }> = {};
  if (replayed) {
    guards.idempotency = { ok: true, detail: "replayed" };
  } else if (result.reason) {
    guards[result.reason] = { ok: false, detail: result.detail };
  } else {
    guards.accepted = { ok: true };
  }
  auditAttempt(classification, guards, {
    preState: observed,
    finalState: result.status === "in-progress" ? "" : observed,
  });
  const code = result.status === "in-progress" ? 202 : 400;
  return reply.code(code).send(result);
}

function queryString(value: unknown): string {
  if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : "";
  return typeof value === "string" ? value : "";
}

function costWindowFromQuery(query: unknown): CostWindow | undefined {
  if (!query || typeof query !== "object") return undefined;
  const record = query as Record<string, unknown>;
  const from = queryString(record.from);
  const to = queryString(record.to);
  if (!from || !to) return undefined;
  return { from, to };
}

function metricDatabase(db: DatabaseService | undefined): BetterSqlite.Database | null {
  if (!db || typeof db !== "object") return null;
  try {
    const raw = db.raw;
    if (!raw || typeof raw.prepare !== "function") return null;
    return raw;
  } catch {
    return null;
  }
}

function detailCost(
  db: DatabaseService | undefined,
  machine: string,
  query: unknown
): MachineCost | undefined {
  const sqlite = metricDatabase(db);
  if (!sqlite) return undefined;
  try {
    return loadMachineEnergyCost(sqlite, machine, costWindowFromQuery(query));
  } catch {
    return undefined;
  }
}

export function registerXmachinesRoutes(
  app: FastifyInstance,
  authService?: AuthService,
  auditService?: AuditService,
  db?: DatabaseService
): void {
  const coordinator = new ActionCoordinator();
  const wolForceChallenges = new ForceChallengeService();
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
    if (reply.sent) {
      const action = request.method === "POST" ? powerAction(request.url) : null;
      if (action) {
        const machine = machineFromRequest(request);
        const preState = observedPreState(machine);
        recordPowerAttempt(auditService, request, {
          machine,
          action,
          classification: "denied",
          forceReason: "",
          guards: { authorization: { ok: false, detail: "unauthenticated" } },
          preState,
          finalState: preState,
        });
      }
      return;
    }
    if (!request.sessionUser) return;
    if (request.sessionUser.role !== "owner") {
      const action = request.method === "POST" ? powerAction(request.url) : null;
      if (action) {
        const machine = machineFromRequest(request);
        const preState = observedPreState(machine);
        recordPowerAttempt(auditService, request, {
          machine,
          action,
          classification: "denied",
          forceReason: "",
          guards: { authorization: { ok: false, detail: "owner-role-required" } },
          preState,
          finalState: preState,
        });
      }
      reply.code(403).send({ error: "Owner role required" });
      return;
    }
    if (request.method !== "POST") return;
    const action = powerAction(request.url);
    if (!action) return;
    const perAction = await perActionLimit[action](request);
    const allPower = await allPowerLimit(request);
    if (limitExceeded(perAction) || limitExceeded(allPower)) {
      const machine = machineFromRequest(request);
      const preState = observedPreState(machine);
      recordPowerAttempt(auditService, request, {
        machine,
        action,
        classification: "rate-limited",
        forceReason: "",
        guards: { rate_limit: { ok: false } },
        preState,
        finalState: preState,
      });
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
    const cost = detailCost(db, request.params.name, request.query);
    const evidence = readWolSafety(request.params.name);
    const wolSafety = evidence ? presentWolSafety(evidence) : null;
    return {
      mode: runtime.armed ? "armed" : "fake",
      armed: runtime.armed,
      machine,
      ...(wolSafety ? { wolSafety } : {}),
      ...(cost ? { cost } : {}),
    };
  });

  app.get<{ Params: { name: string }; Querystring: { metric?: string; from?: string; to?: string } }>("/api/xmachines/machines/:name/history", async (request, reply) => {
    if (clientArm(request)) {
      return reply.code(400).send(CLIENT_ARM_REJECTED);
    }
    if (!requireCanonicalHost(request, reply)) return;
    if (!requireCanonicalOrigin(request, reply)) return;

    const sqlite = metricDatabase(db);
    if (!sqlite) {
      return reply.code(500).send({ error: "database_unavailable" });
    }

    const name = request.params.name;
    const metric = (request.query.metric ?? "").toString().toLowerCase();
    const from = (request.query.from ?? "").toString();
    const to = (request.query.to ?? "").toString();

    if (!["temperature", "power", "utilization"].includes(metric)) {
      return reply.code(400).send({ error: "invalid_metric" });
    }

    const column = metric === "temperature" ? "temperature" : metric === "power" ? "power_watts" : "utilization_gpu";

    const rows = from && to
      ? sqlite.prepare(`
          SELECT sample_time AS time, ${column} AS value
          FROM xm_samples
          WHERE machine_name = ? AND sample_time >= ? AND sample_time < ?
          ORDER BY sample_time ASC, id ASC
        `).all(name, from, to)
      : sqlite.prepare(`
          SELECT sample_time AS time, ${column} AS value
          FROM xm_samples
          WHERE machine_name = ?
          ORDER BY sample_time ASC, id ASC
        `).all(name);

    const series = rows.map((r: any) => ({
      time: r.time,
      value: r.value,
    }));

    return {
      machine: name,
      metric,
      series,
    };
  });

  app.post<{ Params: { name: string } }>(
    "/api/xmachines/machines/:name/power/off",
    async (request, reply) =>
      power(request, reply, coordinator, auditService, request.params.name, "off", wolForceChallenges)
  );

  app.post<{ Params: { name: string } }>(
    "/api/xmachines/machines/:name/power/on",
    async (request, reply) =>
      power(request, reply, coordinator, auditService, request.params.name, "on", wolForceChallenges)
  );
}
