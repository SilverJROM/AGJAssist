import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OvmSessionService, OvmTmuxService } from "../src/services/ovm-session.js";

function mockTmux(exists: boolean, captureResults?: string[]): OvmTmuxService {
  let captureCallCount = 0;
  const captureList = captureResults ?? [];
  return {
    sessionExists: vi.fn(async () => exists),
    createSession: vi.fn(async () => "OVM:0.0"),
    terminateSession: vi.fn(async () => undefined),
    sendCommand: vi.fn(async () => ({ blocked: false })),
    capturePane: vi.fn(async () => {
      const result = captureList[captureCallCount] ?? (captureList[captureList.length - 1] ?? "");
      captureCallCount++;
      return result;
    })
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
      "overmind: Read /home/agjrom/TGBOTS/AGJAssist/plan/overmind/OVM_OPERATOR_PRIMER.md and operate as the Overmind operator per it. OVERMIND_TOKEN=ovm-test-token. Reply 'ready' when you've read it.",
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
      sendCommand: vi.fn(async () => ({ blocked: false })),
      capturePane: vi.fn(async () => "")
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

describe("OvmSessionService.sendAndAwaitReply — reply extraction", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

it("returns cleaned reply when OVM pane stabilises before sync timeout", async () => {
    // before: initial pane; after: pane with reply + chrome that should be stripped.
    // The stable pane must NOT contain "esc to interrupt" — that would make hasActiveTurn()
    // return true and prevent stable reads from advancing.
    const before = "ready";
    const afterWithChrome = [
      "ready",
      "hello OVM",
      "[1mHere is the OVM reply.[0m", // ANSI bold — should be stripped
      "\u256d─────╮",  // box chrome — should be stripped
      "> ",                 // prompt chrome — should be stripped
      "cwd: /home/agjrom", // cwd line — should be stripped
    ].join("\r\n");

    // capturePane: pre-send → changed → stable read 1 → stable read 2 (exits loop)
    const captures = [
      before,          // pre-send
      afterWithChrome, // poll 1: changed → bestReply updated
      afterWithChrome, // poll 2: stable read 1
      afterWithChrome, // poll 3: stable read 2 → loop exits
    ];
    const tmux = mockTmux(true, captures);
    const manager = service(tmux);

    const resultPromise = manager.sendAndAwaitReply("hello OVM");
    // 700ms × 3 polls = 2100ms — advance past all three polls
    await vi.advanceTimersByTimeAsync(3_000);
    const result = await resultPromise;

    expect(result.pending).toBe(false);
    if (!result.pending) {
      expect(result.reply).toBe("Here is the OVM reply.");
    }
  });

    it("returns { pending: true } while hasActiveTurn is active, then reply via getReply", async () => {
    // The pane with 'esc to interrupt' makes hasActiveTurn return true
    const before = "ready";
    const activePane = "ready\r\nWorking on it\r\nesc to interrupt";
    const donePaneWithReply = "ready\r\nhello OVM\r\nAll done now.";

    // capturePane calls:
    // 0: before (sendAndAwaitReply pre-send capture)
    // 1..N: polling — keep returning activePane so pollUntilDone keeps running
    // getReply call: returns donePaneWithReply (turn no longer active)
    const tmux: OvmTmuxService = {
      sessionExists: vi.fn(async () => true),
      createSession: vi.fn(async () => "OVM:0.0"),
      terminateSession: vi.fn(async () => undefined),
      sendCommand: vi.fn(async () => ({ blocked: false })),
      capturePane: vi.fn()
        .mockResolvedValueOnce(before)          // pre-send
        .mockResolvedValue(activePane)          // all polls see activePane (hasActiveTurn=true → no stable)
    };

    const manager = service(tmux);

    // sendAndAwaitReply should return { pending: true } after the 28s sync timeout
    const sendPromise = manager.sendAndAwaitReply("hello OVM");

    // Advance past the sync timeout (OVM_SEND_SYNC_TIMEOUT_MS = 28_000)
    await vi.advanceTimersByTimeAsync(29_000);
    const sendResult = await sendPromise;

    expect(sendResult.pending).toBe(true);

    // Now simulate OVM finishing: capturePane for getReply returns the done pane
    (tmux.capturePane as ReturnType<typeof vi.fn>).mockResolvedValueOnce(donePaneWithReply);

    const replyResult = await manager.getReply();
    expect(replyResult?.pending).toBe(false);
    if (replyResult && !replyResult.pending) {
      expect(replyResult.reply).toBe("All done now.");
    }
  });

  it("getReply returns null when no in-flight send is active", async () => {
    const tmux = mockTmux(true);
    const manager = service(tmux);

    const result = await manager.getReply();
    expect(result).toBeNull();
  });
});
