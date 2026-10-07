import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registryFleetFromEnv } from "../../src/services/xmachines/fleet-read-model.js";

// A model-serving GPU can sit at near-idle util/power (speculative decoding,
// context lookup, prefix cache) while still working — the model is resident in
// VRAM. The in-use count must reflect that so a serving box never reads as "not
// working" on the overview.
describe("fleet read-model: VRAM-resident model counts as an in-use GPU", () => {
  const KEYS = ["XMACHINES_STATUS_FIXTURE", "XMACHINES_TELEMETRY_FIXTURE", "XMAC_CONF"];
  const saved: Record<string, string | undefined> = {};
  let root: string;

  beforeEach(() => {
    for (const k of KEYS) saved[k] = process.env[k];
    root = fs.mkdtempSync(path.join(os.tmpdir(), "vram-busy-"));
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  function setup(metric: Record<string, unknown>) {
    const statusPath = path.join(root, "status.txt");
    const metricsPath = path.join(root, "metrics.json");
    const confPath = path.join(root, "machines.conf");
    fs.writeFileSync(statusPath, "media  192.0.2.82  UP  leases=()  gpu\n");
    fs.writeFileSync(confPath, "media|192.0.2.82|02:00:00:00:00:82|agjrom|gpu|true\n");
    fs.writeFileSync(metricsPath, JSON.stringify({ media: metric }));
    process.env.XMACHINES_STATUS_FIXTURE = statusPath;
    process.env.XMACHINES_TELEMETRY_FIXTURE = metricsPath;
    process.env.XMAC_CONF = confPath;
    const fleet = registryFleetFromEnv(process.env) ?? [];
    const media = fleet.find((m) => m.name === "media");
    if (!media) throw new Error("media not in read-model");
    return media;
  }

  it("marks a low-util, low-power GPU busy when VRAM holds a loaded model", () => {
    // 381 tok/s-style serving: util 0, ~35W, but 16.5 GB resident.
    const media = setup({ gpuTempsC: [57], gpuPowerWatts: [35], gpuUtil: [0], gpuMemUsed: [16516] });
    expect(media.gpuCount).toBe(1);
    expect(media.gpusBusy).toBe(1);
  });

  it("does not mark a truly idle GPU (no model resident) busy", () => {
    const media = setup({ gpuTempsC: [40], gpuPowerWatts: [25], gpuUtil: [0], gpuMemUsed: [120] });
    expect(media.gpuCount).toBe(1);
    expect(media.gpusBusy).toBe(0);
  });
});
