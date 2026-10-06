import { beforeEach, describe, expect, it, vi } from "vitest";

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn()
}));

vi.mock("node:child_process", () => ({
  execFile: execFileMock
}));

vi.mock("node:util", async () => ({
  promisify: () => execFileMock
}));

// Stub out the timers/promises sleep so tests run instantly.
vi.mock("node:timers/promises", () => ({
  setTimeout: vi.fn(async () => {})
}));

import { TmuxService } from "../../src/tmux/tmux-service.js";

describe("TmuxService sendCommand", () => {
  beforeEach(() => {
    execFileMock.mockReset();
    execFileMock.mockResolvedValue({ stdout: "", stderr: "" });
  });

  it("sends Enter as a separate tmux keypress when requested", async () => {
    const service = new TmuxService();

    await service.sendCommand("agj-7:0.0", "npm test", true, true);

    expect(execFileMock).toHaveBeenNthCalledWith(1, "tmux", [
      "display-message",
      "-p",
      "-t",
      "agj-7:0.0",
      "#{pane_in_mode}"
    ]);
    expect(execFileMock).toHaveBeenNthCalledWith(2, "tmux", [
      "send-keys",
      "-l",
      "-t",
      "agj-7:0.0",
      "--",
      "npm test"
    ]);
    expect(execFileMock).toHaveBeenNthCalledWith(3, "tmux", [
      "send-keys",
      "-t",
      "agj-7:0.0",
      "C-m"
    ]);
  });

  it("can send only Enter to a tmux pane", async () => {
    const service = new TmuxService();

    await service.sendEnter("agj-7:0.0");

    expect(execFileMock).toHaveBeenCalledWith("tmux", [
      "send-keys",
      "-t",
      "agj-7:0.0",
      "C-m"
    ]);
  });

  it("accepts bare session names and full pane targets only", () => {
    const service = new TmuxService();

    expect(() => service.ensureValidTarget("ovm-build")).not.toThrow();
    expect(() => service.ensureValidTarget("hris-d-22")).not.toThrow();
    expect(() => service.ensureValidTarget("sess:0.1")).not.toThrow();

    expect(() => service.ensureValidTarget("")).toThrow("Invalid tmux target");
    expect(() => service.ensureValidTarget("ovm build")).toThrow("Invalid tmux target");
    expect(() => service.ensureValidTarget("ovm-build;rm")).toThrow("Invalid tmux target");
    expect(() => service.ensureValidTarget("sess:0.1;rm")).toThrow("Invalid tmux target");
  });
});

describe("TmuxService listPanes", () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  it("includes tmux activity seconds for panes", async () => {
    execFileMock.mockResolvedValueOnce({
      stdout: "AGJ|0|0|claude|title|1787240400|1787240000|0\n"
    });
    const service = new TmuxService();

    await expect(service.listPanes()).resolves.toEqual([
      {
        target: "AGJ:0.0",
        session: "AGJ",
        window: "0",
        pane: "0",
        command: "claude",
        title: "title",
        activity: 1787240400,
        alternate_on: false
      }
    ]);
  });

  it("flags alternate-screen (full-screen TUI) panes via alternate_on", async () => {
    execFileMock.mockResolvedValueOnce({
      stdout: "grok47|0|0|grok|grok dashboard|1787240400|1787240000|1\n"
    });
    const service = new TmuxService();
    const panes = await service.listPanes();
    expect(panes[0].command).toBe("grok");
    expect(panes[0].alternate_on).toBe(true);
  });
});

