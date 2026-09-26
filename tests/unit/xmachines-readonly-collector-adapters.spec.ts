import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// Literals the synthetic fleet does not produce. A direct SyntheticTelemetry read cannot match them.
const SMART_SENTINEL = "SMART-SENTINEL-A14";
const NUT_SENTINEL = "NUT-BATTERY-77-SENTINEL";
const ALERT_HOST = "alert-spy-host";
const ALERT_TEMP = 99;
const PROBE_HOST = "192.0.2.14";

const gate = vi.hoisted(() => ({
  generateCalls: 0,
  useFixture: false,
  machine: {
    name: "alert-spy-host",
    state: "synthetic" as const,
    cpuTemp: 99,
    gpuTemp: 1,
    powerWatts: 1,
    uptime: "spy",
    provenance: "alert-collector-spy",
    sampleAge: "0s",
  },
}));

vi.mock("../../src/services/xmachines/readonly-collector.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/services/xmachines/readonly-collector.js")>();
  class SpiedReadOnlyCollector extends actual.ReadOnlyCollector {
    override generate() {
      gate.generateCalls += 1;
      if (gate.useFixture) return [{ ...gate.machine }];
      return super.generate();
    }
  }
  return { ...actual, ReadOnlyCollector: SpiedReadOnlyCollector };
});

import { resolveXmachinesRuntime } from "../../src/services/xmachines/runtime.js";
import { SyntheticTelemetry } from "../../src/services/xmachines/telemetry.js";
import type { NutReading, SmartReading } from "../../src/services/xmachines/readonly-collector.js";

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

function smartRouted(reading: SmartReading | undefined, calls: number): boolean {
  return calls === 1 && reading?.health === SMART_SENTINEL && reading.availability === "ok";
}

function nutRouted(reading: NutReading | undefined, calls: number): boolean {
  return calls === 1 && reading?.battery === NUT_SENTINEL && reading.availability === "ok";
}

function writeSpy(bin: string, name: string, log: string, hang: boolean): void {
  // The command name is a literal in the spy. PATH during the read contains only
  // this bin, so the script cannot call basename or any other external command.
  const body = `#!/bin/bash
set -u
{
  printf '%s' ${JSON.stringify(name)}
  for arg in "$@"; do printf '\\t%s' "$arg"; done
  printf '\\n'
} >> ${JSON.stringify(log)}
${hang ? "exec /bin/sleep 30\n" : "exit 0\n"}`;
  const file = path.join(bin, name);
  fs.writeFileSync(file, body, { mode: 0o755 });
  fs.chmodSync(file, 0o755);
}

function argvRows(log: string): string[][] {
  if (!fs.existsSync(log)) return [];
  return fs.readFileSync(log, "utf8").split("\n").filter((line) => line.length > 0).map((line) => line.split("\t"));
}

