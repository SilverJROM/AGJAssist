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
