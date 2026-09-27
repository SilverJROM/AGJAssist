import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApiServer, type ApiServices } from "../../src/api/server.js";
import { AppConfig } from "../../src/config/config.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OWNER = "a5-owner-token";

// Literal the synthetic fleet does not produce. A direct SyntheticTelemetry read cannot match it.
const gate = vi.hoisted(() => ({
  generateCalls: 0,
  forMachineCalls: [] as string[],
  machine: {
    name: "spy-only",
    state: "synthetic" as const,
    cpuTemp: 7,
    gpuTemp: 8,
    powerWatts: 9,
    uptime: "spy-uptime",
    provenance: "collector-spy",
    sampleAge: "spy-age",
  },
}));

vi.mock("../../src/services/xmachines/readonly-collector.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/services/xmachines/readonly-collector.js")>();
  class SpiedReadOnlyCollector extends actual.ReadOnlyCollector {
    override generate() {
      gate.generateCalls += 1;
      return [{ ...gate.machine }];
    }

    override forMachine(name: string) {
      gate.forMachineCalls.push(name);
      if (name !== gate.machine.name) return undefined;
      return { ...gate.machine };
    }
  }
  return { ...actual, ReadOnlyCollector: SpiedReadOnlyCollector };
});

import { ReadOnlyCollector } from "../../src/services/xmachines/readonly-collector.js";
import { resolveXmachinesRuntime } from "../../src/services/xmachines/runtime.js";
import { sampleFleet } from "../../src/services/xmachines/sampler.js";

function walkTs(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkTs(full, out);
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

function rel(file: string): string {
  return path.relative(REPO, file).split(path.sep).join("/");
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
      webhookSecretToken: "s",
    },
    runtime: {
      workspaceRoot: "/tmp",
      allowedCommandPrefixes: [],
      maxToolIterations: 1,
      defaultTimeoutMinutes: 1,
    },
    api: {
      port: 0,
      host: "127.0.0.1",
      jwtSecret: "s",
      sessionExpiryHours: 24,
    },
    db: { path: ":memory:" },
    projects: { root: "/tmp" },
    tmux: { historyRetentionDays: 1, outputBufferLines: 100, streamIntervalMs: 100 },
    overmind: { token: "t" },
  };
}

function stubServices(): ApiServices {
  return {
    authService: {
      verifyToken: (token: string) =>
        token === OWNER ? { id: 1, role: "owner", username: "owner" } : null,
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

function ownerHeaders(): Record<string, string> {
  return {
    authorization: `Bearer ${OWNER}`,
    host: "localhost:3101",
  };
}

describe("xmachines-readonly-collector-core", () => {
  let app: FastifyInstance | undefined;
  let prevArm: string | undefined;

  beforeAll(async () => {
    prevArm = process.env.XMACHINES_ARM;
    process.env.XMACHINES_ARM = "0";
    app = await createApiServer(minimalConfig(), stubServices());
  });

  afterAll(async () => {
    await app?.close();
    if (prevArm === undefined) delete process.env.XMACHINES_ARM;
    else process.env.XMACHINES_ARM = prevArm;
  });

  beforeEach(() => {
    gate.generateCalls = 0;
    gate.forMachineCalls = [];
  });

  it("L5a mutation: runtime constructs ReadOnlyCollector and no second module constructs SyntheticTelemetry", () => {
    const runtimeSrc = fs.readFileSync(path.join(REPO, "src/services/xmachines/runtime.ts"), "utf8");
    const routesSrc = fs.readFileSync(path.join(REPO, "src/api/routes/xmachines-routes.ts"), "utf8");
    const samplerSrc = fs.readFileSync(path.join(REPO, "src/services/xmachines/sampler.ts"), "utf8");

    expect(runtimeSrc).toContain("import { ReadOnlyCollector } from './readonly-collector.js'");
    expect(runtimeSrc).toContain("telemetry: ReadOnlyCollector");
    expect(runtimeSrc).toContain("telemetry: new ReadOnlyCollector()");
    expect(runtimeSrc).not.toContain("SyntheticTelemetry");

    expect(routesSrc).toContain("runtime.telemetry.generate()");
    expect(routesSrc).toContain("runtime.telemetry.forMachine(");
    expect(routesSrc).not.toContain("SyntheticTelemetry");

    expect(samplerSrc).toContain("resolveXmachinesRuntime");
    expect(samplerSrc).toContain(".telemetry.generate(");
    expect(samplerSrc).not.toContain("SyntheticTelemetry");

    const constructors = walkTs(path.join(REPO, "src")).filter((file) =>
      /new\s+SyntheticTelemetry\s*\(/.test(fs.readFileSync(file, "utf8"))
    ).map(rel);
    expect(constructors).toEqual(["src/services/xmachines/readonly-collector.ts"]);

    const mentions = walkTs(path.join(REPO, "src")).filter((file) =>
      fs.readFileSync(file, "utf8").includes("SyntheticTelemetry")
    ).map(rel).sort();
    expect(mentions).toEqual([
      "src/services/xmachines/readonly-collector.ts",
      "src/services/xmachines/telemetry.ts",
    ]);
  });

  it("L5b runtime foreground generate is the collector spy fixture", () => {
    const runtime = resolveXmachinesRuntime({ XMACHINES_ARM: "0" });
    expect(runtime.armed).toBe(false);
    expect(runtime.telemetry).toBeInstanceOf(ReadOnlyCollector);
    expect(runtime.telemetry.generate()).toEqual([gate.machine]);
    expect(gate.generateCalls).toBe(1);
  });

  it("L5b GET /api/xmachines/telemetry returns the collector spy fixture", async () => {
    const res = await app!.inject({
      method: "GET",
      url: "/api/xmachines/telemetry",
      headers: ownerHeaders(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ mode: "fake", armed: false, machines: [gate.machine] });
    expect(gate.generateCalls).toBe(1);
  });

  it("L5d GET /api/xmachines/machines/:name returns the collector spy fixture", async () => {
    const res = await app!.inject({
      method: "GET",
      url: "/api/xmachines/machines/spy-only",
      headers: ownerHeaders(),
    });
    expect(res.statusCode).toBe(200);
    // Detail route also returns gpu/disk/ups panels; assert the spy fixture is surfaced as `machine`.
    expect(res.json()).toMatchObject({ mode: "fake", armed: false, machine: gate.machine });
    expect(gate.forMachineCalls).toEqual(["spy-only"]);
  });

  it("L5d a synthetic-fleet name is unknown when the collector does not return it", async () => {
    const res = await app!.inject({
      method: "GET",
      url: "/api/xmachines/machines/gpu",
      headers: ownerHeaders(),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ ok: false, actuated: false, error: "unknown-machine" });
    expect(gate.forMachineCalls).toEqual(["gpu"]);
  });

  it("L5c sampleFleet returns the collector spy fixture", () => {
    expect(sampleFleet({ XMACHINES_ARM: "0" })).toEqual([gate.machine]);
    expect(gate.generateCalls).toBe(1);
  });

  it("power known-machine check honours the collector, including a synthetic name it does not return", async () => {
    const res = await app!.inject({
      method: "POST",
      url: "/api/xmachines/machines/hdd/power/off",
      headers: ownerHeaders(),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ ok: false, actuated: false, error: "unknown-machine" });
    expect(gate.forMachineCalls).toEqual(["hdd"]);
  });
});
