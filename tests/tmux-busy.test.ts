import { describe, expect, it } from "vitest";
import { paneLooksBusy, TMUX_BUSY_RE } from "../src/tmux/tmux-busy.js";

describe("paneLooksBusy (B16 extract, behavior-identical to tmux-routes)", () => {
  it("matches the previous inline regex and the esc-to-interrupt fallback", () => {
    expect(TMUX_BUSY_RE.test("✻ Crafting… (esc to interrupt)")).toBe(true);
    expect(paneLooksBusy("✻ Working for 3s")).toBe(true);
    expect(paneLooksBusy("esc to interrupt")).toBe(true);
    expect(paneLooksBusy("Esc to interrupt")).toBe(true);
    expect(paneLooksBusy("idle composer ❯")).toBe(false);
    expect(paneLooksBusy("")).toBe(false);
  });
});
