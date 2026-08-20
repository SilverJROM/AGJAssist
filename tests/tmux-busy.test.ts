import { describe, expect, it } from "vitest";
import { getPaneBusyStates, paneLooksBusyFromSamples } from "../src/tmux/tmux-busy.js";

describe("tmux busy detection", () => {
  it("treats identical paired captures as idle, including stale busy-looking text", () => {
    const stale = "✻ Worked for 14m\n⇣105k tokens\nnew task?";
    expect(paneLooksBusyFromSamples(stale, stale)).toBe(false);
    expect(paneLooksBusyFromSamples("esc to interrupt", "esc to interrupt")).toBe(false);
  });

  it("treats changed paired captures as busy", () => {
    expect(paneLooksBusyFromSamples("✻ Working for 3s", "✳ Working for 3s")).toBe(true);
    expect(
      paneLooksBusyFromSamples(
        "Building\nline 1",
        "Building\nfinished compiling module output"
      )
    ).toBe(true);
  });

  it("treats a small Claude star-cycle glyph change as busy", () => {
    expect(
      paneLooksBusyFromSamples(
        "· ✢ ✽ ✻ ✶ * Gusting… (6m 2s · ↓ 3.7k tokens)",
        "· ✢ ✽ ✻ ✶ ✳ Gusting… (6m 2s · ↓ 3.7k tokens)"
      )
    ).toBe(true);
  });

  it("treats an incrementing active elapsed timer as busy", () => {
    expect(
      paneLooksBusyFromSamples(
        "Gusting… (6m 2s · ↓ 3.7k tokens)",
        "Gusting… (6m 3s · ↓ 3.7k tokens)"
      )
    ).toBe(true);
  });

  it("ignores tiny non-spinner changes such as a one-second clock edge", () => {
    expect(paneLooksBusyFromSamples("clock 12:34:55", "clock 12:34:56")).toBe(false);
  });

  it("captures all panes in two passes and returns idle/busy by target", async () => {
    const samples = new Map([
      ["IDLE:0.0", ["✻ Worked for 14m\nnew task?", "✻ Worked for 14m\nnew task?"]],
      ["BUSY:0.0", ["✻ Working for 3s", "✳ Working for 3s"]]
    ]);
    const calls: string[] = [];

    const busy = await getPaneBusyStates(
      [{ target: "IDLE:0.0" }, { target: "BUSY:0.0" }],
      async (target) => {
        calls.push(target);
        return samples.get(target)!.shift()!;
      },
      { delayMs: 0 }
    );

    expect(calls).toEqual(["IDLE:0.0", "BUSY:0.0", "IDLE:0.0", "BUSY:0.0"]);
    expect(busy.get("IDLE:0.0")).toBe(false);
    expect(busy.get("BUSY:0.0")).toBe(true);
  });
});
