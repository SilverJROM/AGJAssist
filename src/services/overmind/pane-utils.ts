import { createHash } from "node:crypto";

// Pure tmux-pane text utilities — no DB, no tmux, no IO. Extracted from
// overmind-watcher.ts in batch B2 of the modularization refactor (2026-05-23).
// Behavior must remain byte-identical to the in-watcher originals; tests live in
// tests/overmind-pane-utils.test.ts and tests/overmind-classifier.test.ts.

/** Stable content hash of a pane snapshot — ignores chrome/spinner lines so the
 *  hash only changes when real body text changes. */
export function hashPane(pane: string): string {
  return createHash("sha256").update(extractBody(pane)).digest("hex");
}

/** True if the pane shows an "esc to interrupt" marker on a non-chrome line —
 *  i.e. the agent is in the middle of a generation turn. The footer status bar
 *  carries the same phrase as help text, so we mask those lines. */
export function hasActiveTurn(pane: string): boolean {
  const statusBarChromeRe = /ctrl\+t|bypass permissions|to manage|for agents|\bshells?\b|\bmonitors?\b|shift\+tab/i;
  return pane
    .replace(/\r\n/g, "\n")
    .split("\n")
    .some((line) => /esc to interrupt/i.test(line) && !statusBarChromeRe.test(line));
}

/** Spark-compatible busy signal: a real active-turn marker, a codex/Claude
 *  Working timer, or a final Worked-for marker still visible in the pane. */
export function hasBusySignal(pane: string): boolean {
  return hasActiveTurn(pane) || /Working \(|Worked for\s+/i.test(pane);
}

/** Strips ANSI + trailing blank lines + recognised chrome lines (spinners, the
 *  status bar, model footer, cwd footer, turn-indicator lines) and returns the
 *  remaining body the agent actually wrote. */
export function extractBody(pane: string): string {
  const lines = pane
    .replace(/\r\n/g, "\n")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .split("\n")
    .filter((line) => !isPaneChromeLine(line));

  while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
    lines.pop();
  }

  return lines.join("\n");
}

/** Predicate used by extractBody to drop UI chrome (spinner glyphs, the
 *  "bypass permissions" footer line, model/cwd footers, the "Working (Ns)"
 *  turn indicator, divider rules, the trailing `❯` or `›` prompt cursor). */
export function isPaneChromeLine(line: string): boolean {
  const trimmed = line.trim();
  const spinnerGlyphs = "◦•✻✶✢●○⎿⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⣾⣽⣻⢿⡿⣟⣯⣷";
  const leadingSpinnerRe = new RegExp(`^\\s*[${spinnerGlyphs}]`, "u");
  const statusChromeRe = /bypass permissions|ctrl\+t|to manage|for agents|\/ps to view|\/stop|\bshells?\b|\bmonitors?\b|\/model/i;
  const modelFooterRe = /^\s*(gpt-5|sonnet|opus|haiku|claude)\b.*[·•]\s*~\//i;
  const cwdFooterRe = /[·•]\s*~\/\S*\s*$/;
  const turnChromeRe = /esc to interrupt|Working \(|Waiting for|Compacting|Thinking/i;

  return trimmed === "" ? false
    : /^[❯›]/u.test(trimmed)
      || /^[─=]{3,}$/.test(trimmed)
      || leadingSpinnerRe.test(line)
      || statusChromeRe.test(line)
      || modelFooterRe.test(line)
      || cwdFooterRe.test(line)
      || turnChromeRe.test(line);
}
