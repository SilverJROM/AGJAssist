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
  sanitizeOutgoingCommand,
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

  it("seeds a post-YOU agent turn from the send-time snapshot diff, not exact prior-agent removal", () => {
    const t0 = 1_700_000_100_000;
    const baseline = [
      "The previous answer OLD-REPLY-LINE was wrapped",
      "across two pane lines in the capture."
    ].join("\n");
    const first = applyAgentPatch([], baseline, { now: t0 });
    // Pane reflow: stored AGENT text is no longer a verbatim block in the next capture.
    const reflowed = first.slice();
    reflowed[0] = {
      ...first[0],
      content: "The previous answer OLD-REPLY-LINE was wrapped across two pane lines in the capture."
    };
    const withYou = appendYou(reflowed, "next question", { now: t0 + 1000 });
    const current = `${baseline}\nNEW-REPLY-LINE`;

    const brittle = applyAgentPatch(withYou, current, { now: t0 + 2000 });
    expect(brittle[brittle.length - 1].content).toContain("OLD-REPLY-LINE");

    const after = applyAgentPatch(withYou, current, { now: t0 + 2000, baselineAtSend: baseline });
    expect(after).toHaveLength(3);
    expect(after[0].id).toBe(first[0].id);
    expect(after[1].content).toBe("next question");
    expect(after[2].content).toContain("NEW-REPLY-LINE");
    expect(after[2].content).not.toContain("OLD-REPLY-LINE");
    expect(after[2].content).not.toContain("next question");

    const grown = applyAgentPatch(
      after,
      `${baseline}\nNEW-REPLY-LINE\nANOTHER-LINE`,
      { now: t0 + 3000, baselineAtSend: baseline }
    );
    expect(grown[2].id).toBe(after[2].id);
    expect(grown[2].timestamp).toBe(after[2].timestamp);
    expect(grown[2].content).toBe("NEW-REPLY-LINE\nANOTHER-LINE");
    expect(grown[2].content).not.toContain("OLD-REPLY-LINE");
  });
});

