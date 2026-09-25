import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApiServer, type ApiServices } from "../../src/api/server.js";
import { AppConfig } from "../../src/config/config.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SPY = path.join(REPO, "tests/helpers/xmac-argv-spy.sh");

const SYNTHETIC_FLEET = [
  { name: "gpu", state: "synthetic", cpuTemp: 41, gpuTemp: 52, powerWatts: 120, uptime: "synthetic", provenance: "fake", sampleAge: "0s", roleHint: "" },
  { name: "hdd", state: "synthetic", cpuTemp: 36, gpuTemp: 33, powerWatts: 90, uptime: "synthetic", provenance: "fake", sampleAge: "0s", roleHint: "" },
  { name: "gpu2", state: "synthetic", cpuTemp: 44, gpuTemp: 61, powerWatts: 200, uptime: "synthetic", provenance: "fake", sampleAge: "0s", roleHint: "" },
  { name: "media", state: "synthetic", cpuTemp: 47, gpuTemp: 70, powerWatts: 250, uptime: "synthetic", provenance: "fake", sampleAge: "0s", roleHint: "" },
] as const;

const CLIENT_ARM_REJECTED = { ok: false, actuated: false, error: "client-arm-rejected" };
const MACHINES = ["gpu", "hdd", "gpu2", "media"] as const;
const LOCAL_OWNER = "a03-owner-token";

function localHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    authorization: `Bearer ${LOCAL_OWNER}`,
    host: "localhost:3101",
    ...extra,
  };
}

function minimalConfig(): AppConfig {
  return {
    telegram: {
      botToken: "123:ABC",
      authorizedUserId: 1,
      authorizedChatIds: [1],
      testMode: true,
      updateMode: "polling",
      webhookUrl: null,
      webhookPath: "/api/telegram/webhook",
      webhookSecretToken: "s"
    },
    runtime: {
      workspaceRoot: "/tmp",
      allowedCommandPrefixes: [],
      maxToolIterations: 1,
      defaultTimeoutMinutes: 1
    },
    api: {
      port: 0,
      host: "127.0.0.1",
      jwtSecret: "s",
      sessionExpiryHours: 24
    },
    db: { path: ":memory:" },
    projects: { root: "/tmp" },
    tmux: { historyRetentionDays: 1, outputBufferLines: 100, streamIntervalMs: 100 },
    overmind: { token: "t" }
  };
}

function stubServices(): ApiServices {
  return {
    authService: {
      verifyToken: (token: string) =>
        token === LOCAL_OWNER ? { id: 1, role: "owner", username: "owner" } : null,
    } as ApiServices["authService"],
    projectService: {} as ApiServices["projectService"],
    safetyService: {} as ApiServices["safetyService"],
    auditService: {} as ApiServices["auditService"],
    tmuxService: {} as ApiServices["tmuxService"],
    tmuxStreamManager: {} as ApiServices["tmuxStreamManager"],
    db: {} as ApiServices["db"],
    delegationService: {} as ApiServices["delegationService"],
    noteService: {} as ApiServices["noteService"],
    planService: {} as ApiServices["planService"],
    taskService: {} as ApiServices["taskService"],
    fileService: {} as ApiServices["fileService"],
    stepTemplateService: {} as ApiServices["stepTemplateService"],
    personalTaskService: {} as ApiServices["personalTaskService"],
    reminderService: {} as ApiServices["reminderService"],
    agentAssignmentService: {} as ApiServices["agentAssignmentService"],
  };
}

function unarmedPower(machine: string, action: "on" | "off") {
  return { ok: false, actuated: false, mode: "fake", reason: "unarmed", machine, action };
}

function readSpy(spyLog: string): string {
  if (!fs.existsSync(spyLog)) return "";
  return fs.readFileSync(spyLog, "utf8");
}

function spyArgv(spyLog: string): string[][] {
  return readSpy(spyLog)
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => line.split("\t").slice(1));
}

