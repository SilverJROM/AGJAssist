import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type AgentPaneKind = "claude" | "codex" | "bare-bash" | "unknown" | "no-session";

const CLAUDE_AGENT_RE =
  /Claude Code v[0-9]|bypass permissions on|for agents|↓ to manage|Claude Max|claude --dangerously-skip-permissions|claude --model/;
const CODEX_AGENT_RE = /OpenAI Codex|codex --dangerously-bypass|gpt-5|▌/;
const BARE_BASH_RE = /^[a-z]+@[a-z-]+:/m;

export function classifyAgentPaneText(pane: string): Exclude<AgentPaneKind, "no-session"> {
  if (CLAUDE_AGENT_RE.test(pane)) return "claude";
  if (CODEX_AGENT_RE.test(pane)) return "codex";
  if (BARE_BASH_RE.test(pane)) return "bare-bash";
  return "unknown";
}

export async function isAgentPane(session: string): Promise<AgentPaneKind> {
  if (!session) return "no-session";

  try {
    await execFileAsync("tmux", ["has-session", "-t", session]);
  } catch {
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