describe("FIX A sliding-window overlap (fails on prefix-from-0 send-diff)", () => {
  it("diffs a sliding tail by suffix/prefix overlap, not prefix-from-0", () => {
    expect(diffTerminalOutput("A\nB\nC\nD\nE", "C\nD\nE\nN1\nN2")).toBe("N1\nN2");
  });

  it("returns empty on zero overlap instead of treating the whole after-window as new", () => {
    expect(diffTerminalOutput("A\nB\nC", "X\nY\nZ")).toBe("");
  });

  it("returns empty when after is fully contained in before", () => {
    expect(diffTerminalOutput("A\nB\nC\nD", "B\nC")).toBe("");
  });

  it("opens a post-YOU agent from a sliding capture tail: [A,B,C,D,E] -> [C,D,E,N1,N2] is only N1 and N2", () => {
    const t0 = 1_700_000_200_000;
    const baseline = ["A", "B", "C", "D", "E"].join("\n");
    const first = applyAgentPatch([], baseline, { now: t0 });
    const withYou = appendYou(first, "ask", { now: t0 + 1000 });
    const next = applyAgentPatch(withYou, ["C", "D", "E", "N1", "N2"].join("\n"), {
      now: t0 + 2000,
      baselineAtSend: baseline
    });
    const body = next[next.length - 1].content;
    expect(body).toBe("N1\nN2");
    expect(body).not.toContain("\nC\n");
    expect(body.split("\n")).not.toContain("C");
    expect(body.split("\n")).not.toContain("D");
    expect(body.split("\n")).not.toContain("E");
    expect(body.split("\n")).not.toContain("A");
    expect(body.split("\n")).not.toContain("B");
  });

  it("accumulates the first new paragraph after a full slide across two polls", () => {
    const t0 = 1_700_000_210_000;
    const baseline = Array.from({ length: 25 }, (_, i) => `OLD-${String(i + 1).padStart(2, "0")}`).join("\n");
    const first = applyAgentPatch([], baseline, { now: t0 });
    const withYou = appendYou(first, "go", { now: t0 + 1000 });
    const poll1 = [...baseline.split("\n").slice(5), "PARA-ONE-FIRST-LINE", "para-one-wrap"].join("\n");
    const after1 = applyAgentPatch(withYou, poll1, { now: t0 + 2000, baselineAtSend: baseline });
    expect(after1[after1.length - 1].content).toContain("PARA-ONE-FIRST-LINE");

    const poll2 = ["para-one-wrap", "PARA-TWO-FIRST-LINE", "para-two-wrap"].join("\n");
    const after2 = applyAgentPatch(after1, poll2, {
      now: t0 + 3000,
      baselineAtSend: baseline,
      previousSnapshot: poll1
    });
    const body = after2[after2.length - 1].content;
    expect(body).toContain("PARA-ONE-FIRST-LINE");
    expect(body).toContain("PARA-TWO-FIRST-LINE");
    expect(body).not.toMatch(/OLD-0[1-9]/);
  });

  it("does not replay leftover old-reply tail after a one-line slide of a full 25-line pane", () => {
    const t0 = 1_700_000_220_000;
    const baselineLines = Array.from({ length: 25 }, (_, i) => {
      if (i === 0) return "OLD-REPLY-HEAD";
      if (i === 20) return "OLD-REPLY-TAIL";
      return `B${String(i + 1).padStart(2, "0")}`;
    });
    const baseline = baselineLines.join("\n");
    const first = applyAgentPatch([], baseline, { now: t0 });
    const withYou = appendYou(first, "follow-up", { now: t0 + 1000 });
    const afterLines = [...baselineLines.slice(1), "follow-up", "NEW-ONLY-LINE"];
    const next = applyAgentPatch(withYou, afterLines.join("\n"), {
      now: t0 + 2000,
      baselineAtSend: baseline
    });
    const body = next[next.length - 1].content;
    expect(body).toContain("NEW-ONLY-LINE");
    expect(body).not.toContain("OLD-REPLY-HEAD");
    expect(body).not.toContain("OLD-REPLY-TAIL");
    expect(body).not.toContain("B02");
    expect(body).not.toContain("follow-up");
  });

  it("does not re-duplicate when a Working timer ticks mid-window on a slid capture", () => {
    const t0 = 1_700_000_230_000;
    const old = ["OLD-A", "OLD-B", "OLD-C", "OLD-D"];
    const snap5 = [...old, "Working… (5s · esc to interrupt)"].join("\n");
    const first = applyAgentPatch([], snap5, { now: t0 });
    const withYou = appendYou(first, "next", { now: t0 + 1000 });
    const snap6 = ["OLD-B", "OLD-C", "OLD-D", "Working… (6s · esc to interrupt)", "NEW-LINE"].join("\n");
    const opened = applyAgentPatch(withYou, snap6, { now: t0 + 2000, baselineAtSend: snap5 });
    const body = opened[opened.length - 1].content;
    expect(body).toContain("NEW-LINE");
    expect(body).not.toContain("OLD-A");
    expect(body).not.toContain("OLD-B");
    expect(body).not.toContain("OLD-C");
    expect(body).not.toContain("OLD-D");
    expect((body.match(/NEW-LINE/g) || []).length).toBe(1);

    const grownSnap = ["OLD-C", "OLD-D", "Working… (7s · esc to interrupt)", "NEW-LINE", "NEW-TWO"].join("\n");
    const grown = applyAgentPatch(opened, grownSnap, {
      now: t0 + 3000,
      baselineAtSend: snap5,
      previousSnapshot: snap6
    });
    const grownBody = grown[grown.length - 1].content;
    expect(grownBody).toBe("NEW-LINE\nNEW-TWO");
  });
});

describe("FIX B canonicalize + echo removal", () => {
  it("flattens every C0 control and DEL", () => {
    let raw = "ok";
    for (let c = 0; c <= 0x1f; c += 1) raw += String.fromCharCode(c);
    raw += `${String.fromCharCode(0x7f)}end`;
    const out = sanitizeOutgoingCommand(raw);
    expect(/[\u0000-\u001F\u007F]/.test(out)).toBe(false);
    expect(out.startsWith("ok")).toBe(true);
    expect(out.endsWith("end")).toBe(true);
  });

  it("treats control-only input as empty after canonicalize and trim", () => {
    const only = `${Array.from({ length: 32 }, (_, i) => String.fromCharCode(i)).join("")}\u007F`;
    expect(sanitizeOutgoingCommand(only).trim()).toBe("");
  });

  it("removes the flattened pane echo of a multi-line YOU send from the agent body", () => {
    const t0 = 1_700_000_240_000;
    const baseline = "old-agent";
    const display = "line one\nline two";
    const sent = sanitizeOutgoingCommand(display).trim();
    expect(sent).toBe("line one line two");
    const first = applyAgentPatch([], baseline, { now: t0 });
    const withYou = appendYou(first, display, { now: t0 + 1000, sentContent: sent });
    expect(withYou[withYou.length - 1].content).toBe(display);
    const next = applyAgentPatch(withYou, `${baseline}\n${sent}\nagent says hi`, {
      now: t0 + 2000,
      baselineAtSend: baseline
    });
    const body = next[next.length - 1].content;
    expect(body).toContain("agent says hi");
    expect(body).not.toContain("line one line two");
    expect(body).not.toContain("line one\nline two");
  });
});