describe("TmuxService sendAndSubmit", () => {
  beforeEach(() => {
    execFileMock.mockReset();
    execFileMock.mockResolvedValue({ stdout: "", stderr: "" });
  });

  const cmCallsFor = (target: string) =>
    execFileMock.mock.calls.filter(
      (args: string[]) => JSON.stringify(args) === JSON.stringify(["tmux", ["send-keys", "-t", target, "C-m"]])
    );

  it("pastes the text, waits for it to render, then submits and returns true", async () => {
    const service = new TmuxService();
    const capturePane = vi.spyOn(service, "capturePane");
    // Render poll: composer is holding our text.
    capturePane.mockResolvedValueOnce("❯ Hello coordinator\r\n");
    // Verify after Enter: composer cleared.
    capturePane.mockResolvedValue("some clean output\r\n");

    const result = await service.sendAndSubmit("agj-7:0.0", "Hello coordinator");

    expect(result).toBe(true);
    expect(execFileMock).toHaveBeenCalledWith("tmux", ["send-keys", "-l", "-t", "agj-7:0.0", "--", "Hello coordinator"]);
    // Exactly one Enter: pressed once, after the paste rendered, and it cleared.
    expect(cmCallsFor("agj-7:0.0").length).toBe(1);
  });

  it("does NOT press Enter until the async paste has rendered (regression: no false-positive submit)", async () => {
    const service = new TmuxService();
    const capturePane = vi.spyOn(service, "capturePane");
    // First two polls: paste hasn't landed yet — composer shows only the empty prompt.
    capturePane.mockResolvedValueOnce("❯ \r\n");
    capturePane.mockResolvedValueOnce("❯ \r\n");
    // Third poll: the text has finally rendered.
    capturePane.mockResolvedValueOnce("❯ Hello coordinator\r\n");
    // Verify after Enter: cleared.
    capturePane.mockResolvedValue("clean\r\n");

    const result = await service.sendAndSubmit("agj-7:0.0", "Hello coordinator");

    expect(result).toBe(true);
    // The old bug pressed Enter immediately into the empty composer (swallowed) and
    // then declared success off the empty pane. Now we poll the empty composer
    // (>= 3 captures) and press Enter exactly ONCE, only after the text rendered.
    expect(capturePane.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(cmCallsFor("agj-7:0.0").length).toBe(1);
  });

  it("re-presses Enter when the composer doesn't clear after the first Enter", async () => {
    const service = new TmuxService();
    const capturePane = vi.spyOn(service, "capturePane");
    capturePane.mockResolvedValueOnce("❯ Hello coordinator\r\n"); // render poll: held
    capturePane.mockResolvedValueOnce("❯ Hello coordinator\r\n"); // verify 1: still held → re-press
    capturePane.mockResolvedValue("some clean output\r\n"); // verify 2: cleared

    const result = await service.sendAndSubmit("agj-7:0.0", "Hello coordinator");

    expect(result).toBe(true);
    expect(cmCallsFor("agj-7:0.0").length).toBe(2);
  });

  it("returns false after SUBMIT_MAX_PRESSES (4) when the composer never clears (no infinite loop)", async () => {
    const service = new TmuxService();
    vi.spyOn(service, "capturePane").mockResolvedValue("❯ Hello coordinator stuck\r\n");

    const result = await service.sendAndSubmit("agj-7:0.0", "Hello coordinator stuck");

    expect(result).toBe(false);
    expect(cmCallsFor("agj-7:0.0").length).toBe(4);
  });

  it("returns false (no throw) when execFile rejects (e.g. invalid session)", async () => {
    const service = new TmuxService();
    execFileMock.mockRejectedValue(new Error("no server running"));

    const result = await service.sendAndSubmit("agj-7:0.0", "any text");

    expect(result).toBe(false);
  });

  it("treats a [Pasted Content] blob as rendered, then submits", async () => {
    const service = new TmuxService();
    const capturePane = vi.spyOn(service, "capturePane");
    // Render poll: pane shows the paste blob indicator (counts as "holding text").
    capturePane.mockResolvedValueOnce("[Pasted Content (3 lines)] Press tab to queue message\r\n");
    // Verify after Enter: clean.
    capturePane.mockResolvedValue("submitted output\r\n");

    const result = await service.sendAndSubmit("agj-7:0.0", "some long text");

    expect(result).toBe(true);
    expect(cmCallsFor("agj-7:0.0").length).toBe(1);
  });
});
