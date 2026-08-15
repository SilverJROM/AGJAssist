import { describe, expect, it } from "vitest";
import {
  applyAgentPatch,
  appendYou,
  buildInitialFriendlyState,
  capTerminalOutput,
  cleanTerminalOutput,
  diffTerminalOutput,
  extractStatus,
  formatFriendlyTerminalOutput,
  normalizeTerminalOutput,
  tailTerminalOutput
} from "../../src/web/public/terminal-chat-state.js";

describe("terminal chat state", () => {
  it("normalizes terminal output line endings", () => {
    expect(normalizeTerminalOutput("a\r\nb\r\n")).toBe("a\nb");
  });

  it("diffs appended terminal output", () => {
    expect(diffTerminalOutput("one\ntwo", "one\ntwo\nthree")).toBe("three");
  });

  it("returns only the requested last lines", () => {
    expect(tailTerminalOutput("1\n2\n3\n4", 2)).toBe("3\n4");
  });

  it("caps persisted output to the requested number of lines", () => {
    expect(capTerminalOutput("1\n2\n3\n4", 3)).toBe("2\n3\n4");
  });

  it("formats friendly output in terminal order using the requested tail", () => {
    expect(formatFriendlyTerminalOutput("1\n2\n3\n4", 3)).toBe("2\n3\n4");
  });

  it("prefers live tmux output over stale saved transcript entries", () => {
    const state = buildInitialFriendlyState({
      target: "agj-7:0.0",
      sessionName: "AGJ-7",
      liveOutput: "live terminal prompt\n$ ",
      savedState: {
        snapshot: "old internal debug text\nline 2",
        entries: [
          {
            id: "old-1",
            role: "terminal",
            label: "Latest output",
            content: "old internal debug text",
            timestamp: "12:00:00 AM"
          }
        ],
        updatedAt: Date.now() - 60_000
      },
      now: Date.now()
    });

    expect(state.snapshot).toBe("live terminal prompt\n$");
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0].content).toContain("live terminal prompt");
    expect(state.entries[0].content).not.toContain("old internal debug text");
  });

  describe("cleanTerminalOutput", () => {
    it("strips ANSI escape sequences", () => {
      expect(cleanTerminalOutput("\x1b[39mhello\x1b[0m world")).toBe("hello world");
    });

    it("drops Claude-Code TUI chrome lines", () => {
      const input = "actual output line\nbypass permissions · shift+tab to cycle\nmore real output";
      const result = cleanTerminalOutput(input);
      expect(result).toContain("actual output line");
      expect(result).toContain("more real output");
      expect(result).not.toContain("bypass permissions");
    });

    it("drops composer prompt lines starting with ❯", () => {
      const input = "some output\n❯ typed text here\nfollowing line";
      const result = cleanTerminalOutput(input);
      expect(result).not.toContain("❯");
      expect(result).toContain("some output");
    });

    it("drops horizontal rule lines", () => {
      const input = "content\n────────────────────\nmore content";
      const result = cleanTerminalOutput(input);
      expect(result).not.toMatch(/^[─=]{3,}$/m);
      expect(result).toContain("content");
    });

    it("preserves C4 Working telemetry and drops leftover interrupt chrome", () => {
      const input = "Working (3s)\nreal line\nesc to interrupt";
      const result = cleanTerminalOutput(input);
      expect(result).toContain("Working (3s)");
      expect(result).toContain("real line");
      expect(result).not.toContain("esc to interrupt");
    });

    it("strips C1–C3 shape classes and keeps C4 telemetry", () => {
      const input = [
        "Agent baseline from the live poll.",
        "⏵⏵ bypass permissions on · ctrl+t",
        "▌ Type a message",
        "Working… (5s · esc to interrupt)",
        "gpt-5.3-codex · ~/TGBOTS/AGJAssist",
        "┌──────────────────────────────┐",
        "│ Type a message               │",
        "└──────────────────────────────┘",
        "Tip: try /compact after a long turn",
        "Drizzling… (7m 38s · 22.9k tokens · xhigh effort)"
      ].join("\n");
      const result = cleanTerminalOutput(input);
      expect(result).toContain("Agent baseline from the live poll.");
      expect(result).toContain("Working… (5s · esc to interrupt)");
      expect(result).toContain("Drizzling… (7m 38s · 22.9k tokens · xhigh effort)");
      expect(result).not.toContain("bypass permissions");
      expect(result).not.toContain("⏵⏵");
      expect(result).not.toContain("ctrl+t");
      expect(result).not.toContain("▌");
      expect(result).not.toContain("Type a message");
      expect(result).not.toContain("gpt-5.3-codex");
      expect(result).not.toContain("~/TGBOTS/AGJAssist");
      expect(result).not.toContain("Tip:");
      expect(result).not.toMatch(/[┌┐└┘│]/u);
    });

    it("strips C3 model-name · ~/ even when the footer also names tokens or effort", () => {
      expect(cleanTerminalOutput("gpt-5.3-codex · ~/TGBOTS/AGJAssist · xhigh effort")).toBe("");
      expect(cleanTerminalOutput("gpt-5.3-codex · ~/TGBOTS/AGJAssist · 22.9k tokens")).toBe("");
      expect(cleanTerminalOutput("grok-4.6 · ~/TGBOTS/AGJAssist · xhigh effort")).toBe("");
      expect(cleanTerminalOutput("Drizzling… (7m 38s · 22.9k tokens · xhigh effort)")).toBe(
        "Drizzling… (7m 38s · 22.9k tokens · xhigh effort)"
      );
    });

    it("does not treat this app's composer placeholder as CLI chrome", () => {
      const input = "Type a terminal command…\nreal agent line";
      const result = cleanTerminalOutput(input);
      expect(result).toContain("Type a terminal command…");
      expect(result).toContain("real agent line");
    });

    it("keeps prose that merely mentions tokens or ~/src", () => {
      const input = [
        "Count the tokens in the last reply.",
        "See notes · ~/src for the patch.",
        "The compile wrote artifacts under ~/src."
      ].join("\n");
      const result = cleanTerminalOutput(input);
      expect(result).toContain("Count the tokens in the last reply.");
      expect(result).toContain("See notes · ~/src for the patch.");
      expect(result).toContain("The compile wrote artifacts under ~/src.");
    });

    it("strips a contiguous rounded composer box", () => {
      const input = [
        "kept above",
        "╭──────────────────────────────╮",
        "inner composer chrome",
        "╰──────────────────────────────╯",
        "kept below"
      ].join("\n");
      const result = cleanTerminalOutput(input);
      expect(result).toContain("kept above");
      expect(result).toContain("kept below");
      expect(result).not.toContain("inner composer chrome");
      expect(result).not.toMatch(/[╭╰]/u);
    });

    it("strips OSC sequences", () => {
      expect(cleanTerminalOutput("\x1b]0;title\x07hello")).toBe("hello");
    });

    it("returns empty string for empty input", () => {
      expect(cleanTerminalOutput("")).toBe("");
      expect(cleanTerminalOutput(null as unknown as string)).toBe("");
    });
  });

  it("resumes a recent transcript when the live output extends the saved snapshot", () => {
    const now = Date.now();
    const state = buildInitialFriendlyState({
      target: "agj-7:0.0",
      sessionName: "AGJ-7",
      liveOutput: "line 1\nline 2\nline 3",
      savedState: {
        snapshot: "line 1\nline 2",
        entries: [
          {
            id: "old-1",
            role: "terminal",
            label: "Recent output",
            content: "line 1\nline 2",
            timestamp: "12:00:00 AM"
          }
        ],
        updatedAt: now - 10_000
      },
      now
    });

    expect(state.entries).toHaveLength(2);
    expect(state.entries[1].content).toBe("line 3");
  });
});

