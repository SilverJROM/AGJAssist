import { spawn } from "node:child_process";
import { ChatMessage, LlmProvider } from "./base-provider.js";

function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  return env;
}

function runClaudeCli(
  args: string[],
  prompt: string,
  timeoutMs: number,
  cwd?: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: cleanEnv(),
      cwd: cwd || process.env.HOME || "/home/agjrom"
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`Claude CLI timed out after ${Math.floor(timeoutMs / 1000)}s`));
        return;
      }
      if (code !== 0) {
        const errMsg = stderr.trim().slice(0, 500) || `exit code ${code}`;
        reject(new Error(`Claude CLI error: ${errMsg}`));
        return;
      }
      const output = stdout.trim();
      if (!output && stderr.trim()) {
        reject(new Error(`Claude CLI error: ${stderr.trim().slice(0, 500)}`));
        return;
      }
      if (!output) {
        reject(new Error("Claude CLI returned empty output"));
        return;
      }
      resolve(output);
    });

    // Write prompt to stdin and close
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

/**
 * Claude Code CLI provider.
 * Runs `claude -p --model <model> -` and pipes the prompt via stdin.
 * Supports session resumption via --resume <sessionId>.
 */
export class ClaudeCliProvider implements LlmProvider {
  readonly name = "claude";

  constructor(
    private model: string = "sonnet",
    private readonly timeoutMs: number = 180_000
  ) {}

  getModel(): string {
    return this.model;
  }

  setModel(model: string): void {
    this.model = model;
  }

  /**
   * Serialize the full conversation history into a single prompt string.
   */
  private buildPrompt(messages: ChatMessage[]): string {
    const systemMsg = messages.find(m => m.role === "system");
    const conversationMsgs = messages.filter(m => m.role !== "system");

    if (conversationMsgs.length === 0) {
      throw new Error("No prompt content found in messages");
    }

    const lastMsg = conversationMsgs[conversationMsgs.length - 1];
    if (lastMsg.role !== "user") {
      throw new Error("Last message must be from the user");
    }

    const priorMsgs = conversationMsgs.slice(0, -1);

    let prompt = "";

    if (systemMsg) {
      prompt += systemMsg.content + "\n\n";
    }

    if (priorMsgs.length > 0) {
      prompt += "Previous conversation:\n";
      for (const msg of priorMsgs) {
        const label = msg.role === "user" ? "User" : "Assistant";
        prompt += `${label}: ${msg.content}\n`;
      }
      prompt += "\n";
    }

    prompt += `User: ${lastMsg.content}`;

    return prompt;
  }

  async chat(messages: ChatMessage[], maxTokens?: number, sessionId?: string, cwd?: string): Promise<string> {
    const prompt = this.buildPrompt(messages);

    const args: string[] = [
      "-p",
      "--model", this.model,
      "--output-format", "text",
      "--dangerously-skip-permissions",
    ];

    if (sessionId) {
      args.push("--resume", sessionId);
    }

    if (maxTokens) {
      args.push("--max-budget-usd", "0.50");
    }

    // Read from stdin
    args.push("-");

    return runClaudeCli(args, prompt, this.timeoutMs, cwd);
  }

  /**
   * Run claude with JSON output to capture session ID.
   */
  async chatWithSession(messages: ChatMessage[], maxTokens?: number, sessionId?: string, cwd?: string): Promise<{ content: string; sessionId: string | null }> {
    const prompt = this.buildPrompt(messages);

    const args: string[] = [
      "-p",
      "--model", this.model,
      "--output-format", "json",
      "--dangerously-skip-permissions",
    ];

    if (sessionId) {
      args.push("--resume", sessionId);
    }

    // Read from stdin
    args.push("-");

    const raw = await runClaudeCli(args, prompt, this.timeoutMs, cwd);

    let parsedSessionId: string | null = null;
    let content = raw;

    try {
      const json = JSON.parse(raw);
      content = json.result || json.content || json.text || raw;
      parsedSessionId = json.session_id || json.sessionId || null;
    } catch {
      // Not JSON — plain text output, no session ID extractable
    }

    return { content, sessionId: parsedSessionId };
  }
}
