import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { callCarriesClientArm, resolveXmachinesRuntime } from "../../services/xmachines/runtime.js";
import { ActionCoordinator } from "../../services/xmachines/action-coordinator.js";
import { AuthService } from "../../auth/auth-service.js";
import { createAuthMiddleware } from "../../auth/auth-middleware.js";
import type { AuditService } from "../../services/audit-service.js";
import type BetterSqlite from "better-sqlite3";
import type { DatabaseService } from "../../db/database.js";
import { loadMachineEnergyCost, type CostWindow, type MachineCost } from "../../services/xmachines/cost.js";
import {
  ForceChallengeService,
  type ForceProbeSnapshot,
  type StartChallengeResult,
} from "../../services/xmachines/force-challenge.js";
import { resolveProtectedRole } from "../../services/xmachines/protected-roles.js";
import { loadGpuTelemetryRows } from "../../services/xmachines/gpu-edge-states.js";
import { parseNutStatus, renderHddDiskPanel } from "../../services/xmachines/disk-telemetry.js";
import { getMachineLabels, setMachineLabel } from "../../db/xmachines-store.js";
import {
  ownerTelegramBaseOverridden,
  sendOwnerMessage,
} from "../../services/xmachines/alert-delivery.js";
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
  // Local review instance (XMACHINES_DEMO=1) is reached via arbitrary host/tunnel;
  // relax the guard there only. Never set in production, so prod stays strict.
  if (process.env.XMACHINES_DEMO === "1") return true;
  const host = hostFromRequest(request);
  if (!isHostAllowed(host)) {
    reply.code(403).send({ error: "host_not_allowed" });
    return false;
  }
  return true;
}