describe("conversation render-model helpers", () => {
  const COMMAND = "fence hello from the phone";
  const INITIAL = [
    "Agent baseline from the live poll.",
    "⏵⏵ bypass permissions on · ctrl+t",
    "▌ Type a message",
    "Working… (5s · esc to interrupt)",
    "gpt-5.3-codex · ~/TGBOTS/AGJAssist",
    "┌──────────────────────────────┐",
    "│ Type a message               │",
    "└──────────────────────────────┘"
  ].join("\n");
  const AFTER_SEND = [
    INITIAL,
    COMMAND,
    "Agent follow-up from the next live poll.",
    "Drizzling… (7m 38s · 22.9k tokens · xhigh effort)"
  ].join("\n");

  it("extracts the latest C4 status and ignores C1–C3 plus token prose", () => {
    expect(extractStatus(INITIAL)).toBe("Working… (5s · esc to interrupt)");
    expect(extractStatus(AFTER_SEND)).toBe("Drizzling… (7m 38s · 22.9k tokens · xhigh effort)");
    expect(extractStatus("⏵⏵ bypass permissions on · ctrl+t")).toBe("");
    expect(extractStatus("gpt-5.3-codex · ~/TGBOTS/AGJAssist · xhigh effort")).toBe("");
    expect(extractStatus("Count the tokens in the last reply.")).toBe("");
  });

  it("appends YOU from sent text without restamping prior turns", () => {
    const seed = applyAgentPatch([], INITIAL, { now: 1_700_000_000_000 });
    const next = appendYou(seed, `  ${COMMAND}  `, { now: 1_700_000_001_000 });
    expect(next).toHaveLength(2);
    expect(next[0]).toBe(seed[0]);
    expect(next[1]).toMatchObject({
      id: "you-1700000001000",
      role: "user",
      label: "You",
      content: COMMAND
    });
    expect(next[1].timestamp).toBe(new Date(1_700_000_001_000).toLocaleTimeString());
    expect(appendYou(next, "   ")).toBe(next);
  });

  it("patches the last AGENT in place and opens a new AGENT only after YOU", () => {
    const t0 = 1_700_000_000_000;
    const first = applyAgentPatch([], INITIAL, { now: t0 });
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      id: "agent-1700000000000",
      role: "agent",
      content: "Agent baseline from the live poll."
    });
    expect(first[0].content).not.toContain("Working…");
    expect(first[0].content).not.toContain("bypass permissions");

    const statusTick = applyAgentPatch(first, INITIAL.replace("5s", "6s"), { now: t0 + 1000 });
    expect(statusTick).toBe(first);
    expect(statusTick[0].id).toBe(first[0].id);
    expect(statusTick[0].timestamp).toBe(first[0].timestamp);

    const withYou = appendYou(first, COMMAND, { now: t0 + 2000 });
    const stillWaiting = applyAgentPatch(withYou, INITIAL, { now: t0 + 2500 });
    expect(stillWaiting).toBe(withYou);

    const after = applyAgentPatch(withYou, AFTER_SEND, { now: t0 + 3000 });
    expect(after).toHaveLength(3);
    expect(after[0].id).toBe(first[0].id);
    expect(after[0].timestamp).toBe(first[0].timestamp);
    expect(after[1].id).toBe("you-1700000002000");
    expect(after[2]).toMatchObject({
      id: "agent-1700000003000",
      role: "agent",
      content: "Agent follow-up from the next live poll."
    });
    expect(after[2].content).not.toContain("Agent baseline");
    expect(after[2].content).not.toContain(COMMAND);
    expect(after[2].content).not.toContain("Drizzling");

    const nextPoll = applyAgentPatch(after, AFTER_SEND, { now: t0 + 4000 });
    expect(nextPoll).toBe(after);
    expect(nextPoll[2].id).toBe(after[2].id);
    expect(nextPoll[2].timestamp).toBe(after[2].timestamp);
  });

  it("keeps prior turn ids when the capture tail ages out", () => {
    const t0 = 1_700_000_010_000;
    let entries = applyAgentPatch([], "old-agent-turn-one\nline-a", { now: t0 });
    entries = appendYou(entries, "hello", { now: t0 + 1000 });
    entries = applyAgentPatch(
      entries,
      "old-agent-turn-one\nline-a\nhello\nline-1\nline-2\nline-3",
      { now: t0 + 2000 }
    );
    const priorIds = entries.map((entry) => entry.id);
    const priorTimes = entries.map((entry) => entry.timestamp);

    const aged = applyAgentPatch(entries, "hello\nline-1\nline-2\nline-3\nline-4", { now: t0 + 3000 });
    expect(aged.map((entry) => entry.id)).toEqual(priorIds);
    expect(aged.map((entry) => entry.timestamp)).toEqual(priorTimes);
    expect(aged[0].content).toContain("old-agent-turn-one");
    expect(aged[1].content).toBe("hello");
    expect(aged[2].content).toBe("line-1\nline-2\nline-3\nline-4");
    expect(aged).toHaveLength(3);
  });
});
