import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DatabaseService } from "../../src/db/database.js";
import { sampleFleet } from "../../src/services/xmachines/sampler.js";
import { resolveXmachinesRuntime } from "../../src/services/xmachines/runtime.js";

const PROBE_HOST = "192.0.2.14";
const DOWN_FAKE = "down-fake";
const UP_FAKE = "up-fake";
const WAKE_VERBS = ["up", "run", "claim", "release", "wake"];

function writeObservedFleet(dir: string): string {
  const fixture = path.join(dir, "observed-fleet.json");
  fs.writeFileSync(fixture, JSON.stringify([
    { name: DOWN_FAKE, state: "down" },
    { name: UP_FAKE, state: "up" },
  ]));
  return fixture;
}

// The command name is a literal baked into the spy script, not read from argv[0]
// at invocation time — so the row's executable identity can't be spoofed by how
// the child process happens to be invoked. Mirrors the A14 argvRows pattern.
function writeSpy(bin: string, name: string, log: string, hang: boolean): void {
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

function isForbiddenGatewayCall(row: string[]): boolean {
  if (row[0] === "xmac.sh" || row[0] === "wakeonlan") return true;
  return row.some((token) => WAKE_VERBS.includes(token));
}

describe("xmachines-readonly-collector-passivity", () => {
  let scratch: string;
  let bin: string;
  let log: string;
  let prevPath: string | undefined;

  beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "a15-passivity-"));
    bin = path.join(scratch, "bin");
    fs.mkdirSync(bin);
    log = path.join(scratch, "argv.log");
    prevPath = process.env.PATH;
    ["ping", "ssh", "xmac.sh", "wakeonlan"].forEach((name) => writeSpy(bin, name, log, false));
    process.env.PATH = bin + ":" + (prevPath ?? "");
  });

  afterEach(() => {
    if (prevPath === undefined) delete process.env.PATH;
    else process.env.PATH = prevPath;
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  it("F3a remote metric reads only for machines already observed UP", () => {
    const fixture = writeObservedFleet(scratch);
    const fleet = sampleFleet({ XMACHINES_ARM: "0", XMACHINES_OBSERVED_FLEET: fixture });

    expect(fleet.find((row) => row.name === UP_FAKE)?.state).toBe("up");
    expect(fleet.find((row) => row.name === DOWN_FAKE)?.state).toBe("down");

    const rows = argvRows(log);
    expect(rows).toContainEqual(["ping", "-c", "1", "-W", "2", UP_FAKE]);
    expect(rows).toContainEqual([
      "ssh",
      "-o", "BatchMode=yes",
      "-o", "ConnectTimeout=5",
      "-o", "StrictHostKeyChecking=accept-new",
      UP_FAKE,
      "smartctl -H",
    ]);
    expect(rows.filter((row) => row.includes(DOWN_FAKE))).toEqual([]);
  });

  it("F3b a full collection cycle emits zero wake/run/claim/release calls", () => {
    const specimenLog = path.join(scratch, "specimen.log");
    for (const name of ["xmac.sh", "wakeonlan", "ping", "ssh"]) writeSpy(bin, name, specimenLog, false);
    spawnSync(path.join(bin, "xmac.sh"), ["up", UP_FAKE], { encoding: "utf8" });
    spawnSync(path.join(bin, "xmac.sh"), ["run", UP_FAKE], { encoding: "utf8" });
    spawnSync(path.join(bin, "xmac.sh"), ["claim", UP_FAKE], { encoding: "utf8" });
    spawnSync(path.join(bin, "xmac.sh"), ["release", UP_FAKE], { encoding: "utf8" });
    spawnSync(path.join(bin, "wakeonlan"), ["aa:bb:cc:dd:ee:ff"], { encoding: "utf8" });
    const specimen = argvRows(specimenLog);
    expect(specimen.filter(isForbiddenGatewayCall)).toEqual(specimen);
    expect(isForbiddenGatewayCall(["ping", "-c", "1", "-W", "2", UP_FAKE])).toBe(false);

    for (const name of ["xmac.sh", "wakeonlan", "ping", "ssh"]) writeSpy(bin, name, log, false);
    const fixture = writeObservedFleet(scratch);
    sampleFleet({ XMACHINES_ARM: "0", XMACHINES_OBSERVED_FLEET: fixture });
    expect(argvRows(log).filter(isForbiddenGatewayCall)).toEqual([]);
  });

  it("F3c a DOWN fake-fleet machine remains DOWN across a full collection cycle", () => {
    const fixture = writeObservedFleet(scratch);
    const env = { XMACHINES_ARM: "0", XMACHINES_OBSERVED_FLEET: fixture };
    const first = sampleFleet(env);
    const second = sampleFleet(env);
    expect(first.find((row) => row.name === DOWN_FAKE)?.state).toBe("down");
    expect(second.find((row) => row.name === DOWN_FAKE)?.state).toBe("down");
    expect(argvRows(log).filter((row) => row.includes(DOWN_FAKE))).toEqual([]);
  });

  it("L5i reader never calls xmac up/run/claim/release/wakeonlan", () => {
    const runtime = resolveXmachinesRuntime({ XMACHINES_ARM: "0" });
    runtime.telemetry.readSmart(UP_FAKE);
    runtime.telemetry.readNut(UP_FAKE);

    const rows = argvRows(log);
    expect(rows.filter(isForbiddenGatewayCall)).toEqual([]);
    expect(rows.some((row) => row[0] === "ping" && row.includes(UP_FAKE))).toBe(true);
  });

  it("L5j reader failure records stale data in the product store rather than waking the machine", () => {
    writeSpy(bin, "ping", log, true);
    writeSpy(bin, "ssh", log, true);

    const dbPath = path.join(scratch, "a15.sqlite");
    const db = new DatabaseService(dbPath);
    try {
      const runtime = resolveXmachinesRuntime({ XMACHINES_ARM: "0" });
      runtime.telemetry.useReaderStore(db.raw);
      runtime.telemetry.readSmart(PROBE_HOST);

      const stored = db.raw
        .prepare("SELECT machine_name, kind, availability, freshness FROM xm_reader_results WHERE machine_name = ? AND kind = 'smart'")
        .get(PROBE_HOST);
      expect(stored).toEqual({
        machine_name: PROBE_HOST,
        kind: "smart",
        availability: "unavailable",
        freshness: "stale",
      });
    } finally {
      db.close();
    }

    expect(argvRows(log).filter(isForbiddenGatewayCall)).toEqual([]);
  }, 20000);
});
