import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AppConfig } from "../config/config.js";
import { TmuxService } from "../tmux/tmux-service.js";

const execFileAsync = promisify(execFile);

export interface ToolAction {
  tool: string;
  params: Record<string, unknown>;
  description?: string;
}

export class ToolRegistry {
  constructor(
    private readonly config: AppConfig,
    private readonly tmuxService: TmuxService
  ) {}

  listToolDescriptions(): string {
    return [
      "tmux_list_jobs(): list all tmux panes/jobs",
      "tmux_peek({target, lines?}): capture pane output for target session:window.pane",
      "tmux_send({target, command, enter?}): send command into tmux pane headlessly (fire-and-forget)",
      "read_log({path, lines?}): read log tail from allowed directories",
      "run_command({command, cwd?}): run allowlisted command"
    ].join("\n");
  }

  async execute(action: ToolAction): Promise<string> {
    switch (action.tool) {
      case "tmux_list_jobs":
        return this.tmuxService.listJobsSummary();

      case "tmux_peek": {
        const target = String(action.params.target || "");
        const lines = Number(action.params.lines ?? 200);
        return this.tmuxService.peekPane(target, lines);
      }

      case "tmux_send": {
        const target = String(action.params.target || "");
        const command = String(action.params.command || "");
        const enterRaw = action.params.enter;
        const enter =
          enterRaw === undefined
            ? true
            : enterRaw === true || enterRaw === "true" || enterRaw === 1 || enterRaw === "1";
        const result = await this.tmuxService.sendCommand(target, command, enter);
        return result.message;
      }

      case "read_log": {
        const filePath = String(action.params.path || "");
        const lines = Number(action.params.lines ?? 120);
        return this.readLog(filePath, lines);
      }

      case "run_command": {
        const command = String(action.params.command || "").trim();
        const cwd = String(action.params.cwd || this.config.runtime.workspaceRoot);
        return this.runCommand(command, cwd);
      }

      default:
        throw new Error(`Unknown tool: ${action.tool}`);
    }
  }

  private readLog(filePath: string, lines: number): string {
    const resolved = this.resolveSafePath(filePath);
    const content = fs.readFileSync(resolved, "utf-8");
    const safeLines = Math.max(20, Math.min(lines, 2000));
    return content.split("\n").slice(-safeLines).join("\n");
  }

  private async runCommand(command: string, cwd: string): Promise<string> {
    if (!command) {
      throw new Error("command is required");
    }

    if (/[;&|`$><]/.test(command)) {
      throw new Error("Unsafe shell control characters are not allowed");
    }

    const head = command.split(/\s+/)[0] || "";
    if (!this.config.runtime.allowedCommandPrefixes.includes(head)) {
      throw new Error(`Command prefix not allowed: ${head}`);
    }

    const safeCwd = this.resolveSafePath(cwd);
    const { stdout, stderr } = await execFileAsync("bash", ["-lc", command], {
      cwd: safeCwd,
      timeout: 30_000,
      maxBuffer: 1024 * 1024
    });

    const out = [stdout?.trim(), stderr?.trim()].filter(Boolean).join("\n");
    return out || "<no output>";
  }

  private resolveSafePath(inputPath: string): string {
    const resolved = path.resolve(inputPath);
    const root = this.config.runtime.workspaceRoot;

    if (!resolved.startsWith(root)) {
      throw new Error(`Path not allowed outside workspace root: ${root}`);
    }

    return resolved;
  }
}
