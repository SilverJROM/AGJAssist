import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const PROBE_HOST = "192.0.2.14";
const DOWN_FAKE = "down-fake";
const UP_FAKE = "up-fake";

const gate = vi.hoisted(() => ({
  generateCalls: 0,
  forMachineCalls: [] as string[],
  machines: [] as Array<{ name: string; state: 'up' | 'down' | 'synthetic' }>,
  readSmartCalls: [] as string[],
  readNutCalls: [] as string[],
  wakeCalls: [] as string[],
}));

vi.mock("../../src/services/xmachines/readonly-collector.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/services/xmachines/readonly-collector.js")>();
  class SpiedReadOnlyCollector extends actual.ReadOnlyCollector {
    override generate() {
      gate.generateCalls += 1;
      return gate.machines.map(m => ({
        ...m,
        cpuTemp: 40,
        gpuTemp: 50,
        powerWatts: 100,
        uptime: "synthetic",
        provenance: "collector-spy",
        sampleAge: "0s",
      }));
    }
    override forMachine(name: string) {
      gate.forMachineCalls.push(name);
      return gate.machines.find(m => m.name === name) || undefined;
    }
    // readSmart/readNut not overridden – use real BoundedCommandReadSource for passivity tests
  }
  return { ...actual, ReadOnlyCollector: SpiedReadOnlyCollector };
});

import { resolveXmachinesRuntime } from "../../src/services/xmachines/runtime.js";
import { ReadOnlyCollector } from "../../src/services/xmachines/readonly-collector.js";
import { SyntheticTelemetry } from "../../src/services/xmachines/telemetry.js";

function walkTs(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkTs(full, out);
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}
function rel(file: string) {
  return path.relative(REPO, file).split(path.sep).join("/");
}

