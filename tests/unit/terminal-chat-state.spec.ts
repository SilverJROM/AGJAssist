import { describe, expect, it } from "vitest";
import {
  applyAgentPatch,
  appendYou,
  buildInitialFriendlyState,
  capTerminalOutput,
  cleanTerminalOutput,
  detectSelectionPrompt,
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

describe("FIX11 YOU-echo-anchor never-freeze", () => {
  const SENT = "hello agent";

  it("FREEZE REPRO: zero sliding-overlap after a YOU send still opens an agent turn from the echoed command", () => {
    const t0 = 1_700_000_400_000;
    const oldReply = "OLD-REPLY-ABOVE-THE-ECHO";
    const first = applyAgentPatch([], oldReply, { now: t0 });
    const withYou = appendYou(first, SENT, { now: t0 + 1000, sentContent: SENT });

    // Send-time baseline has ZERO sliding overlap with the repainted window.
    // Cleaned current does NOT start with any baseline suffix (reordered/rewrapped top).
    const baselineAtSend = [
      "BASE-LINE-ONE-UNIQUE",
      "BASE-LINE-TWO-UNIQUE",
      "BASE-LINE-THREE-UNIQUE"
    ].join("\n");
    const current = [
      "REWRAP-TOP-ALPHA",
      "REWRAP-TOP-BETA",
      oldReply,
      SENT,
      "AGENT-REPLY-LINE-1",
      "AGENT-REPLY-LINE-2",
      "Working… (3s · esc to interrupt)"
    ].join("\n");

    expect(diffTerminalOutput(baselineAtSend, current)).toBe("");

    const after = applyAgentPatch(withYou, current, {
      now: t0 + 2000,
      baselineAtSend
    });
    expect(after).toHaveLength(3);
    expect(after[2]).toMatchObject({
      id: "agent-1700000402000",
      role: "agent"
    });
    const body = after[2].content;
    expect(body).toContain("AGENT-REPLY-LINE-1");
    expect(body).toContain("AGENT-REPLY-LINE-2");
    expect(body).not.toContain(oldReply);
    expect(body).not.toContain(SENT);
    expect(body).not.toContain("Working…");
    expect(body).not.toContain("REWRAP-TOP-ALPHA");
  });

  it("grows the agent turn across polls via the YOU-echo anchor", () => {
    const t0 = 1_700_000_410_000;
    const oldReply = "OLD-REPLY-ABOVE-THE-ECHO";
    const first = applyAgentPatch([], oldReply, { now: t0 });
    const withYou = appendYou(first, SENT, { now: t0 + 1000, sentContent: SENT });
    const baselineAtSend = [
      "BASE-LINE-ONE-UNIQUE",
      "BASE-LINE-TWO-UNIQUE",
      "BASE-LINE-THREE-UNIQUE"
    ].join("\n");
    const poll1 = [
      "REWRAP-TOP-ALPHA",
      "REWRAP-TOP-BETA",
      oldReply,
      SENT,
      "AGENT-REPLY-LINE-1",
      "AGENT-REPLY-LINE-2"
    ].join("\n");
    const opened = applyAgentPatch(withYou, poll1, { now: t0 + 2000, baselineAtSend });
    expect(opened[2].content).toBe("AGENT-REPLY-LINE-1\nAGENT-REPLY-LINE-2");

    const poll2 = [
      "REWRAP-TOP-GAMMA",
      oldReply,
      SENT,
      "AGENT-REPLY-LINE-1",
      "AGENT-REPLY-LINE-2",
      "AGENT-REPLY-LINE-3"
    ].join("\n");
    const grown = applyAgentPatch(opened, poll2, {
      now: t0 + 3000,
      previousSnapshot: poll1
    });
    expect(grown).toHaveLength(3);
    expect(grown[2].id).toBe(opened[2].id);
    expect(grown[2].timestamp).toBe(opened[2].timestamp);
    expect(grown[2].content).toBe("AGENT-REPLY-LINE-1\nAGENT-REPLY-LINE-2\nAGENT-REPLY-LINE-3");
    expect(grown[2].content).not.toContain(oldReply);
    expect(grown[2].content).not.toContain(SENT);
  });

  it("falls back to a non-empty body when the YOU echo is missing from the snapshot", () => {
    const t0 = 1_700_000_420_000;
    const oldReply = "OLD-REPLY-ABOVE-THE-ECHO";
    const first = applyAgentPatch([], oldReply, { now: t0 });
    const withYou = appendYou(first, SENT, { now: t0 + 1000, sentContent: SENT });
    const baselineAtSend = [
      "BASE-LINE-ONE-UNIQUE",
      "BASE-LINE-TWO-UNIQUE",
      "BASE-LINE-THREE-UNIQUE"
    ].join("\n");
    const current = [
      "REWRAP-TOP-ALPHA",
      "REWRAP-TOP-BETA",
      "AGENT-FALLBACK-LINE-1",
      "AGENT-FALLBACK-LINE-2"
    ].join("\n");

    expect(current.split("\n")).not.toContain(SENT);
    expect(diffTerminalOutput(baselineAtSend, current)).toBe("");

    const after = applyAgentPatch(withYou, current, {
      now: t0 + 2000,
      baselineAtSend
    });
    expect(after.length).toBeGreaterThan(withYou.length);
    const body = after[after.length - 1].content;
    expect(body.trim()).not.toBe("");
    expect(body).toContain("AGENT-FALLBACK-LINE-1");
    expect(body).toContain("AGENT-FALLBACK-LINE-2");
  });
});

describe("FIX11 adversarial validation (sonnet5 independent) — wrapped echo + false anchor", () => {
  const OLD_REPLY = "OLD-REPLY-ABOVE-THE-ECHO";

  it("WRAPPED-ECHO: a long single-line send that the pane echoes as several wrapped rows still opens the agent turn (does not freeze)", () => {
    const t0 = 1_700_000_500_000;
    const first = applyAgentPatch([], OLD_REPLY, { now: t0 });

    // A realistic long composer send: >200 chars plus an [image: ...] reference.
    // sanitizeOutgoingCommand flattens it to ONE line (no \n) before it's ever sent,
    // but tmux `capture-pane -p` does NOT rejoin visually-wrapped rows (no -J), so the
    // pane echo of this one logical line is split across several physical capture lines.
    // None of those physical lines is individually equal to the full sent text, so the
    // exact-line echo anchor (`_lastEchoLineIndex`) cannot find it.
    const longCommand =
      "please walk through the entire authentication refactor end to end, covering the " +
      "session store, the token refresh path, retry policy, and rollout plan in detail " +
      "[image: /tmp/screenshot-auth-flow-2026-08-16.png]";
    const sent = sanitizeOutgoingCommand(longCommand).trim();
    expect(sent).not.toContain("\n");
    expect(sent.length).toBeGreaterThan(200);

    const withYou = appendYou(first, longCommand, { now: t0 + 1000, sentContent: sent });

    // Simulate the pane wrapping the echoed logical line at a terminal width of 80 cols.
    const wrapWidth = 80;
    const wrappedEcho = [];
    for (let i = 0; i < sent.length; i += wrapWidth) wrappedEcho.push(sent.slice(i, i + wrapWidth));
    expect(wrappedEcho.length).toBeGreaterThanOrEqual(2);
    // Confirm the adversarial premise: no single wrapped row equals the full sent text.
    for (const row of wrappedEcho) expect(row).not.toBe(sent);

    // The send-time baseline has ZERO sliding overlap with the repainted window (TUI repaint).
    const baselineAtSend = ["BASE-LINE-ONE-UNIQUE", "BASE-LINE-TWO-UNIQUE", "BASE-LINE-THREE-UNIQUE"].join("\n");
    const current = [OLD_REPLY, ...wrappedEcho, "AGENT-REPLY-LINE-1", "AGENT-REPLY-LINE-2"].join("\n");
    expect(diffTerminalOutput(baselineAtSend, current)).toBe("");

    const after = applyAgentPatch(withYou, current, { now: t0 + 2000, baselineAtSend });

    // Primary requirement: the chat must NOT freeze — a new agent turn is created and it
    // contains the reply lines that follow the wrapped echo.
    expect(after).toHaveLength(3);
    const body = after[2].content;
    expect(body).toContain("AGENT-REPLY-LINE-1");
    expect(body).toContain("AGENT-REPLY-LINE-2");

    // Secondary quality bar: the prior agent turn must not bleed into the new one, and the
    // user's own (wrapped) echoed command must not leak into the visible AGENT bubble.
    expect(body).not.toContain(OLD_REPLY);
    expect(body).not.toContain(sent);
    for (const row of wrappedEcho) expect(body).not.toContain(row);
  });

  it("FALSE-ANCHOR: an agent reply that quotes the sent command verbatim must not truncate the reply at the quoted line", () => {
    const t0 = 1_700_000_600_000;
    const SENT = "hello agent";
    const first = applyAgentPatch([], OLD_REPLY, { now: t0 });
    const withYou = appendYou(first, SENT, { now: t0 + 1000, sentContent: SENT });

    // The reply legitimately restates the user's command verbatim on its own line
    // (e.g. "You asked: hello agent") partway through a longer reply. `_lastEchoLineIndex`
    // anchors on the LAST line equal to `sent`, which is this quoted line, not the real
    // pane echo — so real reply content written BEFORE the quote is at risk of being cut.
    const current = [
      OLD_REPLY,
      SENT, // real pane echo of the user's send
      "AGENT-REPLY-LINE-1 important analysis",
      "AGENT-REPLY-LINE-2 more analysis",
      "AGENT-REPLY-LINE-3 conclusion building",
      SENT, // reply quotes the command again verbatim -> false anchor candidate
      "AGENT-REPLY-LINE-4 final remark"
    ].join("\n");
    const baselineAtSend = ["BASE-LINE-ONE-UNIQUE", "BASE-LINE-TWO-UNIQUE"].join("\n");

    const after = applyAgentPatch(withYou, current, { now: t0 + 2000, baselineAtSend });
    expect(after).toHaveLength(3);
    const body = after[2].content;

    expect(body).toContain("AGENT-REPLY-LINE-1 important analysis");
    expect(body).toContain("AGENT-REPLY-LINE-2 more analysis");
    expect(body).toContain("AGENT-REPLY-LINE-3 conclusion building");
    expect(body).toContain("AGENT-REPLY-LINE-4 final remark");
    expect(body).not.toContain(OLD_REPLY);
  });
});

describe("FIX12 adversarial validation (sonnet5 final gate) — first-occurrence anchor + wrapped-run fallback", () => {
  it("REPEAT-SEND: the same command sent again must not anchor on the earlier turn's stale echo and pull the prior reply into the new turn", () => {
    // grok46's fix12 replaced the LAST-occurrence echo anchor with a FIRST-occurrence
    // anchor (_firstEchoLineIndex) to fix the FALSE-ANCHOR case above. But if the user
    // sends the exact same command text twice, the first echo is now the STALE one from
    // the earlier turn, still present in the deep capture above the current turn's echo.
    const t0 = 1_700_000_700_000;
    const SENT = "hello agent";

    const first = applyAgentPatch([], "PRE-EXISTING-CONTEXT", { now: t0 });
    let entries = appendYou(first, SENT, { now: t0 + 1000, sentContent: SENT });
    const snapshotTurn1 = ["PRE-EXISTING-CONTEXT", SENT, "TURN1-REPLY-LINE"].join("\n");
    entries = applyAgentPatch(entries, snapshotTurn1, {
      now: t0 + 2000,
      baselineAtSend: "PRE-EXISTING-CONTEXT"
    });
    expect(entries).toHaveLength(3);
    expect(entries[2].content).toBe("TURN1-REPLY-LINE");

    // Second turn: SAME command text again. The pane still shows the old echo + old
    // reply above the new echo + new reply (nothing has scrolled off).
    entries = appendYou(entries, SENT, { now: t0 + 3000, sentContent: SENT });
    const snapshotTurn2 = [snapshotTurn1, SENT, "TURN2-REPLY-LINE"].join("\n");
    entries = applyAgentPatch(entries, snapshotTurn2, {
      now: t0 + 4000,
      baselineAtSend: snapshotTurn1
    });

    expect(entries).toHaveLength(5);
    const body = entries[4].content;
    expect(body).toContain("TURN2-REPLY-LINE");
    expect(body).not.toContain("TURN1-REPLY-LINE");
  });

  it("PREFIX-FRAGMENT: a genuine short reply line that happens to be a text-prefix of the sent command must not be stripped by _stripSentPrefixFragments", () => {
    // _stripSentPrefixFragments (the fallback-path cleanup added alongside
    // _findWrappedEchoRun) drops any line whose trimmed text is a PREFIX of the sent
    // command — intended to mop up leftover partial-wrap echo fragments. But it applies
    // to ANY line satisfying that shape, including a legitimate short reply line (e.g. a
    // one-word heading) that simply happens to start the same way as the command.
    const t0 = 1_700_000_800_000;
    const OLD_REPLY = "OLD-REPLY-ABOVE-THE-ECHO";
    const SENT = "Deploy the staging build";

    const first = applyAgentPatch([], OLD_REPLY, { now: t0 });
    const withYou = appendYou(first, SENT, { now: t0 + 1000, sentContent: SENT });

    // Echo is fully scrolled off / absent from this capture window (zero overlap with
    // baselineAtSend), so both echo anchors miss and the fallback+prefix-strip path runs.
    const baselineAtSend = ["BASE-LINE-ONE-UNIQUE", "BASE-LINE-TWO-UNIQUE", "BASE-LINE-THREE-UNIQUE"].join(
      "\n"
    );
    const current = [
      "REWRAP-TOP-ALPHA",
      "REWRAP-TOP-BETA",
      "Deploy", // genuine one-word reply heading — also a prefix of SENT
      "Deploying to staging now...",
      "Build pushed successfully."
    ].join("\n");

    expect(current.split("\n")).not.toContain(SENT);
    expect(diffTerminalOutput(baselineAtSend, current)).toBe("");

    const after = applyAgentPatch(withYou, current, { now: t0 + 2000, baselineAtSend });
    expect(after).toHaveLength(3);
    const body = after[2].content;

    expect(body).toContain("Deploying to staging now...");
    expect(body).toContain("Build pushed successfully.");
    expect(body.split("\n")).toContain("Deploy");
  });
});

describe("FIX14 tail-anchor against the REAL Claude TUI pane format", () => {
  const COUNTER = "21:30:11 [10/1805]";
  const OLD_MARKER = "UNIQUE-OLD-REPLY-ALPHA";
  const REPLY_1 = "I found the tail and the cut is after your message";
  const REPLY_2 = "The new reply continues on this indented wrap";
  const REPLY_3 = "And a third line of the new reply";
  const REAL_CHROME = [
    "────────────────────────────────────────",
    "⏵⏵ bypass permissions on (shift+tab to cycle)",
    "Working (3s)",
    "› "
  ];

  function wrapAt(text: string, width: number): string[] {
    const lines: string[] = [];
    for (let i = 0; i < text.length; i += width) lines.push(text.slice(i, i + width));
    return lines;
  }

  /** First physical line has the right-aligned counter painted OVER the text. */
  function clobberFirstLine(lines: string[], counter: string): string[] {
    const out = lines.slice();
    const first = out[0] || "";
    if (first.length >= counter.length) {
      out[0] = first.slice(0, first.length - counter.length) + counter;
    } else {
      out[0] = `${first}${" ".repeat(Math.max(1, 8))}${counter}`;
    }
    return out;
  }

  function realPane(opts: {
    oldReply: string[];
    userLines: string[];
    newReply: string[];
    chrome?: string[];
  }): string {
    return [
      ...opts.oldReply,
      "",
      ...opts.userLines,
      ...opts.newReply,
      ...(opts.chrome || REAL_CHROME)
    ].join("\n");
  }

  it("WRAPPED+CLOBBERED user box: 3 physical lines, counter overwrites line 1, ● reply kept, older ● reply excluded", () => {
    const t0 = 1_700_000_900_000;
    const sent =
      "please look over the last three agent replies in this pane and confirm that the proposed tail-anchor cut is correct for the wrapped user box then pls confirm";
    expect(sent).not.toContain("\n");

    const wrapWidth = 70;
    const wrapped = wrapAt(sent, wrapWidth);
    expect(wrapped.length).toBe(3);
    const userLines = clobberFirstLine(wrapped, COUNTER);
    expect(userLines).toHaveLength(3);
    expect(userLines[0]).toContain(COUNTER);
    expect(userLines[0]).not.toBe(sent);
    for (const row of userLines) expect(row).not.toBe(sent);
    // Head is clobbered so even a joined wrap cannot equal sentContent.
    expect(userLines.join("")).not.toBe(sent);
    expect(userLines.join(" ")).not.toBe(sent);
    // Tail of the last physical line survives.
    expect(userLines[userLines.length - 1]).toMatch(/pls confirm\s*$/);

    const oldReply = [
      `● Older analysis ${OLD_MARKER} from the previous turn`,
      "  continuation of the older reply that must not leak"
    ];
    const newReply = [
      `● ${REPLY_1}`,
      `  ${REPLY_2}`,
      `  ${REPLY_3}`
    ];

    const first = applyAgentPatch([], oldReply.join("\n"), { now: t0 });
    expect(first[0].content).toContain(OLD_MARKER);
    const withYou = appendYou(first, sent, { now: t0 + 1000, sentContent: sent });

    const baselineAtSend = ["BASE-LINE-ONE-UNIQUE", "BASE-LINE-TWO-UNIQUE", "BASE-LINE-THREE-UNIQUE"].join("\n");
    const current = realPane({ oldReply, userLines, newReply });
    expect(diffTerminalOutput(baselineAtSend, current)).toBe("");

    const after = applyAgentPatch(withYou, current, { now: t0 + 2000, baselineAtSend });
    expect(after).toHaveLength(3);
    const body = after[2].content;

    expect(body).toContain(REPLY_1);
    expect(body).toContain(REPLY_2);
    expect(body).toContain(REPLY_3);
    expect(body).toContain("●");
    expect(body).not.toContain(OLD_MARKER);
    expect(body).not.toContain("Older analysis");
    expect(body).not.toContain(COUNTER);
    expect(body).not.toContain("21:30:11");
    expect(body).not.toContain("[10/1805]");
    expect(body).not.toContain(sent);
    expect(body).not.toContain("pls confirm");
    expect(body).not.toContain("bypass permissions");
    expect(body).not.toContain("Working (3s)");
    for (const row of userLines) {
      const stripped = row.replace(/\b\d{2}:\d{2}:\d{2}\s+\[\d+\/\d+\]/g, "").trim();
      if (stripped) expect(body).not.toContain(stripped);
    }
  });

  it("SHORT-COMMAND: one physical line with the counter to the right, not overwriting", () => {
    const t0 = 1_700_000_910_000;
    const sent = "hello agent";
    const oldReply = [`● Older analysis ${OLD_MARKER}`, "  older wrap"];
    const userLines = [`${sent}                    ${COUNTER}`];
    expect(userLines[0]).not.toBe(sent);
    expect(userLines[0]).toContain(COUNTER);
    const newReply = [`● ${REPLY_1}`, `  ${REPLY_2}`, `  ${REPLY_3}`];

    const first = applyAgentPatch([], oldReply.join("\n"), { now: t0 });
    const withYou = appendYou(first, sent, { now: t0 + 1000, sentContent: sent });
    const current = realPane({ oldReply, userLines, newReply });
    const after = applyAgentPatch(withYou, current, {
      now: t0 + 2000,
      baselineAtSend: "BASE-LINE-ONE-UNIQUE\nBASE-LINE-TWO-UNIQUE"
    });

    expect(after).toHaveLength(3);
    const body = after[2].content;
    expect(body).toContain(REPLY_1);
    expect(body).toContain(REPLY_2);
    expect(body).toContain(REPLY_3);
    expect(body).not.toContain(OLD_MARKER);
    expect(body).not.toContain(COUNTER);
    expect(body).not.toContain(sent);
  });

  it("REPLY-QUOTES-THE-COMMAND: tail appears again inside the reply; cut stays at the real user box", () => {
    const t0 = 1_700_000_920_000;
    const sent =
      "please look over the last three agent replies in this pane and confirm that the proposed tail-anchor cut is correct for the wrapped user box then pls confirm";
    const wrapWidth = 70;
    const userLines = clobberFirstLine(wrapAt(sent, wrapWidth), COUNTER);
    expect(userLines.length).toBe(3);
    for (const row of userLines) expect(row).not.toBe(sent);

    const oldReply = [`● Older analysis ${OLD_MARKER}`];
    const quotedTail = "correct for the wrapped user box then pls confirm";
    const newReply = [
      `● ${REPLY_1}`,
      `  you wrote: ${quotedTail}`,
      `  ${REPLY_3}`
    ];

    const first = applyAgentPatch([], oldReply.join("\n"), { now: t0 });
    const withYou = appendYou(first, sent, { now: t0 + 1000, sentContent: sent });
    const current = realPane({ oldReply, userLines, newReply });
    const after = applyAgentPatch(withYou, current, {
      now: t0 + 2000,
      baselineAtSend: "BASE-LINE-ONE-UNIQUE\nBASE-LINE-TWO-UNIQUE"
    });

    expect(after).toHaveLength(3);
    const body = after[2].content;
    expect(body).toContain(REPLY_1);
    expect(body).toContain(quotedTail);
    expect(body).toContain(REPLY_3);
    expect(body).not.toContain(OLD_MARKER);
    expect(body).not.toContain(COUNTER);
    expect(body).not.toContain(userLines[0]);
  });

  it("REPLY-LONGER-THAN-CAPTURE: user box scrolled off; never freezes (fallback opens a non-empty agent turn)", () => {
    const t0 = 1_700_000_930_000;
    const sent =
      "please look over the last three agent replies in this pane and confirm that the proposed tail-anchor cut is correct for the wrapped user box then pls confirm";
    const oldReply = [`● Older analysis ${OLD_MARKER}`];
    const first = applyAgentPatch([], oldReply.join("\n"), { now: t0 });
    const withYou = appendYou(first, sent, { now: t0 + 1000, sentContent: sent });

    const longReply = Array.from({ length: 80 }, (_, i) =>
      i === 0 ? `● LONG-REPLY-HEAD-${i + 1}` : `  LONG-REPLY-TAIL-${i + 1}`
    );
    // Capture is only the last 12 reply lines — user box and echo tail are gone.
    const current = [...longReply.slice(-12), ...REAL_CHROME].join("\n");
    expect(current).not.toContain("pls confirm");
    expect(current).not.toContain(sent);
    const baselineAtSend = ["BASE-LINE-ONE-UNIQUE", "BASE-LINE-TWO-UNIQUE", "BASE-LINE-THREE-UNIQUE"].join("\n");
    expect(diffTerminalOutput(baselineAtSend, current)).toBe("");

    const after = applyAgentPatch(withYou, current, { now: t0 + 2000, baselineAtSend });
    expect(after.length).toBeGreaterThan(withYou.length);
    const body = after[after.length - 1].content;
    expect(body.trim()).not.toBe("");
    expect(body).toMatch(/LONG-REPLY-TAIL-\d+/);
    expect(body).not.toContain(COUNTER);
    expect(body).not.toContain("bypass permissions");
  });
});

describe("FIX15 sol real-format fixtures (raw ❯-run tail-anchor)", () => {
  const COUNTER = "21:30:11 [10/1805]";
  const OLD_MARKER = "UNIQUE-OLD-REPLY-ALPHA";
  const REPLY_1 = "Here is the retry policy summary.";
  const REPLY_2 = "Requests retry with exponential backoff, capped at five attempts";
  const REPLY_3 = "before surfacing a hard failure to the caller.";
  const REAL_CHROME = [
    "────────────────────────────────────────",
    "Working (3s)",
    "⏵⏵ bypass permissions on (shift+tab to cycle)",
    "› "
  ];
  const SCREENSHOT_SENT =
    "summarize the retry policy and the rollout plan for the auth refactor then scroll to the bottom it disappears pls confirm";

  function wrapAt(text: string, width: number): string[] {
    const lines: string[] = [];
    for (let i = 0; i < text.length; i += width) lines.push(text.slice(i, i + width));
    return lines;
  }

  function clobberFirstLine(lines: string[], counter: string): string[] {
    const out = lines.slice();
    const first = out[0] || "";
    if (first.length >= counter.length) {
      out[0] = first.slice(0, first.length - counter.length) + counter;
    } else {
      out[0] = `${first}${" ".repeat(Math.max(1, 8))}${counter}`;
    }
    return out;
  }

  /** Real Claude TUI user echo: ❯ on row 1, indented wraps, counter on row 1. */
  function userRunLines(sent: string, width: number, counter = COUNTER): string[] {
    const bodyWidth = Math.max(8, width - 2);
    const chunks = wrapAt(sent, bodyWidth);
    const rows = chunks.map((chunk, i) => (i === 0 ? `❯ ${chunk}` : `  ${chunk}`));
    return clobberFirstLine(rows, counter);
  }

  function padWrap(sent: string, firstWidth: number, contWidth: number): string[] {
    const rows: string[] = [];
    rows.push(`❯ ${sent.slice(0, firstWidth)}${" ".repeat(6)}`);
    let i = firstWidth;
    while (i < sent.length) {
      rows.push(`  ${sent.slice(i, i + contWidth)}${"\u00A0".repeat(2)}   `);
      i += contWidth;
    }
    return clobberFirstLine(rows, COUNTER);
  }

  function realPane(opts: {
    oldReply: string[];
    userLines: string[];
    newReply: string[];
    chrome?: string[];
    extraAbove?: string[];
  }): string {
    return [
      ...(opts.extraAbove || []),
      ...opts.oldReply,
      "",
      ...opts.userLines,
      ...opts.newReply,
      ...(opts.chrome || REAL_CHROME)
    ].join("\n");
  }

  function workingChrome(seconds: number): string[] {
    return [
      "────────────────────────────────────────",
      `Working (${seconds}s)`,
      "⏵⏵ bypass permissions on (shift+tab to cycle)",
      "› "
    ];
  }

  it("1. exact screenshot shape: ❯ wrap + counter + ● multi-paragraph; zero prior/echo/counter", () => {
    const t0 = 1_700_001_000_000;
    const sent = SCREENSHOT_SENT;
    const userLines = userRunLines(sent, 48);
    expect(userLines.length).toBeGreaterThanOrEqual(3);
    expect(userLines.length).toBeLessThanOrEqual(4);
    expect(userLines[0]).toMatch(/^❯ /);
    expect(userLines[0]).toContain(COUNTER);
    expect(userLines[1]).toMatch(/^\s{2}\S/);
    expect(userLines.join("")).not.toBe(sent);

    const oldReply = [
      `● Prior analysis of the auth refactor is complete. ${OLD_MARKER}`,
      "  continuation of the prior analysis."
    ];
    const newReply = [
      `● ${REPLY_1}`,
      "",
      REPLY_2,
      `${REPLY_3}`
    ];

    const first = applyAgentPatch([], oldReply.join("\n"), { now: t0 });
    const withYou = appendYou(first, sent, { now: t0 + 1000, sentContent: sent });
    const current = realPane({ oldReply, userLines, newReply });
    const after = applyAgentPatch(withYou, current, {
      now: t0 + 2000,
      baselineAtSend: "BASE-LINE-ONE-UNIQUE\nBASE-LINE-TWO-UNIQUE"
    });

    expect(after).toHaveLength(3);
    const body = after[2].content;
    expect(body).toContain(REPLY_1);
    expect(body).toContain(REPLY_2);
    expect(body).toContain(REPLY_3);
    expect(body).toContain("●");
    expect(body).not.toContain(OLD_MARKER);
    expect(body).not.toContain("Prior analysis");
    expect(body).not.toContain(COUNTER);
    expect(body).not.toContain("21:30:11");
    expect(body).not.toContain("[10/1805]");
    expect(body).not.toContain("pls confirm");
    expect(body).not.toContain("❯");
    expect(body).not.toContain(sent);
    expect(body).not.toContain("bypass permissions");
    expect(body).not.toContain("Working (3s)");
    for (const row of userLines) {
      const stripped = row.replace(/\b\d{2}:\d{2}:\d{2}\s+\[\d+\/\d+\]/g, "").replace(/^❯\s*/u, "").trim();
      if (stripped) expect(body).not.toContain(stripped);
    }
  });

  it("2. short-message pair: ❯ yes matches; counter-clobbered suffix must not false-anchor into reply", () => {
    const t0 = 1_700_001_010_000;
    const oldReply = [`● Older analysis ${OLD_MARKER}`, "  older wrap"];

    const yesSent = "yes";
    const yesUser = [`❯ yes                    ${COUNTER}`];
    const yesReply = [`● ${REPLY_1}`, `  ${REPLY_2}`];
    const yesPane = realPane({ oldReply, userLines: yesUser, newReply: yesReply });
    const yesEntries = appendYou(
      applyAgentPatch([], oldReply.join("\n"), { now: t0 }),
      yesSent,
      { now: t0 + 1000, sentContent: yesSent }
    );
    const yesAfter = applyAgentPatch(yesEntries, yesPane, {
      now: t0 + 2000,
      baselineAtSend: "BASE-LINE-ONE-UNIQUE\nBASE-LINE-TWO-UNIQUE"
    });
    expect(yesAfter).toHaveLength(3);
    expect(yesAfter[2].content).toContain(REPLY_1);
    expect(yesAfter[2].content).toContain(REPLY_2);
    expect(yesAfter[2].content).not.toContain(OLD_MARKER);
    expect(yesAfter[2].content).not.toContain("❯");
    expect(yesAfter[2].content).not.toMatch(/\byes\b/);

    const longSent = "please confirm the rollout window is next Tuesday morning for prod";
    const clobbered = clobberFirstLine([`❯ ${longSent}`], COUNTER);
    expect(clobbered[0]).toContain(COUNTER);
    expect(clobbered[0]).not.toContain("Tuesday morning");
    const quotedTail = "next Tuesday morning for prod";
    const replyPrefix = "I will confirm the window now:";
    const clobberReply = [
      `● ${replyPrefix}`,
      `  you wrote: ${quotedTail}`,
      `  ${REPLY_3}`
    ];
    const clobberPane = realPane({ oldReply, userLines: clobbered, newReply: clobberReply });
    const clobberEntries = appendYou(
      applyAgentPatch([], oldReply.join("\n"), { now: t0 + 3000 }),
      longSent,
      { now: t0 + 4000, sentContent: longSent }
    );
    const clobberAfter = applyAgentPatch(clobberEntries, clobberPane, {
      now: t0 + 5000,
      baselineAtSend: "BASE-LINE-ONE-UNIQUE\nBASE-LINE-TWO-UNIQUE"
    });
    expect(clobberAfter).toHaveLength(3);
    const body = clobberAfter[2].content;
    expect(body).toContain(replyPrefix);
    expect(body).toContain(quotedTail);
    expect(body).toContain(REPLY_3);
    expect(body).not.toContain(OLD_MARKER);
    expect(body).not.toContain(COUNTER);
    expect(body).not.toContain("❯");
  });

  it("3. tail crosses a wrap with indent + trailing padding, plus a pane-width-change replay", () => {
    const t0 = 1_700_001_020_000;
    const sent = SCREENSHOT_SENT;
    const oldReply = [`● Older analysis ${OLD_MARKER}`];
    const newReply = [`● ${REPLY_1}`, `  ${REPLY_2}`, `  ${REPLY_3}`];

    const narrow = padWrap(sent, 36, 34);
    expect(narrow.length).toBeGreaterThanOrEqual(3);
    expect(narrow[0]).toMatch(/^❯ /);
    expect(narrow[1]).toMatch(/^\s{2}/);
    expect(narrow.some((row) => /\s{2,}$/.test(row) || row.includes("\u00A0"))).toBe(true);

    const first = applyAgentPatch([], oldReply.join("\n"), { now: t0 });
    const withYou = appendYou(first, sent, { now: t0 + 1000, sentContent: sent });
    const snapNarrow = realPane({ oldReply, userLines: narrow, newReply });
    const afterNarrow = applyAgentPatch(withYou, snapNarrow, {
      now: t0 + 2000,
      baselineAtSend: "BASE-LINE-ONE-UNIQUE\nBASE-LINE-TWO-UNIQUE"
    });
    expect(afterNarrow).toHaveLength(3);
    expect(afterNarrow[2].content).toContain(REPLY_1);
    expect(afterNarrow[2].content).toContain(REPLY_2);
    expect(afterNarrow[2].content).toContain(REPLY_3);
    expect(afterNarrow[2].content).not.toContain("pls confirm");
    expect(afterNarrow[2].content).not.toContain(OLD_MARKER);

    const wide = padWrap(sent, 62, 58);
    expect(wide.length).toBeLessThan(narrow.length);
    const snapWide = realPane({ oldReply, userLines: wide, newReply: [...newReply, "  extra width-replay line"] });
    const afterWide = applyAgentPatch(afterNarrow, snapWide, {
      now: t0 + 3000,
      previousSnapshot: snapNarrow
    });
    expect(afterWide).toHaveLength(3);
    expect(afterWide[2].id).toBe(afterNarrow[2].id);
    expect(afterWide[2].content).toContain(REPLY_1);
    expect(afterWide[2].content).toContain("extra width-replay line");
    expect(afterWide[2].content).not.toContain("pls confirm");
    expect(afterWide[2].content).not.toContain(OLD_MARKER);
    expect((afterWide[2].content.match(new RegExp(REPLY_1.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length).toBe(1);
  });

  it("4. repeated/shared-tail: current ❯ run wins; reply prefix kept; prior reply not duplicated", () => {
    const t0 = 1_700_001_030_000;
    const sent = SCREENSHOT_SENT;
    const userLines = userRunLines(sent, 48);
    const oldReply = [`● Older analysis ${OLD_MARKER}`, "  continuation of the older reply"];
    const priorQuoted = [
      "● Prior turn already quoted the tail:",
      "  pls confirm",
      "  PRIOR-TURN-ONLY-LINE"
    ];
    const newPrefix = "NEW-REPLY-PREFIX-MUST-SURVIVE";
    const newReply = [
      `● ${newPrefix}`,
      "  the previous instruction ended with pls confirm",
      `  ${REPLY_3}`
    ];

    let entries = applyAgentPatch([], oldReply.join("\n"), { now: t0 });
    entries = appendYou(entries, sent, { now: t0 + 1000, sentContent: sent });
    const turn1 = realPane({ oldReply, userLines, newReply: priorQuoted });
    entries = applyAgentPatch(entries, turn1, {
      now: t0 + 2000,
      baselineAtSend: oldReply.join("\n")
    });
    expect(entries).toHaveLength(3);
    expect(entries[2].content).toContain("PRIOR-TURN-ONLY-LINE");

    entries = appendYou(entries, sent, { now: t0 + 3000, sentContent: sent });
    const turn2 = [turn1, ...userLines, ...newReply, ...REAL_CHROME].join("\n");
    entries = applyAgentPatch(entries, turn2, {
      now: t0 + 4000,
      baselineAtSend: turn1
    });

    expect(entries).toHaveLength(5);
    const body = entries[4].content;
    expect(body).toContain(newPrefix);
    expect(body).toContain("pls confirm");
    expect(body).toContain(REPLY_3);
    expect(body).not.toContain("PRIOR-TURN-ONLY-LINE");
    expect(body).not.toContain(OLD_MARKER);
    expect(body).not.toContain("❯");
    expect((body.match(/NEW-REPLY-PREFIX-MUST-SURVIVE/g) || []).length).toBe(1);
  });

  it("5. poll sequence: echo-only / Working / partial ● / 800+ row window never duplicates or freezes", () => {
    const t0 = 1_700_001_040_000;
    const sent = SCREENSHOT_SENT;
    const userLines = userRunLines(sent, 48);
    const oldReply = [`● Older analysis ${OLD_MARKER}`, "  continuation of the prior analysis."];
    const preSend = [...oldReply, ...workingChrome(0)].join("\n");

    let entries = applyAgentPatch([], preSend, { now: t0 });
    expect(entries).toHaveLength(1);
    entries = appendYou(entries, sent, { now: t0 + 1000, sentContent: sent });
    expect(entries).toHaveLength(2);

    const echoOnly = realPane({ oldReply, userLines, newReply: [], chrome: workingChrome(1) });
    entries = applyAgentPatch(entries, echoOnly, { now: t0 + 2000, baselineAtSend: preSend });
    expect(entries).toHaveLength(2);

    const ticking = realPane({ oldReply, userLines, newReply: [], chrome: workingChrome(2) });
    entries = applyAgentPatch(entries, ticking, {
      now: t0 + 3000,
      baselineAtSend: preSend,
      previousSnapshot: echoOnly
    });
    expect(entries).toHaveLength(2);

    const partialReply = [`● ${REPLY_1}`];
    const partial = realPane({ oldReply, userLines, newReply: partialReply, chrome: workingChrome(3) });
    entries = applyAgentPatch(entries, partial, {
      now: t0 + 4000,
      baselineAtSend: preSend,
      previousSnapshot: ticking
    });
    expect(entries).toHaveLength(3);
    expect(entries[2].content).toContain(REPLY_1);
    expect(entries[2].content).not.toContain(OLD_MARKER);

    const longReply = Array.from({ length: 820 }, (_, i) =>
      i === 0 ? `● ${REPLY_1}` : `  REPLY-LINE-${String(i + 1).padStart(4, "0")}`
    );
    const deepRows = [
      ...oldReply,
      "",
      ...userLines,
      ...longReply,
      ...workingChrome(12)
    ];
    expect(deepRows.length).toBeGreaterThan(800);
    const last800 = deepRows.slice(-800).join("\n");
    const last2000 = deepRows.slice(-2000).join("\n");
    expect(last800).not.toContain("❯");
    expect(last2000).toContain("❯");
    expect(last2000.split("\n").length).toBeGreaterThan(800);

    entries = applyAgentPatch(entries, last2000, {
      now: t0 + 5000,
      previousSnapshot: partial
    });
    expect(entries).toHaveLength(3);
    const body = entries[2].content;
    expect(body).toContain(REPLY_1);
    expect(body).toContain("REPLY-LINE-0820");
    expect(body).toContain("REPLY-LINE-0002");
    expect((body.match(new RegExp(REPLY_1.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length).toBe(1);
    expect(body).not.toContain(OLD_MARKER);
    expect(body).not.toContain("pls confirm");
    expect(body).not.toContain("❯");
    expect(body).not.toContain("Working (12s)");
    expect(body).not.toContain("bypass permissions");
  });
});

describe("detectSelectionPrompt", () => {
  it("parses a tool-permission dialog (boxed, ❯ cursor on option 1)", () => {
    const pane = [
      "● I'll run the build.",
      "╭──────────────────────────────────────────────╮",
      "│ Bash command                                 │",
      "│ npm run build                                │",
      "│                                              │",
      "│ Do you want to proceed?                      │",
      "│ ❯ 1. Yes                                     │",
      "│   2. Yes, and don't ask again this session   │",
      "│   3. No, and tell Claude what to do (esc)    │",
      "╰──────────────────────────────────────────────╯",
    ].join("\n");
    const sel = detectSelectionPrompt(pane);
    expect(sel).not.toBeNull();
    expect(sel!.options.map((o) => o.label)).toEqual([
      "Yes",
      "Yes, and don't ask again this session",
      "No, and tell Claude what to do (esc)",
    ]);
    expect(sel!.selectedIndex).toBe(0);
    expect(sel!.title).toMatch(/do you want to proceed/i);
  });

  it("parses an AskUserQuestion menu detected by its footer (no ❯ glyph)", () => {
    const pane = [
      "Which library should we use?",
      "  1. date-fns",
      "  2. dayjs",
      "  3. luxon",
      "",
      "Enter to select · ↑/↓ to navigate · Esc to cancel",
    ].join("\n");
    const sel = detectSelectionPrompt(pane);
    expect(sel).not.toBeNull();
    expect(sel!.options).toHaveLength(3);
    expect(sel!.options[1].label).toBe("dayjs");
    expect(sel!.selectedIndex).toBe(-1); // highlight is ANSI-only; footer confirms active
  });

  it("flags a multi-question / checkbox selection as multi", () => {
    const pane = [
      "Pick the features:",
      "  1. Minimize",
      "  2. Memory",
      "Enter to select · Tab to switch questions · Space to toggle",
    ].join("\n");
    const sel = detectSelectionPrompt(pane);
    expect(sel).not.toBeNull();
    expect(sel!.multi).toBe(true);
  });

  it("returns null for an ordinary numbered list in prose (no footer/cursor/question)", () => {
    const pane = [
      "● Here is the plan:",
      "  1. Read the file",
      "  2. Make the change",
      "  3. Run the tests",
      "Working (4s · esc to interrupt)",
    ].join("\n");
    expect(detectSelectionPrompt(pane)).toBeNull();
  });

  it("does NOT fire on a prose numbered list above the 'shift+tab to cycle' chrome (regression)", () => {
    // Reproduces the live false positive: the assistant printed a numbered plan,
    // and the CLI chrome line contains 'tab to cycle', which used to be read as a
    // selection footer.
    const pane = [
      "3. Multi-session tabs at the top",
      "",
      "A compact horizontal tab strip at the top of the Terminal.",
      "",
      "  1. Compact the Telegram layout + fix the top cutoff",
      "  2. Attachment -> minimal icon (no composer shrink)",
      "  3. Multi-session tabs at the top",
      "",
      "Confirm and I'll build it in that order.",
      "❯ confirmed, go ahead",
      "⏵⏵ bypass permissions on (shift+tab to cycle) · ctrl+t to hide tasks · ← 1 agent",
    ].join("\n");
    expect(detectSelectionPrompt(pane)).toBeNull();
  });

  it("does NOT fire when a real footer is far above the options (not bottom-anchored)", () => {
    const pane = [
      "Enter to select · ↑/↓ to navigate · Esc to cancel",
      "…many lines of unrelated output…",
      "some prose here",
      "more prose",
      "even more prose",
      "and more",
      "  1. Alpha",
      "  2. Bravo",
      "  3. Charlie",
      "❯ just a normal input line",
    ].join("\n");
    expect(detectSelectionPrompt(pane)).toBeNull();
  });

  it("returns null when there are fewer than two options", () => {
    const pane = ["Do you want to proceed?", "❯ 1. Yes"].join("\n");
    expect(detectSelectionPrompt(pane)).toBeNull();
  });

  it("ignores ANSI colour codes around the options", () => {
    const pane = [
      "Do you want to proceed?",
      "\x1b[36m❯ 1. Yes\x1b[0m",
      "\x1b[2m  2. No\x1b[0m",
    ].join("\n");
    const sel = detectSelectionPrompt(pane);
    expect(sel).not.toBeNull();
    expect(sel!.options.map((o) => o.label)).toEqual(["Yes", "No"]);
    expect(sel!.selectedIndex).toBe(0);
  });
});
