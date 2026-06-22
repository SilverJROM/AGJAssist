import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type AgentPaneKind = "claude" | "codex" | "bare-bash" | "unknown" | "no-session";

const CLAUDE_AGENT_RE =
  /Claude Code v[0-9]|bypass permissions on|for agents|↓ to manage|Claude Max|claude --dangerously-skip-permissions|claude --model/;
const CODEX_AGENT_RE = /OpenAI Codex|codex --dangerously-bypass|gpt-5|▌/;
// "An interactive agent TUI is live here" — markers that persist even when the
// product banner has scrolled out of the captured window (agent busy/streaming).
const AGENT_ACTIVE_RE = /esc to interrupt|shift\+tab to cycle|ctrl\+c:cancel|⏵⏵|Ctrl\+\.:shortcuts/;
// A pane is a BARE shell ONLY when it is genuinely SITTING at a shell prompt:
// the LAST non-empty line is a prompt. A `user@host:` line buried in an agent
// pane's command-output scrollback must NOT count — that false read was orphaning
// live coordinators (JROM 2026-06-22, Helm run 74 flapping).
const SHELL_PROMPT_LASTLINE_RE = /^\s*[a-z_][a-z0-9_.-]*@[a-z0-9._-]+:[^\n]*[$#>]\s*$/i;

function lastNonEmptyLine(pane: string): string {
  const lines = pane.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() !== "") return lines[i];
  }
  return "";
}

function isMissingExecutableError(error: unknown): boolean {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT";
}

export function classifyAgentPaneText(pane: string): Exclude<AgentPaneKind, "no-session"> {
  if (CLAUDE_AGENT_RE.test(pane)) return "claude";
  if (CODEX_AGENT_RE.test(pane)) return "codex";
  // Live agent TUI whose identity banner has scrolled off → alive, never orphan.
  if (AGENT_ACTIVE_RE.test(pane)) return "unknown";
  // Bare shell ONLY if the pane is actually resting at a prompt (last line).
  if (SHELL_PROMPT_LASTLINE_RE.test(lastNonEmptyLine(pane))) return "bare-bash";
  return "unknown";
}

export async function isAgentPane(session: string): Promise<AgentPaneKind> {
  if (!session) return "no-session";

  try {
    await execFileAsync("tmux", ["has-session", "-t", session]);
  } catch (error) {
    if (isMissingExecutableError(error)) return "unknown";
    return "no-session";
  }

  try {
    const { stdout } = await execFileAsync("tmux", [
      "capture-pane",
      "-J",
      "-p",
      "-t",
      session,
      "-S",
      "-50"
    ]);
    return classifyAgentPaneText(stdout);
  } catch {
    return "unknown";
  }
}
