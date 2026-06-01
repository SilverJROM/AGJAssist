import { execFile } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { classifyAgentPaneText, isAgentPane, type AgentPaneKind } from "../src/services/overmind/agent-pane.js";

const execFileAsync = promisify(execFile);
const OVERMIND_SH = "/home/agjrom/.claude/agents/lib/overmind.sh";
const PREFIX = `agj-b12b-${process.pid}`;
const createdSessions: string[] = [];

const textFixtures: Array<{ name: string; text: string; expected: Exclude<AgentPaneKind, "no-session"> }> = [
  { name: "claude-version", text: "Claude Code v1.2.3\n", expected: "claude" },
  { name: "claude-footer", text: "bypass permissions on\nfor agents\n↓ to manage\n", expected: "claude" },
  { name: "claude-command", text: "claude --dangerously-skip-permissions --model opus\n", expected: "claude" },
  { name: "codex-title", text: "OpenAI Codex\n", expected: "codex" },
  { name: "codex-command", text: "codex --dangerously-bypass --model gpt-5\n", expected: "codex" },
  { name: "codex-composer", text: "▌ Type a message\n", expected: "codex" },
  { name: "bare-bash", text: "agjrom@test-host:~/work$ \n", expected: "bare-bash" },
  { name: "agent-before-ps1", text: "OpenAI Codex\nagjrom@test-host:~/work$ \n", expected: "codex" },
  { name: "unknown", text: "plain monitor output with no agent markers\n", expected: "unknown" }
];

async function tmuxAvailable(): Promise<boolean> {
  try {
    await execFileAsync("tmux", ["-V"]);
    return true;
  } catch {
    return false;
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

async function createSeededSession(name: string, text: string): Promise<string> {
  const session = `${PREFIX}-${name}`;
  const command = `printf '%s' ${shellQuote(text)}; sleep 300`;
  await execFileAsync("tmux", ["new-session", "-d", "-s", session, command]);
  createdSessions.push(session);
  await delay(100);
  return session;
}

async function createBareBashSession(): Promise<string> {
  const session = `${PREFIX}-real-bare-bash`;
  await execFileAsync("tmux", [
    "new-session",
    "-d",
    "-s",
    session,
    "env PS1='agjrom@test-host:~/work$ ' bash --noprofile --norc -i"
  ]);
  createdSessions.push(session);
  await delay(100);
  return session;
}

async function bashIsAgentPane(session: string): Promise<string> {
  const { stdout } = await execFileAsync("bash", [
    "-lc",
    `source "${OVERMIND_SH}"; is_agent_pane "$1"`,
    "bash-is-agent-pane",
    session
  ]);
  return stdout.trim();
}

afterAll(async () => {
  await Promise.all(createdSessions.map(async (session) => {
    try {
      await execFileAsync("tmux", ["kill-session", "-t", session]);
    } catch {
      // Best-effort cleanup for sessions already gone.
    }
  }));
});

describe("agent pane classifier", () => {
  it("classifies R11.1 pane text patterns in TypeScript", () => {
    for (const fixture of textFixtures) {
      expect(classifyAgentPaneText(fixture.text), fixture.name).toBe(fixture.expected);
    }
  });

  it("keeps Bash and TypeScript in parity for the same seeded tmux pane content", async () => {
    if (!(await tmuxAvailable())) {
      throw new Error("tmux is required for overmind agent-pane parity tests");
    }

    for (const fixture of textFixtures) {
      const session = await createSeededSession(fixture.name, fixture.text);
      await expect(isAgentPane(session), fixture.name).resolves.toBe(fixture.expected);
      await expect(bashIsAgentPane(session), fixture.name).resolves.toBe(fixture.expected);
    }
  });

  it("classifies a real interactive PS1-only tmux pane as bare-bash in both implementations", async () => {
    if (!(await tmuxAvailable())) {
      throw new Error("tmux is required for overmind agent-pane parity tests");
    }

    const session = await createBareBashSession();
    await expect(isAgentPane(session)).resolves.toBe("bare-bash");
    await expect(bashIsAgentPane(session)).resolves.toBe("bare-bash");
  });

  it("returns no-session in both implementations for a missing tmux session", async () => {
    const session = `${PREFIX}-missing`;
    await expect(isAgentPane(session)).resolves.toBe("no-session");
    await expect(bashIsAgentPane(session)).resolves.toBe("no-session");
  });
});
