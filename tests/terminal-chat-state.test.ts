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
});