function requireCanonicalOrigin(request: FastifyRequest, reply: FastifyReply): boolean {
  if (process.env.XMACHINES_DEMO === "1") return true; // review instance only; never prod
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

const FORCE_NUMBER_MATCH_PROMPT = "Force off number-match: tap the number shown on your screen";

type OwnerTelegram = { botToken: string; authorizedUserId: number };

// Vitest must not POST the live Telegram API. An explicit API base is the capture fixture.
async function deliverForceNumberMatch(
  telegram: OwnerTelegram | undefined,
  machine: string,
  started: StartChallengeResult,
): Promise<void> {
  if (!telegram?.botToken || !Number.isFinite(telegram.authorizedUserId)) return;
  if (!ownerTelegramBaseOverridden(process.env) && (process.env.VITEST || process.env.VITEST_WORKER_ID)) return;
  const text = [FORCE_NUMBER_MATCH_PROMPT, machine, String(started.displayNumber)].join("\n");
  try {
    await sendOwnerMessage(
      {
        text,
        reply_markup: {
          inline_keyboard: [
            started.buttons.map((n) => ({
              text: String(n),
              callback_data: `xmacforce:${started.id}:${n}`,
            })),
          ],
        },
      },
      { telegram },
    );
  } catch {
    // A down owner chat must not hide the challenge the route already created.
  }
}

async function power(
  request: FastifyRequest,
  reply: FastifyReply,
  coordinator: ActionCoordinator,
  audit: AuditService | undefined,
  name: string,
  action: "on" | "off",
  wolForceChallenges: ForceChallengeService,
  telegram?: OwnerTelegram,
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
  // Force is a separate route; normal owner-off must never emit --force.
  // L15b: a missing key is rejected before any WoL challenge is created.
  if (action === "off") {
    const idempotencyKey = idempotencyKeyFromRequest(request);
    if (!idempotencyKey) {
      auditAttempt(
        "denied",
        { idempotency: { ok: false, detail: "idempotency-key-required" } },
        { preState: observed, finalState: observed },
      );
      return reply.code(400).send({ status: "rejected", reason: "idempotency-key-required" });
    }
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
        await deliverForceNumberMatch(telegram, name, started);
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

function readForceProbe(machine: string): Promise<ForceProbeSnapshot> {
  const file = process.env.XMACHINES_FORCE_PROBE_FIXTURE?.trim() ?? "";
  if (!file) return Promise.reject(new Error("force-probe-missing"));
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return Promise.reject(new Error("force-probe-missing"));
  }
  const record = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
  const nested = record[machine];
  const row = nested && typeof nested === "object" && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : record;
  const holders = Array.isArray(row.leaseHolders)
    ? row.leaseHolders.filter((item): item is string => typeof item === "string")
    : [];
  return Promise.resolve({
    processesText: typeof row.processesText === "string" ? row.processesText : "",
    leasesText: typeof row.leasesText === "string" ? row.leasesText : "",
    leaseHolders: holders,
  });
}

function spawnForceDown(machine: string, ownerId: string, sessionId: string): void {
  const child = spawn("xmac.sh", ["down", machine, "--force"], {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      XMAC_CALLER: `${ownerId}+${sessionId}`,
    },
  });
  child.once("error", () => undefined);
  child.unref();
}

async function powerForce(
  request: FastifyRequest,
  reply: FastifyReply,
  audit: AuditService | undefined,
  name: string,
  wolForceChallenges: ForceChallengeService,
) {
  const auditAttempt = (
    classification: AttemptClassification,
    guards: Record<string, { ok: boolean; detail?: string }>,
    extra?: { preState?: string; finalState?: string }
  ) => {
    const preState = extra?.preState ?? "";
    recordPowerAttempt(audit, request, {
      machine: name,
      action: "off",
      classification,
      forceReason: "",
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
    return reply.code(403).send({ ok: false, actuated: false, mode: "fake", reason: "unarmed", machine: name, action: "off" });
  }

  const idempotencyKey = idempotencyKeyFromRequest(request);
  if (!idempotencyKey) {
    auditAttempt("denied", { idempotency: { ok: false, detail: "idempotency-key-required" } }, { preState: observed, finalState: observed });
    return reply.code(400).send({ status: "rejected", reason: "idempotency-key-required" });
  }

  const sessionId = bearerToken(request) || `owner:${ownerKey(request)}`;
  const ownerIdNum = typeof request.sessionUser?.id === "number" ? request.sessionUser.id : NaN;
  if (!Number.isFinite(ownerIdNum)) {
    auditAttempt("denied", { authorization: { ok: false, detail: "owner-required" } }, { preState: observed, finalState: observed });
    return reply.code(403).send({ error: "Owner role required" });
  }

  const role = resolveProtectedRole(name);
  if (role) {
    auditAttempt("denied", { protected_role: { ok: false, detail: role.detail } }, { preState: observed, finalState: observed });
    return reply.code(400).send({ status: "rejected", reason: role.reason, role: role.role, detail: role.detail });
  }

  let confirmation = "";
  try {
    confirmation = await wolForceChallenges.buildConfirmationText(name, "force");
  } catch {
    auditAttempt("denied", { force_probe: { ok: false, detail: "force-probe-missing" } }, { preState: observed, finalState: observed });
    return reply.code(400).send({ status: "rejected", reason: "force-probe-missing" });
  }

  const confirm = wolConfirmFromBody(request);
  if (!confirm) {
    const started = wolForceChallenges.startChallenge(ownerIdNum, sessionId, name, "force");
    auditAttempt("force", { force_confirmation: { ok: false, detail: "challenge-issued" } }, { preState: observed, finalState: "" });
    return reply.code(200).send({
      status: "challenge",
      challengeId: started.id,
      displayNumber: started.displayNumber,
      confirmation,
      expiresAt: started.expiresAt,
    });
  }

  const confirmed = wolForceChallenges.confirmChallenge(
    confirm.challengeId,
    sessionId,
    name,
    "force",
    confirm.selectedNumber,
  );
  if (!confirmed.ok) {
    auditAttempt(
      "denied",
      { force_confirmation: { ok: false, detail: confirmed.reason ?? "force-confirmation-required" } },
      { preState: observed, finalState: observed },
    );
    return reply.code(400).send({
      status: "rejected",
      reason: confirmed.reason ?? "force-confirmation-required",
    });
  }

  spawnForceDown(name, String(ownerIdNum), sessionId);
  auditAttempt("force", { accepted: { ok: true }, force_probe: { ok: true } }, { preState: observed, finalState: "" });
  return reply.code(202).send({ status: "in-progress", confirmation });
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

// Fake/demo mode has no persisted samples for the synthetic fleet, so a local
// review instance would show empty charts. Synthesize a deterministic series
// (seeded by machine+metric+range) anchored on the machine's current synthetic
// value, so the charts + range tabs are reviewable. Only used when unarmed.
function synthesizeHistory(
  name: string,
  metric: string,
  range: string,
  machine: unknown
): Array<{ time: string; value: number }> {
  const hours = range === "24h" ? 24 : range === "6h" ? 6 : 1;
  const n = range === "24h" ? 48 : range === "6h" ? 36 : 30;
  const now = Date.now();
  const step = (hours * 3600_000) / (n - 1);
  const m = (machine ?? {}) as { gpuTemp?: unknown; powerWatts?: unknown };
  let base: number;
  let amp: number;
  if (metric === "temperature") {
    base = typeof m.gpuTemp === "number" ? m.gpuTemp : 62;
    amp = Math.max(4, base * 0.08) * (1 + hours / 24);
  } else if (metric === "power") {
    base = typeof m.powerWatts === "number" ? m.powerWatts : 160;
    amp = Math.max(30, base * 0.16) * (1 + hours / 24);
  } else {
    base = 55;
    amp = 30;
  }
  let seed = 0;
  for (const ch of `${name}:${metric}:${range}`) seed += ch.charCodeAt(0);
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const out: Array<{ time: string; value: number }> = [];
  for (let i = 0; i < n; i += 1) {
    const t = new Date(now - (n - 1 - i) * step).toISOString();
    const v = Math.max(0, Math.round(base + Math.sin(i / 3) * amp * 0.5 + (rand() - 0.5) * amp));
    out.push({ time: t, value: v });
  }
  if (out.length) out[out.length - 1].value = Math.round(base);
  return out;
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
  db?: DatabaseService,
  telegram?: OwnerTelegram,
): void {
  const coordinator = new ActionCoordinator();
  const wolForceChallenges = new ForceChallengeService((machine) => readForceProbe(machine));
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
    const machines = runtime.telemetry.generate();
    const sqlite = metricDatabase(db);
    if (sqlite) {
      try {
        const labels = getMachineLabels(sqlite);
        for (const m of machines as Array<{ name?: string; displayName?: string }>) {
          if (m && m.name && labels[m.name]) m.displayName = labels[m.name];
        }
      } catch {
        // labels are additive; never block the read
      }
    }
    return {
      mode: runtime.armed ? "armed" : "fake",
      armed: runtime.armed,
      machines,
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
    const nowIso = new Date().toISOString();
    const roleHint = (machine.roleHint ?? '') as string;
    // Live poll on read so a timeout or no-NVIDIA answer is visible. The
    // service needs the raw driver: DatabaseService.transaction drops the
    // row list that reconcileGpuIdentities passes in. Sampler markers remain
    // the fallback for machines nobody is viewing.
    const sqlite = metricDatabase(db);
    if (sqlite) {
      try {
        const labels = getMachineLabels(sqlite);
        const lbl = labels[request.params.name];
        if (lbl) (machine as { displayName?: string }).displayName = lbl;
      } catch {
        // labels are additive; never block the read
      }
    }
    const gpuSurface = sqlite
      ? loadGpuTelemetryRows(sqlite, { machine: request.params.name, roleHint, nowIso, refresh: true })
      : null;
    const gpuRows = gpuSurface ? gpuSurface.apiRows : [];
    const panel = renderHddDiskPanel(runtime.telemetry, request.params.name);
    const nut = runtime.telemetry.readNut(request.params.name);
    const parsed = parseNutStatus(nut.battery);
    const disks = panel.disks;
    const filesystems = panel.filesystems;
    const ups = {
      availability: nut.availability,
      freshness: nut.freshness,
      batteryChargePct: parsed.batteryChargePct,
      runtimeSeconds: parsed.runtimeSeconds,
      loadPct: parsed.loadPct,
      raw: nut.battery,
    };
    return {
      mode: runtime.armed ? "armed" : "fake",
      armed: runtime.armed,
      machine,
      gpuRows,
      gpuChip: gpuSurface ? gpuSurface.chip : '',
      gpuState: gpuSurface ? gpuSurface.state : '',
      disks,
      filesystems,
      ups,
      ...(wolSafety ? { wolSafety } : {}),
      ...(cost ? { cost } : {}),
    };
  });

  app.get<{ Params: { name: string }; Querystring: { metric?: string; from?: string; to?: string; range?: string } }>("/api/xmachines/machines/:name/history", async (request, reply) => {
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
    const range = (request.query.range ?? "").toString().toLowerCase();

    if (!["temperature", "power", "utilization"].includes(metric)) {
      return reply.code(400).send({ error: "invalid_metric" });
    }

    const column = metric === "temperature" ? "temperature" : metric === "power" ? "power_watts" : "utilization_gpu";

    // A relative range (1h|6h|24h) maps to a from/to window; explicit from/to override it.
    const rangeHours: Record<string, number> = { "1h": 1, "6h": 6, "24h": 24 };
    let effFrom = from;
    let effTo = to;
    if (!from && !to && rangeHours[range] != null) {
      const now = Date.now();
      effFrom = new Date(now - rangeHours[range] * 3600_000).toISOString();
      effTo = new Date(now + 1000).toISOString();
    }

    const rows = effFrom && effTo
      ? sqlite.prepare(`
          SELECT sample_time AS time, ${column} AS value
          FROM xm_samples
          WHERE machine_name = ? AND sample_time >= ? AND sample_time < ?
          ORDER BY sample_time ASC, id ASC
        `).all(name, effFrom, effTo)
      : sqlite.prepare(`
          SELECT sample_time AS time, ${column} AS value
          FROM xm_samples
          WHERE machine_name = ?
          ORDER BY sample_time ASC, id ASC
        `).all(name);

    let series = rows.map((r: any) => ({
      time: r.time,
      value: r.value,
    }));

    // Unarmed (fake/demo) mode has no persisted samples for the synthetic fleet;
    // synthesize a series so a local review instance renders working charts.
    const runtime = resolveXmachinesRuntime(process.env);
    if (!runtime.armed && series.length < 2) {
      series = synthesizeHistory(name, metric, rangeHours[range] != null ? range : "1h", runtime.telemetry.forMachine(name));
    }

    return {
      machine: name,
      metric,
      series,
    };
  });

  app.post<{ Params: { name: string } }>(
    "/api/xmachines/machines/:name/power/off",
    async (request, reply) =>
      power(request, reply, coordinator, auditService, request.params.name, "off", wolForceChallenges, telegram)
  );

  app.post<{ Params: { name: string } }>(
    "/api/xmachines/machines/:name/power/on",
    async (request, reply) =>
      power(request, reply, coordinator, auditService, request.params.name, "on", wolForceChallenges, telegram)
  );

  app.post<{ Params: { name: string } }>(
    "/api/xmachines/machines/:name/power/force",
    async (request, reply) =>
      powerForce(request, reply, auditService, request.params.name, wolForceChallenges)
  );

  // Owner-set friendly name. Owner role is enforced by the shared preHandler.
  // Additive metadata only — never changes the machine's identity (name = ssh host).
  app.post<{ Params: { name: string }; Body: { displayName?: unknown } }>(
    "/api/xmachines/machines/:name/label",
    async (request, reply) => {
      if (clientArm(request)) {
        return reply.code(400).send(CLIENT_ARM_REJECTED);
      }
      if (!requireCanonicalHost(request, reply)) return;
      if (!requireCanonicalOrigin(request, reply)) return;
      const runtime = resolveXmachinesRuntime(process.env);
      const machine = runtime.telemetry.forMachine(request.params.name);
      if (!machine) {
        return reply.code(404).send({ ok: false, error: "unknown-machine" });
      }
      const sqlite = metricDatabase(db);
      if (!sqlite) {
        return reply.code(500).send({ ok: false, error: "database_unavailable" });
      }
      const body = (request.body ?? {}) as { displayName?: unknown };
      const displayName = typeof body.displayName === "string" ? body.displayName.trim().slice(0, 64) : "";
      try {
        setMachineLabel(sqlite, request.params.name, displayName);
      } catch {
        return reply.code(500).send({ ok: false, error: "label_write_failed" });
      }
      return { ok: true, machine: request.params.name, displayName: displayName || null };
    }
  );

  app.get("/api/xmachines/audit", async (request, reply) => {
    if (clientArm(request)) {
      return reply.code(400).send(CLIENT_ARM_REJECTED);
    }
    if (!requireCanonicalHost(request, reply)) return;
    if (!requireCanonicalOrigin(request, reply)) return;
    if (!request.sessionUser || request.sessionUser.role !== "owner") {
      return reply.code(403).send({ error: "Owner role required" });
    }
    if (!auditService) {
      return reply.code(500).send({ error: "audit_unavailable" });
    }
    const query = request.query as Record<string, string>;
    const limit = query.limit ? Math.min(Number(query.limit), 500) : 100;
    const offset = query.offset ? Number(query.offset) : 0;
    const entries = auditService.query({
      actionType: "xmachines_power",
      limit,
      offset,
    });
    return { entries };
  });

  app.post("/api/xmachines/sessions/revoke-all", async (request, reply) => {
    if (clientArm(request)) {
      return reply.code(400).send(CLIENT_ARM_REJECTED);
    }
    if (!requireCanonicalHost(request, reply)) return;
    if (!requireCanonicalOrigin(request, reply)) return;
    if (!request.sessionUser || request.sessionUser.role !== "owner") {
      return reply.code(403).send({ error: "Owner role required" });
    }
    if (!authService) {
      return reply.code(500).send({ error: "auth_unavailable" });
    }
    const userId = request.sessionUser.id;
    const revoked = authService.revokeAllWebSessions(userId);
    return { revoked };
  });
}
