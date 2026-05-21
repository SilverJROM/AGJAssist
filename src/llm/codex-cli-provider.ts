import { spawn } from "node:child_process";
import { ChatMessage, LlmProvider } from "./base-provider.js";

function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  return env;
}

function runCodexCli(
  args: string[],
  prompt: string,
  timeoutMs: number,
  cwd?: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("codex", args, {
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
        reject(new Error(`Codex CLI timed out after ${Math.floor(timeoutMs / 1000)}s`));
        return;
      }
      if (code !== 0) {
        const errMsg = stderr.trim().slice(0, 500) || `exit code ${code}`;
        reject(new Error(`Codex CLI error: ${errMsg}`));
        return;
      }
      const output = stdout.trim();
      if (!output && stderr.trim()) {
        reject(new Error(`Codex CLI error: ${stderr.trim().slice(0, 500)}`));
        return;
      }
      if (!output) {
        reject(new Error("Codex CLI returned empty output"));
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
 * OpenAI Codex CLI provider.
 * Pipes the prompt via stdin to `codex exec -`.
 * Supports session resumption via `codex exec resume <sessionId> -`.
 */
export class CodexCliProvider implements LlmProvider {
  readonly name = "codex";
  private model: string = "codex-default";

  constructor(
    private readonly timeoutMs: number = 180_000
  ) {}

  getModel(): string {
    return this.model;
  }

  setModel(model: string): void {
    this.model = model;
  }

  private buildPrompt(messages: ChatMessage[]): string {
    const systemMsg = messages.find(m => m.role === "system");
    const conversationMsgs = messages.filter(m => m.role !== "system");

    let prompt = "";
    if (systemMsg) prompt += systemMsg.content + "\n\n";

    if (conversationMsgs.length > 1) {
      prompt += "Previous conversation:\n";
      for (let i = 0; i < conversationMsgs.length - 1; i++) {
        const msg = conversationMsgs[i];
        const label = msg.role === "user" ? "User" : "Assistant";
        prompt += `${label}: ${msg.content}\n`;
      }
      prompt += "\n";
    }

    const lastMsg = conversationMsgs[conversationMsgs.length - 1];
    if (!lastMsg) throw new Error("No prompt content found in messages");
    prompt += `User: ${lastMsg.content}`;

    return prompt;
  }

  private buildArgs(subcommand: "new" | "resume", sessionId?: string): string[] {
    const modelArgs = this.model !== "codex-default" ? ["--model", this.model] : [];
    if (subcommand === "resume" && sessionId) {
      return ["exec", "resume", sessionId, "--skip-git-repo-check", ...modelArgs, "-"];
    }
    return ["exec", "--skip-git-repo-check", ...modelArgs, "-"];
  }

  async chat(messages: ChatMessage[], maxTokens?: number, sessionId?: string, cwd?: string): Promise<string> {
    const prompt = this.buildPrompt(messages);
    const args = sessionId
      ? this.buildArgs("resume", sessionId)
      : this.buildArgs("new");

    const output = await runCodexCli(args, prompt, this.timeoutMs, cwd);
    return this.stripHeader(output);
  }

  /**
   * Run codex and capture session ID from output header.
   */
  async chatWithSession(messages: ChatMessage[], maxTokens?: number, sessionId?: string, cwd?: string): Promise<{ content: string; sessionId: string | null }> {
    const prompt = this.buildPrompt(messages);
    const args = sessionId
      ? this.buildArgs("resume", sessionId)
      : this.buildArgs("new");

    const output = await runCodexCli(args, prompt, this.timeoutMs, cwd);
    const parsedSessionId = this.extractSessionId(output);
    const content = this.stripHeader(output);

    return { content, sessionId: parsedSessionId };
  }

  private extractSessionId(output: string): string | null {
    const match = output.match(/session id:\s*([0-9a-f-]+)/i);
    return match ? match[1] : null;
  }

  private stripHeader(output: string): string {
    const lines = output.split("\n");
    let contentStart = 0;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("--------")) {
        for (let j = i + 1; j < lines.length; j++) {
          const trimmed = lines[j].trim();
          if (trimmed === "" || /^(workdir|model|provider|approval|sandbox|reasoning|session id):/i.test(trimmed)) {
            contentStart = j + 1;
          } else {
            contentStart = j;
            break;
          }
        }
        break;
      }
    }

    return lines.slice(contentStart).join("\n").trim();
  }
}