describe("FIX C paragraph markers + long reply + anchored chrome", () => {
  it("keeps paragraph-first lines that start with content bullet markers", () => {
    const input = [
      "• First line of paragraph one",
      "continuation of paragraph one",
      "",
      "• First line of paragraph two",
      "continuation of paragraph two",
      "",
      "● Claude-style first line",
      "claude wrap"
    ].join("\n");
    const result = cleanTerminalOutput(input);
    expect(result).toContain("First line of paragraph one");
    expect(result).toContain("First line of paragraph two");
    expect(result).toContain("Claude-style first line");
    expect(result).toContain("continuation of paragraph one");
    expect(result).toMatch(/\n\n/);
  });

  it("renders a multi-paragraph bullet reply in the post-YOU agent turn", () => {
    const t0 = 1_700_000_250_000;
    const baseline = "pre-send-only";
    const reply = [
      "• First line of paragraph one",
      "continuation of paragraph one",
      "",
      "• First line of paragraph two",
      "continuation of paragraph two"
    ].join("\n");
    const withYou = appendYou(applyAgentPatch([], baseline, { now: t0 }), "q", { now: t0 + 1000 });
    const after = applyAgentPatch(withYou, `${baseline}\n${reply}`, {
      now: t0 + 2000,
      baselineAtSend: baseline
    });
    const body = after[after.length - 1].content;
    expect(body).toContain("First line of paragraph one");
    expect(body).toContain("First line of paragraph two");
    expect(body).toContain("continuation of paragraph one");
    expect(body).toContain("continuation of paragraph two");
  });

  it("keeps an active reply longer than 25 and 200 lines (no silent tail cap)", () => {
    const t0 = 1_700_000_260_000;
    const baseline = "pre-send-only";
    const withYou = appendYou(applyAgentPatch([], baseline, { now: t0 }), "q", { now: t0 + 1000 });
    const replyLines = Array.from({ length: 220 }, (_, i) => `REPLY-${i + 1}`);
    const after = applyAgentPatch(withYou, [baseline, ...replyLines].join("\n"), {
      now: t0 + 2000,
      baselineAtSend: baseline
    });
    const body = after[after.length - 1].content;
    const kept = body.split("\n").filter((line) => line.startsWith("REPLY-"));
    expect(kept).toHaveLength(220);
    expect(body).toContain("REPLY-1");
    expect(body).toContain("REPLY-220");
  });

  it("accumulates a 220-line reply delivered across sliding 25-line windows", () => {
    const t0 = 1_700_000_270_000;
    const baselineLines = Array.from({ length: 25 }, (_, i) => `OLD-${i + 1}`);
    const baseline = baselineLines.join("\n");
    const replyLines = Array.from({ length: 220 }, (_, i) => `REPLY-${i + 1}`);
    let entries = appendYou(applyAgentPatch([], baseline, { now: t0 }), "q", { now: t0 + 1000 });
    let prevSnap = baseline;
    const windowSize = 25;
    const pane = [...baselineLines];
    for (let i = 0; i < replyLines.length; i += 1) {
      pane.push(replyLines[i]);
      const snap = pane.slice(-windowSize).join("\n");
      const lastUser = entries.reduce((idx, e, i) => (e.role === "user" ? i : idx), -1);
      const lastAgent = entries.reduce((idx, e, i) => (e.role === "agent" ? i : idx), -1);
      const openNew = lastUser > lastAgent;
      entries = applyAgentPatch(entries, snap, {
        now: t0 + 2000 + i,
        baselineAtSend: openNew ? baseline : undefined,
        previousSnapshot: openNew ? undefined : prevSnap
      });
      prevSnap = snap;
    }
    const body = entries[entries.length - 1].content;
    const kept = body.split("\n").filter((line) => line.startsWith("REPLY-"));
    expect(kept).toHaveLength(220);
    expect(body).toContain("REPLY-1");
    expect(body).toContain("REPLY-220");
    expect(body).not.toMatch(/^OLD-/m);
    expect(body).not.toContain("OLD-1");
    expect(body).not.toContain("OLD-25");
  });

  it("keeps prose containing plan mode / for agents / to cycle", () => {
    const input = [
      "I will use plan mode for this change.",
      "This is for agents that need a review.",
      "Press enter to cycle through the options in the wizard."
    ].join("\n");
    const result = cleanTerminalOutput(input);
    expect(result).toContain("I will use plan mode for this change.");
    expect(result).toContain("This is for agents that need a review.");
    expect(result).toContain("Press enter to cycle through the options in the wizard.");
  });

  it("keeps a content line that mentions a box glyph and does not eat an unterminated round box", () => {
    expect(cleanTerminalOutput("Use the │ character in the table.")).toContain("Use the │ character");
    const unterminated = [
      "kept above",
      "╭── box start with no closer",
      "must not be eaten",
      "still kept"
    ].join("\n");
    const result = cleanTerminalOutput(unterminated);
    expect(result).toContain("kept above");
    expect(result).toContain("must not be eaten");
    expect(result).toContain("still kept");
  });
});

