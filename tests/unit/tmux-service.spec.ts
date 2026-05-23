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
      "send-keys",
      "-l",
      "-t",
      "agj-7:0.0",
      "--",
      "npm test"
    ]);
    expect(execFileMock).toHaveBeenNthCalledWith(2, "tmux", [
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

describe("TmuxService sendAndSubmit", () => {
  beforeEach(() => {
    execFileMock.mockReset();
    execFileMock.mockResolvedValue({ stdout: "", stderr: "" });
  });

  it("returns true immediately when the composer is clear after the first Enter", async () => {
    const service = new TmuxService();
    // capturePane returns a clean pane (no ❯/› with the message text in it).
    vi.spyOn(service, "capturePane").mockResolvedValue("some clean output\r\n");

    const result = await service.sendAndSubmit("agj-7:0.0", "Hello coordinator");

    expect(result).toBe(true);
    // Should have sent text + one C-m initially.
    expect(execFileMock).toHaveBeenCalledWith("tmux", ["send-keys", "-l", "-t", "agj-7:0.0", "--", "Hello coordinator"]);
    expect(execFileMock).toHaveBeenCalledWith("tmux", ["send-keys", "-t", "agj-7:0.0", "C-m"]);
  });

  it("re-presses Enter when the first capture shows the text stuck in the composer, then returns true", async () => {
    const service = new TmuxService();
    const capturePane = vi.spyOn(service, "capturePane");
    // First capture: text is still in the composer line.
    capturePane.mockResolvedValueOnce("❯ Hello coordinator\r\n");
    // Second capture: composer is clear.
    capturePane.mockResolvedValueOnce("some clean output\r\n");

    const result = await service.sendAndSubmit("agj-7:0.0", "Hello coordinator");

    expect(result).toBe(true);
    // C-m should have been sent twice: initial + one re-press.
    const cmCalls = execFileMock.mock.calls.filter(
      (args: string[]) => JSON.stringify(args) === JSON.stringify(["tmux", ["send-keys", "-t", "agj-7:0.0", "C-m"]])
    );
    expect(cmCalls.length).toBe(2);
  });

  it("returns false after 3 Enter attempts when the composer never clears (no infinite loop)", async () => {
    const service = new TmuxService();
    // Every capturePane call returns the text still in the composer.
    vi.spyOn(service, "capturePane").mockResolvedValue("❯ Hello coordinator stuck\r\n");

    const result = await service.sendAndSubmit("agj-7:0.0", "Hello coordinator stuck");

    expect(result).toBe(false);
    // Exactly 3 C-m presses total (never more).
    const cmCalls = execFileMock.mock.calls.filter(
      (args: string[]) => JSON.stringify(args) === JSON.stringify(["tmux", ["send-keys", "-t", "agj-7:0.0", "C-m"]])
    );
    expect(cmCalls.length).toBe(3);
  });

  it("returns false (no throw) when execFile rejects (e.g. invalid session)", async () => {
    const service = new TmuxService();
    execFileMock.mockRejectedValue(new Error("no server running"));

    const result = await service.sendAndSubmit("agj-7:0.0", "any text");

    expect(result).toBe(false);
  });

  it("detects paste indicator [Pasted Content and re-presses Enter", async () => {
    const service = new TmuxService();
    const capturePane = vi.spyOn(service, "capturePane");
    // First capture: pane shows paste indicator.
    capturePane.mockResolvedValueOnce("[Pasted Content (3 lines)] Press tab to queue message\r\n");
    // Second capture: clean.
    capturePane.mockResolvedValueOnce("submitted output\r\n");

    const result = await service.sendAndSubmit("agj-7:0.0", "some long text");

    expect(result).toBe(true);
  });
});
