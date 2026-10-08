import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dgxFleetFromEnv } from "../../src/services/xmachines/dgx-read-model.js";

describe("dgxFleetFromEnv (DGX Spark pairs)", () => {
  let root: string;
  const saved = process.env.XMACHINES_DGX_FIXTURE;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "dgx-"));
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.XMACHINES_DGX_FIXTURE;
    else process.env.XMACHINES_DGX_FIXTURE = saved;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("returns [] when no fixture is configured", () => {
    delete process.env.XMACHINES_DGX_FIXTURE;
    expect(dgxFleetFromEnv(process.env)).toEqual([]);
  });

  it("maps a pair to one in-use, read-only machine with the served model", () => {
    const f = path.join(root, "dgx.json");
    fs.writeFileSync(f, JSON.stringify({
      dgxA: {
        displayName: "DGX A", model: "glm-5.3-flash", route: "dgx12", state: "up",
        nodes: [
          { label: "DGX1", host: "spark-ab62", reachable: true, gpuTempC: 42, gpuPowerW: 11, gpuUtil: 0, memUsedMB: 119000, memTotalMB: 124610, uptime: "3d" },
          { label: "DGX2", host: "gx10-5359", reachable: true, gpuTempC: 55, gpuPowerW: 61, gpuUtil: 96, memUsedMB: 117000, memTotalMB: 124546, uptime: "3d" },
        ],
        health: { ok: true },
      },
    }));
    process.env.XMACHINES_DGX_FIXTURE = f;
    const [a] = dgxFleetFromEnv(process.env);
    expect(a.name).toBe("dgxA");
    expect(a.displayName).toBe("DGX A");
    expect(a.state).toBe("up");
    expect(a.offline).toBe(false);
    expect(a.noPowerControl).toBe(true);
    expect(a.gpuCount).toBe(2);
    expect(a.gpusBusy).toBe(2); // model resident in unified memory on both nodes -> in use
    expect(a.gpuTemp).toBe(55); // hottest node
    expect(a.powerWatts).toBe(72); // summed
    expect(a.dgx?.model).toBe("glm-5.3-flash");
    expect(a.dgx?.nodes).toHaveLength(2);
  });

  it("marks an unreachable pair as unknown (never offline)", () => {
    const f = path.join(root, "dgx.json");
    fs.writeFileSync(f, JSON.stringify({
      dgxB: {
        displayName: "DGX B", model: "deepseek-v4.1-flash", state: "unknown",
        nodes: [{ label: "DGX3", reachable: false }, { label: "DGX4", reachable: false }],
        health: null,
      },
    }));
    process.env.XMACHINES_DGX_FIXTURE = f;
    const [b] = dgxFleetFromEnv(process.env);
    expect(b.state).toBe("unknown");
    expect(b.offline).toBe(false);
    expect(b.gpuCount).toBe(0);
  });
});
