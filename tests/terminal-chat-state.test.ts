import { describe, expect, it } from "vitest";
import { formatTerminalOutput } from "../src/web/public/terminal-chat-state.js";

describe("formatTerminalOutput", () => {
  it("removes ANSI, collapses blank runs, and rejoins hard-wrapped prose", () => {
    const raw = [
      "\u001b[32mThis terminal paragraph was captured from a narrow tmux pane and",
      "continues on the next visual row before it should naturally wrap in the app.\u001b[0m   ",
      "",
      "",
      "A second paragraph remains separate."
    ].join("\r\n");

    const formatted = formatTerminalOutput(raw);

    expect(formatted).toBe([
      "This terminal paragraph was captured from a narrow tmux pane and continues on the next visual row before it should naturally wrap in the app.",
      "",
      "A second paragraph remains separate."
    ].join("\n"));
    expect(formatted).not.toContain("\u001b[32m");
    expect(formatted).not.toMatch(/\n{3,}/);
  });

  it("preserves structured blocks instead of flattening code, bullets, and tables", () => {
    const raw = [
      "Summary:",
      "- first finding should remain a list item",
      "- second finding should remain a list item",
      "",
      "function run() {",
      "  return true;",
      "}",
      "",
      "name | status",
      "B15  | running"
    ].join("\n");

    expect(formatTerminalOutput(raw)).toBe(raw);
  });

  it("strips C1–C3 chrome from a multi-CLI snapshot and keeps C4 status", () => {
    const raw = [
      "Agent baseline from the live poll.",
      "⏵⏵ bypass permissions on · ctrl+t",
      "▌ Type a message",
      "Working… (5s · esc to interrupt)",
      "gpt-5.3-codex · ~/TGBOTS/AGJAssist",
      "┌──────────────────────────────┐",
      "│ Type a message               │",
      "└──────────────────────────────┘",
      "Type a terminal command…",
      "Drizzling… (7m 38s · 22.9k tokens · xhigh effort)"
    ].join("\n");

    const formatted = formatTerminalOutput(raw);

    expect(formatted).toBe([
      "Agent baseline from the live poll.",
      "Working… (5s · esc to interrupt)",
      "Type a terminal command…",
      "Drizzling… (7m 38s · 22.9k tokens · xhigh effort)"
    ].join("\n"));
    expect(formatted).not.toContain("bypass permissions");
    expect(formatted).not.toContain("ctrl+t");
    expect(formatted).not.toContain("Type a message");
    expect(formatted).not.toContain("gpt-5.3-codex");
    expect(formatted).not.toMatch(/[┌┐]/u);
  });

  it("keeps prose mentioning tokens or ~/src and strips model-name · ~/ footers", () => {
    const raw = [
      "Count the tokens in the last reply.",
      "See notes · ~/src for the patch.",
      "gpt-5.3-codex · ~/TGBOTS/AGJAssist · xhigh effort",
      "grok-4.6 · ~/TGBOTS/AGJAssist · 22.9k tokens",
      "Drizzling… (7m 38s · 22.9k tokens · xhigh effort)"
    ].join("\n");

    expect(formatTerminalOutput(raw)).toBe([
      "Count the tokens in the last reply.",
      "See notes · ~/src for the patch.",
      "Drizzling… (7m 38s · 22.9k tokens · xhigh effort)"
    ].join("\n"));
  });
});
