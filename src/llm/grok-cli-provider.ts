import { spawn } from "node:child_process";
import { ChatMessage, LlmProvider } from "./base-provider.js";

function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  return env;
}

function runGrokCli(
  prompt: string,
  timeoutMs: number,
  cwd?: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const args: string[] = [
      "-p",
      prompt,
      "--output-format",
      "text",
      "--always-approve",
    ];

    const child = spawn("grok", args, {
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
        reject(new Error(`Grok CLI timed out after ${Math.floor(timeoutMs / 1000)}s`));
        return;
      }
      if (code !== 0) {
        const errMsg = stderr.trim().slice(0, 500) || `exit code ${code}`;
        reject(new Error(`Grok CLI error: ${errMsg}`));
        return;
      }
      const output = stdout.trim();
      if (!output && stderr.trim()) {
        reject(new Error(`Grok CLI error: ${stderr.trim().slice(0, 500)}`));
        return;
      }
      if (!output) {
        reject(new Error("Grok CLI returned empty output"));
        return;
      }
      resolve(output);
    });

    // Close stdin (prompt is passed via -p arg)
    child.stdin.end();
  });
}

/**
 * Grok CLI provider.
 * Runs `grok -p <prompt> --output-format text --always-approve`.
 * Prompt is passed as CLI argument (not stdin).
 */
export class GrokCliProvider implements LlmProvider {
  readonly name = "grok";

  constructor(
    private readonly timeoutMs: number = 120_000
  ) {}

  /**
   * Serialize the full conversation history into a single prompt string.
   * Reuses exact shape from claude-cli-provider.ts.
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

  async chat(messages: ChatMessage[], maxTokens?: number): Promise<string> {
    const prompt = this.buildPrompt(messages);
    return runGrokCli(prompt, this.timeoutMs);
  }
}
