import { describe, it, expect, vi, beforeEach } from "vitest";
import { OvmSessionService, OvmTmuxService } from "../src/services/ovm-session.js";

function mockTmux(exists: boolean): OvmTmuxService {
  return {
    sessionExists: vi.fn(async () => exists),
    createSession: vi.fn(async () => "OVM:0.0"),
    terminateSession: vi.fn(async () => undefined),
    sendCommand: vi.fn(async () => ({ blocked: false }))
  };
}

function service(tmux: OvmTmuxService): OvmSessionService {
  return new OvmSessionService(tmux, {
    overmindToken: "ovm-test-token",
    settleMs: 0
  });
}

describe("OvmSessionService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reuses an existing OVM session without launching Claude", async () => {
    const tmux = mockTmux(true);
    const manager = service(tmux);

    const result = await manager.open();

    expect(result).toMatchObject({ open: true, status: "open", reused: true });
    expect(tmux.createSession).not.toHaveBeenCalled();
    expect(tmux.sendCommand).not.toHaveBeenCalled();
  });

  it("creates a new OVM session, launches Claude, and sends the primer kickoff", async () => {
    const tmux = mockTmux(false);
    const manager = service(tmux);

    const result = await manager.open();

    expect(result.opened).toBe(true);
    expect(result.open).toBe(true);
    expect(result.since).toBeTruthy();
    expect(tmux.createSession).toHaveBeenCalledWith("OVM", "/home/agjrom/TGBOTS/AGJAssist");
    expect(tmux.sendCommand).toHaveBeenNthCalledWith(
      1,
      "OVM",
      "claude --dangerously-skip-permissions --model sonnet",
      true,
      true
    );
    expect(tmux.sendCommand).toHaveBeenNthCalledWith(
      2,
      "OVM",
      "Read /home/agjrom/TGBOTS/AGJAssist/plan/overmind/OVM_OPERATOR_PRIMER.md and operate as the Overmind operator per it. OVERMIND_TOKEN=ovm-test-token. Reply 'ready' when you've read it.",
      true,
      true
    );
  });

  it("restart terminates an existing session before opening a fresh one", async () => {
    let exists = true;
    const tmux = {
      sessionExists: vi.fn(async () => exists),
      createSession: vi.fn(async () => "OVM:0.0"),
      terminateSession: vi.fn(async () => {
        exists = false;
      }),
      sendCommand: vi.fn(async () => ({ blocked: false }))
    } satisfies OvmTmuxService;
    const manager = service(tmux);

    const result = await manager.restart();

    expect(result.restarted).toBe(true);
    expect(result.opened).toBe(true);
    expect(tmux.terminateSession).toHaveBeenCalledWith("OVM");
    expect(tmux.createSession).toHaveBeenCalledWith("OVM", "/home/agjrom/TGBOTS/AGJAssist");
  });

  it("close terminates OVM when open and reports closed", async () => {
    const tmux = mockTmux(true);
    const manager = service(tmux);

    const result = await manager.close();

    expect(result).toEqual({ open: false, status: "closed", closed: true });
    expect(tmux.terminateSession).toHaveBeenCalledWith("OVM");
  });
});