describe("xmachines-readonly-collector-adapters", () => {
  beforeEach(() => {
    gate.generateCalls = 0;
    gate.useFixture = false;
  });

  it("L5e SMART reads route through the collector-owned source", () => {
    let calls = 0;
    const runtime = resolveXmachinesRuntime({ XMACHINES_ARM: "0" });
    runtime.telemetry.useReadSource({
      readSmart(machine: string) {
        calls += 1;
        expect(machine).toBe("hdd");
        return { health: SMART_SENTINEL, availability: "ok", freshness: "fresh" };
      },
      readNut() {
        throw new Error("nut-source-must-not-run");
      },
    });

    const reading = runtime.telemetry.readSmart("hdd");
    expect(reading).toEqual({
      machine: "hdd",
      health: SMART_SENTINEL,
      availability: "ok",
      freshness: "fresh",
    });
    expect(calls).toBe(1);
    expect(smartRouted(reading, calls)).toBe(true);

    const synthetic = new SyntheticTelemetry();
    const shapeRuntime = {
      armed: false,
      telemetry: {
        generate: () => synthetic.generate(),
        forMachine: (name: string) => synthetic.forMachine(name),
      },
    };
    expect(JSON.stringify(synthetic.generate())).not.toContain(SMART_SENTINEL);
    expect(JSON.stringify(shapeRuntime.telemetry.generate())).not.toContain(SMART_SENTINEL);
    expect("readSmart" in shapeRuntime.telemetry).toBe(false);
    expect(smartRouted({ health: synthetic.forMachine("hdd")?.provenance ?? "", availability: "ok", freshness: "fresh", machine: "hdd" }, 0)).toBe(false);
    expect(smartRouted(undefined, 0)).toBe(false);
  });

  it("L5f UPS reads route through the collector-owned source", () => {
    let calls = 0;
    const runtime = resolveXmachinesRuntime({ XMACHINES_ARM: "0" });
    runtime.telemetry.useReadSource({
      readSmart() {
        throw new Error("smart-source-must-not-run");
      },
      readNut(machine: string) {
        calls += 1;
        expect(machine).toBe("hdd");
        return { battery: NUT_SENTINEL, availability: "ok", freshness: "fresh" };
      },
    });

    const reading = runtime.telemetry.readNut("hdd");
    expect(reading).toEqual({
      machine: "hdd",
      battery: NUT_SENTINEL,
      availability: "ok",
      freshness: "fresh",
    });
    expect(calls).toBe(1);
    expect(nutRouted(reading, calls)).toBe(true);

    const synthetic = new SyntheticTelemetry();
    expect(JSON.stringify(synthetic.generate())).not.toContain(NUT_SENTINEL);
    expect(nutRouted(undefined, 0)).toBe(false);

    const src = path.join(REPO, "src");
    const bypass = walkTs(src).filter((file) => {
      const relPath = rel(file);
      if (relPath === "src/services/xmachines/readonly-collector.ts") return false;
      const text = fs.readFileSync(file, "utf8");
      // The detail route calls collector.readNut. A local command source there is still a bypass.
      if (relPath === "src/api/routes/xmachines-routes.ts") {
        return /\bupsc\b|BoundedCommandReadSource|CollectorReadSource/.test(text);
      }
      return /\breadNut\b|\bupsc\b|BoundedCommandReadSource|CollectorReadSource/.test(text);
    }).map(rel);
    expect(bypass).toEqual([]);

    const constructors = walkTs(src).filter((file) =>
      /new\s+ReadOnlyCollector\s*\(/.test(fs.readFileSync(file, "utf8"))
    ).map(rel);
    expect(constructors).toEqual(["src/services/xmachines/runtime.ts"]);
  });

  it("L5g alert evaluation reads the collector spy fixture", () => {
    const quietRuntime = resolveXmachinesRuntime({ XMACHINES_ARM: "0" });
    expect(quietRuntime.telemetry.evaluateAlerts()).toEqual([]);
    expect(gate.generateCalls).toBe(1);

    gate.generateCalls = 0;
    gate.useFixture = true;
    const hotRuntime = resolveXmachinesRuntime({ XMACHINES_ARM: "0" });
    expect(hotRuntime.telemetry.evaluateAlerts()).toEqual([
      { machine: ALERT_HOST, condition: "cpu-temp-high", cpuTemp: ALERT_TEMP },
    ]);
    expect(gate.generateCalls).toBe(1);

    const synthetic = new SyntheticTelemetry();
    const tripped = synthetic.generate().filter((row) => row.name === ALERT_HOST);
    expect(tripped).toEqual([]);
  });

  it("L5h bounded ping and ssh argv, stale on timeout, no wake verbs", () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "a14-argv-"));
    const prevPath = process.env.PATH;
    try {
      const bin = path.join(scratch, "bin");
      fs.mkdirSync(bin);
      const log = path.join(scratch, "argv.log");
      writeSpy(bin, "ping", log, true);
      writeSpy(bin, "ssh", log, true);
      writeSpy(bin, "xmac.sh", log, false);
      writeSpy(bin, "wakeonlan", log, false);
      process.env.PATH = bin;

      const runtime = resolveXmachinesRuntime({ XMACHINES_ARM: "0" });
      const reading = runtime.telemetry.readSmart(PROBE_HOST);
      expect(reading).toEqual({
        machine: PROBE_HOST,
        health: "",
        availability: "unavailable",
        freshness: "stale",
      });

      const rows = argvRows(log);
      const ping = rows.filter((row) => row[0] === "ping");
      const ssh = rows.filter((row) => row[0] === "ssh");
      expect(ping).toEqual([["ping", "-c", "1", "-W", "2", PROBE_HOST]]);
      expect(ssh).toEqual([[
        "ssh",
        "-o", "BatchMode=yes",
        "-o", "ConnectTimeout=5",
        "-o", "StrictHostKeyChecking=accept-new",
        PROBE_HOST,
        "smartctl -H",
      ]]);
      expect(rows.filter((row) => row[0] === "xmac.sh")).toEqual([]);
      expect(rows.filter((row) => row[0] === "wakeonlan")).toEqual([]);
      expect(rows.filter((row) => ["up", "run", "claim", "release"].includes(row[1] ?? ""))).toEqual([]);
    } finally {
      if (prevPath === undefined) delete process.env.PATH;
      else process.env.PATH = prevPath;
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  }, 20000);
});
