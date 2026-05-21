import { WebSocket } from "ws";
import { TmuxService } from "./tmux-service.js";
import { SafetyService } from "../services/safety-service.js";
import { AuthService, SessionUser } from "../auth/auth-service.js";

interface PaneStream {
  target: string;
  clients: Set<WebSocket>;
  interval: ReturnType<typeof setInterval> | null;
  lastOutput: string;
}

export class TmuxStreamManager {
  private streams = new Map<string, PaneStream>();

  constructor(
    private readonly tmuxService: TmuxService,
    private readonly safetyService: SafetyService,
    private readonly authService: AuthService,
    private readonly intervalMs: number,
    private readonly bufferLines: number
  ) {}

  async handleConnection(ws: WebSocket, target: string, token: string): Promise<void> {
    const user = this.authService.verifyToken(token);
    if (!user) {
      ws.send(JSON.stringify({ type: "error", message: "Authentication failed" }));
      ws.close(1008, "Authentication failed");
      return;
    }

    try {
      this.tmuxService.ensureValidTarget(target);
    } catch {
      ws.send(JSON.stringify({ type: "error", message: "Invalid tmux target" }));
      ws.close(1008, "Invalid target");
      return;
    }

    // Send initial snapshot
    const snapshot = await this.tmuxService.capturePane(target, this.bufferLines);
    ws.send(JSON.stringify({ type: "snapshot", data: snapshot, lines: this.bufferLines }));

    // Add to stream
    let stream = this.streams.get(target);
    if (!stream) {
      stream = { target, clients: new Set(), interval: null, lastOutput: snapshot };
      this.streams.set(target, stream);
    }
    stream.clients.add(ws);

    // Start streaming if first client
    if (!stream.interval) {
      this.startStreaming(stream);
    }

    // Handle incoming messages
    ws.on("message", async (data: Buffer | string) => {
      try {
        const msg = JSON.parse(data.toString()) as { type: string; data?: string; cols?: number; rows?: number; id?: string };

        if (msg.type === "input" && msg.data) {
          await this.handleInput(ws, target, msg.data, user);
        } else if (msg.type === "safety_confirm" && msg.id) {
          // Re-send the command with safety check skipped
          const command = msg.data || "";
          if (command) {
            await this.tmuxService.sendCommand(target, command, true, true);
          }
        } else if (msg.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
        }
      } catch {
        // Ignore malformed messages
      }
    });

    ws.on("close", () => {
      this.removeClient(target, ws);
    });

    ws.on("error", () => {
      this.removeClient(target, ws);
    });
  }

  private async handleInput(ws: WebSocket, target: string, input: string, _user: SessionUser): Promise<void> {
    // Check safety on complete commands (lines ending with newline)
    const trimmed = input.replace(/\r?\n$/, "").trim();
    if (trimmed) {
      const check = this.safetyService.checkCommand(trimmed);
      if (check.blocked) {
        ws.send(JSON.stringify({
          type: "safety_block",
          command: trimmed,
          pattern: check.pattern?.pattern,
          id: crypto.randomUUID()
        }));
        return;
      }
    }

    // Send raw input to tmux pane (including newlines for Enter)
    const args = ["send-keys", "-t", target, "--", input];
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);

    try {
      await execFileAsync("tmux", args);
    } catch {
      ws.send(JSON.stringify({ type: "error", message: "Failed to send input to pane" }));
    }
  }

  private startStreaming(stream: PaneStream): void {
    stream.interval = setInterval(async () => {
      if (stream.clients.size === 0) {
        this.stopStreaming(stream);
        return;
      }

      try {
        const output = await this.tmuxService.capturePane(stream.target, this.bufferLines);
        if (output !== stream.lastOutput) {
          stream.lastOutput = output;
          const msg = JSON.stringify({ type: "snapshot", data: output });
          for (const client of stream.clients) {
            if (client.readyState === WebSocket.OPEN) {
              client.send(msg);
            }
          }
        }
      } catch {
        // Pane might have been terminated
        const msg = JSON.stringify({ type: "closed", reason: "Pane terminated" });
        for (const client of stream.clients) {
          if (client.readyState === WebSocket.OPEN) {
            client.send(msg);
          }
        }
        this.stopStreaming(stream);
        this.streams.delete(stream.target);
      }
    }, this.intervalMs);
  }

  private stopStreaming(stream: PaneStream): void {
    if (stream.interval) {
      clearInterval(stream.interval);
      stream.interval = null;
    }
  }

  private removeClient(target: string, ws: WebSocket): void {
    const stream = this.streams.get(target);
    if (!stream) return;
    stream.clients.delete(ws);
    if (stream.clients.size === 0) {
      this.stopStreaming(stream);
      this.streams.delete(target);
    }
  }

  shutdown(): void {
    for (const stream of this.streams.values()) {
      this.stopStreaming(stream);
      for (const client of stream.clients) {
        client.close(1001, "Server shutting down");
      }
    }
    this.streams.clear();
  }
}