describe("xmachines actuation isolation A0.3", () => {
  let app: FastifyInstance | undefined;
  let scratch: string | undefined;
  let prev: NodeJS.ProcessEnv;

  afterEach(async () => {
    await app?.close();
    app = undefined;
    if (prev) {
      process.env.PATH = prev.PATH;
      restoreEnv("XMAC_ARGV_SPY_LOG", prev.XMAC_ARGV_SPY_LOG);
      restoreEnv("XMAC_ARGV_SPY_REAL", prev.XMAC_ARGV_SPY_REAL);
      restoreEnv("XMACHINES_ARM", prev.XMACHINES_ARM);
    }
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
    scratch = undefined;
  });

  async function boot(arm: boolean): Promise<{ spyLog: string }> {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "a03-act-"));
    const bin = path.join(scratch, "bin");
    fs.mkdirSync(bin);
    fs.symlinkSync(SPY, path.join(bin, "xmac.sh"));
    const spyLog = path.join(scratch, "spy.log");
    prev = {
      PATH: process.env.PATH,
      XMAC_ARGV_SPY_LOG: process.env.XMAC_ARGV_SPY_LOG,
      XMAC_ARGV_SPY_REAL: process.env.XMAC_ARGV_SPY_REAL,
      XMACHINES_ARM: process.env.XMACHINES_ARM,
    };
    process.env.PATH = `${bin}${path.delimiter}${process.env.PATH ?? ""}`;
    process.env.XMAC_ARGV_SPY_LOG = spyLog;
    delete process.env.XMAC_ARGV_SPY_REAL;
    if (arm) process.env.XMACHINES_ARM = "1";
    else delete process.env.XMACHINES_ARM;
    app = await createApiServer(minimalConfig(), stubServices());
    return { spyLog };
  }

  it("L10a: local and test mode default to synthetic telemetry", async () => {
    const { spyLog } = await boot(false);
    const res = await app!.inject({ method: "GET", url: "/api/xmachines/telemetry", headers: localHeaders() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ mode: "fake", armed: false, machines: SYNTHETIC_FLEET });
    expect(spyArgv(spyLog)).toEqual([]);
  });

  it("L10b: real control is impossible without explicit server-side arm state", async () => {
    const { spyLog } = await boot(false);
    const res = await app!.inject({ method: "POST", url: "/api/xmachines/machines/gpu/power/off", headers: localHeaders() });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual(unarmedPower("gpu", "off"));
    expect(spyArgv(spyLog)).toEqual([]);
  });

  it("L10b: server process XMACHINES_ARM=1 is what constructs the real gateway", async () => {
    const { spyLog } = await boot(true);
    const res = await app!.inject({
      method: "POST",
      url: "/api/xmachines/machines/gpu/power/off",
      headers: localHeaders({ "idempotency-key": "a03-armed-off" }),
    });
    expect(res.statusCode).toBe(202);
    const body = res.json() as { status?: string; operationId?: string };
    expect(body.status).toBe("in-progress");
    expect(typeof body.operationId).toBe("string");
    expect(body.operationId!.length).toBeGreaterThan(0);
    const deadline = Date.now() + 2000;
    let argv = spyArgv(spyLog);
    while (argv.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      argv = spyArgv(spyLog);
    }
    expect(argv).toEqual([["down", "gpu"]]);
  });

  it("L10c: local read and power attempts produce zero real-fleet calls", async () => {
    const { spyLog } = await boot(false);
    const telemetry = await app!.inject({ method: "GET", url: "/api/xmachines/telemetry", headers: localHeaders() });
    const read = await app!.inject({ method: "GET", url: "/api/xmachines/machines/hdd", headers: localHeaders() });
    const off = await app!.inject({ method: "POST", url: "/api/xmachines/machines/gpu/power/off", headers: localHeaders() });
    const on = await app!.inject({ method: "POST", url: "/api/xmachines/machines/media/power/on", headers: localHeaders() });
    expect(telemetry.statusCode).toBe(200);
    expect(telemetry.json()).toEqual({ mode: "fake", armed: false, machines: SYNTHETIC_FLEET });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual({ mode: "fake", armed: false, machine: SYNTHETIC_FLEET[1] });
    expect(off.statusCode).toBe(403);
    expect(off.json()).toEqual(unarmedPower("gpu", "off"));
    expect(on.statusCode).toBe(403);
    expect(on.json()).toEqual(unarmedPower("media", "on"));
    expect(readSpy(spyLog)).toBe("");
  });

  it("K1c: local power requests cannot actuate a real machine", async () => {
    const { spyLog } = await boot(false);
    for (const machine of MACHINES) {
      const off = await app!.inject({ method: "POST", url: `/api/xmachines/machines/${machine}/power/off`, headers: localHeaders() });
      const on = await app!.inject({ method: "POST", url: `/api/xmachines/machines/${machine}/power/on`, headers: localHeaders() });
      expect(off.statusCode).toBe(403);
      expect(off.json()).toEqual(unarmedPower(machine, "off"));
      expect(on.statusCode).toBe(403);
      expect(on.json()).toEqual(unarmedPower(machine, "on"));
    }
    expect(spyArgv(spyLog)).toEqual([]);
  });

  it("negative: a client-supplied XMACHINES_ARM does not arm or reach xmac.sh", async () => {
    const { spyLog } = await boot(false);
    const header = await app!.inject({
      method: "POST",
      url: "/api/xmachines/machines/gpu/power/off",
      headers: localHeaders({ XMACHINES_ARM: "1" }),
    });
    const query = await app!.inject({
      method: "POST",
      url: "/api/xmachines/machines/gpu/power/off?XMACHINES_ARM=1",
      headers: localHeaders(),
    });
    const body = await app!.inject({
      method: "POST",
      url: "/api/xmachines/machines/gpu/power/on",
      headers: localHeaders({ "content-type": "application/json" }),
      payload: { XMACHINES_ARM: "1" },
    });
    expect(header.statusCode).toBe(400);
    expect(header.json()).toEqual(CLIENT_ARM_REJECTED);
    expect(query.statusCode).toBe(400);
    expect(query.json()).toEqual(CLIENT_ARM_REJECTED);
    expect(body.statusCode).toBe(400);
    expect(body.json()).toEqual(CLIENT_ARM_REJECTED);
    expect(readSpy(spyLog)).toBe("");
  });
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