describe("FIX09 integration: realistic multi-paragraph CLI reply across a sliding capture window", () => {
  it("delivers a >200-line bulleted reply through many sliding, chrome-interleaved polls without truncation, first-line loss, or duplicating the prior turn", () => {
    const t0 = 1_700_000_300_000;
    const OLD_MARKER = "PRIOR-ANALYSIS-OF-THE-BUG";
    const oldContentLines = [`● ${OLD_MARKER}`, "continuation of the prior analysis."];
    const oldBaseline = oldContentLines.join("\n");

    let entries = applyAgentPatch([], oldBaseline, { now: t0 });
    expect(entries).toHaveLength(1);
    expect(entries[0].content).toContain(OLD_MARKER);

    entries = appendYou(entries, "explain in detail", { now: t0 + 1000 });

    const bulletGlyphs = ["•", "●", "◦", "○"];
    const paragraphCount = 60;
    const newLines = [];
    for (let p = 0; p < paragraphCount; p += 1) {
      const glyph = bulletGlyphs[p % bulletGlyphs.length];
      newLines.push(`${glyph} Paragraph ${p + 1} first line of the explanation`);
      newLines.push(`  continuation line A for paragraph ${p + 1}`);
      newLines.push(`  continuation line B for paragraph ${p + 1}`);
      newLines.push("");
    }
    // 60 paragraphs * 4 lines = 240 lines: past both the 25-line default window and the retired 200-line cap.
    expect(newLines.length).toBeGreaterThan(200);

    const windowSize = 25;
    const baselineAtSend = oldBaseline;
    const pane = [...oldContentLines];
    let prevSnap;
    for (let i = 0; i < newLines.length; i += 1) {
      pane.push(newLines[i]);
      const chrome = [
        "⏵⏵ bypass permissions on · ctrl+t",
        "▌ Type a message",
        `Working… (${i + 1}s · esc to interrupt)`
      ];
      const snap = pane.slice(-windowSize).concat(chrome).join("\n");
      const lastUser = entries.reduce((idx, e, j) => (e.role === "user" ? j : idx), -1);
      const lastAgent = entries.reduce((idx, e, j) => (e.role === "agent" ? j : idx), -1);
      const openNew = lastUser > lastAgent;
      entries = applyAgentPatch(entries, snap, {
        now: t0 + 2000 + i,
        baselineAtSend: openNew ? baselineAtSend : undefined,
        previousSnapshot: openNew ? undefined : prevSnap
      });
      prevSnap = snap;
    }

    expect(entries).toHaveLength(3);
    expect(entries[0].content).toContain(OLD_MARKER);
    expect(entries[1].content).toBe("explain in detail");

    const body = entries[entries.length - 1].content;

    for (let p = 0; p < paragraphCount; p += 1) {
      expect(body).toContain(`Paragraph ${p + 1} first line of the explanation`);
      expect(body).toContain(`continuation line A for paragraph ${p + 1}`);
      expect(body).toContain(`continuation line B for paragraph ${p + 1}`);
    }

    const survivingParagraphs = new Set(
      Array.from(body.matchAll(/Paragraph (\d+) first line/g)).map((m) => m[1])
    );
    expect(survivingParagraphs.size).toBe(paragraphCount);

    // The prior turn must not be duplicated underneath the new YOU/AGENT turn, and chrome must not leak in.
    expect(body).not.toContain(OLD_MARKER);
    expect(body).not.toContain("explain in detail");
    expect(body).not.toContain("Working…");
    expect(body).not.toContain("bypass permissions");
    expect(body).not.toContain("Type a message");
  });
});
