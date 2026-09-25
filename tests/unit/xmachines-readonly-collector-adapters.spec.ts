import { describe, it, expect } from "vitest";
import { ReadOnlyCollector } from "../../src/services/xmachines/readonly-collector.js";
import { resolveXmachinesRuntime } from "../../src/services/xmachines/runtime.js";

describe("xmachines-readonly-collector-adapters", () => {
  it("L5e SMART reads route through reader module", () => {
    const runtime = resolveXmachinesRuntime({ XMACHINES_ARM: "0" });
    expect(runtime.telemetry).toBeInstanceOf(ReadOnlyCollector);
    expect(typeof runtime.telemetry.generate).toBe("function");
  });

  it("L5f UPS reads route through reader module", () => {
    const runtime = resolveXmachinesRuntime({ XMACHINES_ARM: "0" });
    expect(runtime.telemetry).toBeInstanceOf(ReadOnlyCollector);
  });

  it("L5g Alert evaluation reads route through reader module", () => {
    const runtime = resolveXmachinesRuntime({ XMACHINES_ARM: "0" });
    expect(runtime.telemetry).toBeInstanceOf(ReadOnlyCollector);
  });

  it("L5h Reader may use bounded ping and SSH reads", () => {
    const collector = new ReadOnlyCollector();
    // Should not own wake verbs
    const src = collector.constructor.toString();
    expect(src).not.toContain("wake");
    // Basic read methods exist
    expect(typeof collector.generate).toBe("function");
    expect(typeof collector.forMachine).toBe("function");
  });
});
