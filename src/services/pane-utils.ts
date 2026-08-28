import { createHash } from "node:crypto";

export function hashPane(pane: string): string {
  return createHash("sha256").update(extractBody(pane)).digest("hex");
}

export function hasActiveTurn(pane: string): boolean {
  const statusBarChromeRe = /ctrl\+t|bypass permissions|to manage|for agents|\bshells?\b|\bmonitors?\b|shift\+tab/i;
  return pane
    .replace(/\r\n/g, "\n")
    .split("\n")
    .some((line) => /esc to interrupt/i.test(line) && !statusBarChromeRe.test(line));
}

export function hasBusySignal(pane: string): boolean {
  return hasActiveTurn(pane) || /Working \(|Worked for\s+/i.test(pane);
}

export function extractBody(pane: string): string {
  const lines = pane
    .replace(/\r\n/g, "\n")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .split("\n")
    .filter((line) => !isPaneChromeLine(line));
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  return lines.join("\n");
}

export function isPaneChromeLine(line: string): boolean {
  const trimmed = line.trim();
  const spinnerGlyphs = "◦•✻✶✢●○⎿⠋⠙⠹⠸⠼⠴⠦⠇⠏⣾⣽⣻⢿⡿⣟⣯⣷";
  const leadingSpinnerRe = new RegExp(`^\\s*[${spinnerGlyphs}]`, "u");
  const statusChromeRe = /bypass permissions|ctrl\+t|to manage|for agents|\/ps to view|\/stop|\bshells?\b|\bmonitors?\b|\/model/i;
  const modelFooterRe = /^\s*(gpt-5|sonnet|opus|haiku|claude)\b.*[·•]\s*~\//i;
  const cwdFooterRe = /[·•]\s*~\/\S*\s*$/;
  const turnChromeRe = /esc to interrupt|Working \(|Waiting for|Compacting|Thinking/i;
  return trimmed !== "" && (
    /^[❯›]/u.test(trimmed)
    || /^[─=]{3,}$/.test(trimmed)
    || leadingSpinnerRe.test(line)
    || statusChromeRe.test(line)
    || modelFooterRe.test(line)
    || cwdFooterRe.test(line)
    || turnChromeRe.test(line)
  );
}
