import { spawn } from "node:child_process";

export interface AgentCliRunner {
  runClaude(prompt: string, options: { model?: "opus" | "sonnet" | "haiku"; timeoutMs: number; cwd?: string }): Promise<string>;
  runCodex(prompt: string, options: { timeoutMs: number; cwd?: string }): Promise<string>;
}

function cleanOutput(stdout?: string, stderr?: string): string {
  const joined = [stdout?.trim(), stderr?.trim()].filter(Boolean).join("\n").trim();
  return joined || "<no output>";
}

interface CliExecFailure extends Error {
  stdout?: string;
  stderr?: string;
  code?: number | null;
  signal?: NodeJS.Signals | null;
  timedOut?: boolean;
}

function truncate(value: string, max = 1200): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...`;
}

function buildExitError(
  provider: string,
  command: string,
  args: string[],
  code: number | null,
  signal: NodeJS.Signals | null,
  stdout: string,
  stderr: string
): CliExecFailure {
  const output = cleanOutput(stdout, stderr);
  const details = output === "<no output>" ? "" : `\nOutput: ${truncate(output)}`;
  const codeInfo = code !== null ? `exit code ${code}` : `signal ${signal || "unknown"}`;
  const error = new Error(
    `${provider} CLI exited with ${codeInfo} while running '${command} ${args.join(" ")}'.${details}`
  ) as CliExecFailure;
  error.stdout = stdout;
  error.stderr = stderr;
  error.code = code;
  error.signal = signal;
  return error;
}

function runCliCommand(
  provider: string,
  command: string,
  args: string[],
  timeoutMs: number,
  cwd?: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;

    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env,
      cwd: cwd || undefined
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);

      if (timedOut) {
        const timeoutError = new Error(
          `${provider} request timed out after ${Math.floor(timeoutMs / 1000)}s`
        ) as CliExecFailure;
        timeoutError.stdout = stdout;
        timeoutError.stderr = stderr;
        timeoutError.code = code;
        timeoutError.signal = signal;
        timeoutError.timedOut = true;
        reject(timeoutError);
        return;
      }

      if (code !== 0) {
        reject(buildExitError(provider, command, args, code, signal, stdout, stderr));
        return;
      }

      resolve(cleanOutput(stdout, stderr));
    });
  });
}

function normalizeCliError(provider: string, error: unknown, timeoutMs: number): Error {
  if ((error as CliExecFailure)?.timedOut) {
    return new Error(`${provider} request timed out after ${Math.floor(timeoutMs / 1000)}s`);
  }

  const message = error instanceof Error ? error.message : String(error);
  if (/timed out|timeout|ETIMEDOUT/i.test(message)) {
    return new Error(`${provider} request timed out after ${Math.floor(timeoutMs / 1000)}s`);
  }
  if (/ENOENT|not found/i.test(message)) {
    return new Error(`${provider} CLI not found in PATH`);
  }
  return new Error(`${provider} CLI error: ${message}`);
}

export class DefaultAgentCliRunner implements AgentCliRunner {
  constructor(
    private readonly claudePath = process.env.CLAUDE_CLI_PATH || "claude",
    private readonly codexPath = process.env.CODEX_CLI_PATH || "codex"
  ) {}

  async runClaude(
    prompt: string,
    options: { model?: "opus" | "sonnet" | "haiku"; timeoutMs: number; cwd?: string }
  ): Promise<string> {
    const args = ["-p", "--dangerously-skip-permissions"];
    if (options.model) {
      args.push("--model", options.model);
    }
    args.push(prompt);

    try {
      return await runCliCommand("Claude", this.claudePath, args, options.timeoutMs, options.cwd);
    } catch (error) {
      throw normalizeCliError("Claude", error, options.timeoutMs);
    }
  }

  async runCodex(prompt: string, options: { timeoutMs: number; cwd?: string }): Promise<string> {
    const args = ["exec", "--skip-git-repo-check", "--sandbox", "danger-full-access", prompt];

    try {
      return await runCliCommand("Codex", this.codexPath, args, options.timeoutMs, options.cwd);
    } catch (error) {
      throw normalizeCliError("Codex", error, options.timeoutMs);
    }
  }
}