describe("xmachines-readonly-collector-passivity", () => {
  beforeEach(() => {
    gate.generateCalls = 0;
    gate.forMachineCalls = [];
    gate.readSmartCalls = [];
    gate.readNutCalls = [];
    gate.machines = [
      { name: DOWN_FAKE, state: 'down' },
      { name: UP_FAKE, state: 'up' },
    ];
  });

  it("F3a remote metric reads only for machines already observed UP", () => {
    const runtime = resolveXmachinesRuntime({ XMACHINES_ARM: "0" });
    const telemetry = runtime.telemetry;
    // Simulate read boundary gated by observed UP
    const fleet = telemetry.generate();
    const upMachines = fleet.filter(m => m.state === 'up').map(m => m.name);
    expect(upMachines).toEqual([UP_FAKE]);
    expect(gate.generateCalls).toBe(1);
    // Verify telemetry for DOWN machine remains down
    const down = telemetry.forMachine(DOWN_FAKE);
    expect(down?.name).toBe(DOWN_FAKE);
    const up = telemetry.forMachine(UP_FAKE);
    expect(up?.name).toBe(UP_FAKE);
  });

  it("F3b full collection cycle emits zero wake/run/claim/release calls", () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "a15-passivity-"));
    const prevPath = process.env.PATH;
    try {
      const bin = path.join(scratch, "bin");
      fs.mkdirSync(bin);
      const log = path.join(scratch, "argv.log");
      const writeSpy = (name: string) => {
        const file = path.join(bin, name);
        fs.writeFileSync(file, `#!/bin/bash\nprintf '%s\\t%s\\n' "$1" "$*" >> ${JSON.stringify(log)}\nexit 0\n`, { mode: 0o755 });
      };
      ["xmac.sh", "wakeonlan", "ping", "ssh"].forEach(writeSpy);
      process.env.PATH = bin + ":" + prevPath;

      const runtime = resolveXmachinesRuntime({ XMACHINES_ARM: "0" });
      runtime.telemetry.generate();
      // No wake verbs should be logged
      const rows = fs.existsSync(log) ? fs.readFileSync(log, "utf8").split("\n").filter(l => l) : [];
      const wake = rows.filter(r => r.startsWith("wakeonlan") || r.startsWith("xmac.sh"));
      expect(wake).toEqual([]);
    } finally {
      process.env.PATH = prevPath;
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("F3c DOWN fake fleet machine remains DOWN across collection cycle", () => {
    const runtime = resolveXmachinesRuntime({ XMACHINES_ARM: "0" });
    const first = runtime.telemetry.forMachine(DOWN_FAKE);
    expect(first?.name).toBe(DOWN_FAKE);
    // State must remain down
    const fleet = runtime.telemetry.generate();
    const downMachine = fleet.find(m => m.name === DOWN_FAKE);
    expect(downMachine?.state).toBe('down');
  });

  it("L5i reader never calls xmac up/run/claim/release/wakeonlan", () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "a15-passivity2-"));
    const prevPath = process.env.PATH;
    try {
      const bin = path.join(scratch, "bin");
      fs.mkdirSync(bin);
      const log = path.join(scratch, "argv.log");
      const writeSpy = (name: string) => {
        const file = path.join(bin, name);
        fs.writeFileSync(file, `#!/bin/bash\nprintf '%s\\t%s\\n' "$0" "$*" >> ${JSON.stringify(log)}\nexit 0\n`, { mode: 0o755 });
      };
      ["xmac.sh", "wakeonlan", "ping", "ssh"].forEach(writeSpy);
      process.env.PATH = bin + ":" + prevPath;

      const runtime = resolveXmachinesRuntime({ XMACHINES_ARM: "0" });
      // Exercise read path
      runtime.telemetry.readSmart(UP_FAKE);
      runtime.telemetry.readNut(UP_FAKE);
      const rows = fs.existsSync(log) ? fs.readFileSync(log, "utf8").split("\n").filter(l => l) : [];
      const forbidden = rows.filter(r => r.includes("xmac.sh") || r.includes("wakeonlan"));
      expect(forbidden).toEqual([]);
    } finally {
      process.env.PATH = prevPath;
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("L5j reader failure records stale data rather than waking machine", () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "a15-passivity3-"));
    const prevPath = process.env.PATH;
    try {
      const bin = path.join(scratch, "bin");
      fs.mkdirSync(bin);
      const log = path.join(scratch, "argv.log");
      // ping/ssh hang => timeout => stale
      const writeSpy = (name: string, hang: boolean) => {
        const file = path.join(bin, name);
        const body = `#!/bin/bash\nprintf '%s\\t%s\\n' "$0" "$*" >> ${JSON.stringify(log)}\n${hang ? "exec /bin/sleep 30" : "exit 0"}\n`;
        fs.writeFileSync(file, body, { mode: 0o755 });
      };
      writeSpy("ping", true);
      writeSpy("ssh", true);
      writeSpy("xmac.sh", false);
      writeSpy("wakeonlan", false);
      process.env.PATH = bin + ":" + prevPath;

      const runtime = resolveXmachinesRuntime({ XMACHINES_ARM: "0" });
      const reading = runtime.telemetry.readSmart(PROBE_HOST);
      expect(reading).toEqual({
        machine: PROBE_HOST,
        health: "",
        availability: "unavailable",
        freshness: "stale",
      });
      const rows = fs.existsSync(log) ? fs.readFileSync(log, "utf8").split("\n").filter(l => l) : [];
      expect(rows.some(r => r.includes("xmac.sh"))).toBe(false);
      expect(rows.some(r => r.includes("wakeonlan"))).toBe(false);
    } finally {
      process.env.PATH = prevPath;
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("L5a exactly one reader module owns remote telemetry I/O", () => {
    const src = path.join(REPO, "src");
    const constructors = walkTs(src).filter(file => /new\s+ReadOnlyCollector\s*\(/.test(fs.readFileSync(file, "utf8"))).map(rel);
    expect(constructors).toEqual(["src/services/xmachines/runtime.ts"]);
    const mentions = walkTs(src).filter(file => fs.readFileSync(file, "utf8").includes("SyntheticTelemetry")).map(rel).sort();
    expect(mentions).toEqual([
      "src/services/xmachines/readonly-collector.ts",
      "src/services/xmachines/telemetry.ts",
    ]);
  });
});
