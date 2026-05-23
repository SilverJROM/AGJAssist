import { WebSocket } from "ws";
import { AuthService } from "../../auth/auth-service.js";
import { OvermindService, OvermindWorkflow } from "../../services/overmind-service.js";

export class OvermindStreamManager {
  private readonly clients = new Set<WebSocket>();

  constructor(
    private readonly authService: AuthService,
    private readonly overmindService: OvermindService
  ) {}

  async handleConnection(ws: WebSocket, token: string): Promise<void> {
    const user = this.authService.verifyToken(token);
    if (!user) {
      this.sendJson(ws, { type: "error", message: "Authentication failed" });
      ws.close(1008, "Authentication failed");
      return;
    }

    this.sendJson(ws, { type: "snapshot", workflows: this.overmindService.list() });
    this.clients.add(ws);

    ws.on("message", (data: Buffer | string) => {
      try {
        const msg = JSON.parse(data.toString()) as { type?: string };
        if (msg.type === "ping") {
          this.sendJson(ws, { type: "pong" });
        }
      } catch {
        // Ignore malformed client messages.
      }
    });

    ws.on("close", () => this.removeClient(ws));
    ws.on("error", () => this.removeClient(ws));
  }

  broadcast(workflows: OvermindWorkflow[] = this.overmindService.list()): void {
    const message = JSON.stringify({ type: "update", workflows });
    for (const client of this.clients) {
      if (client.readyState !== WebSocket.OPEN) {
        this.removeClient(client);
        continue;
      }

      try {
        client.send(message);
      } catch {
        this.removeClient(client);
      }
    }
  }

  subscriberCount(): number {
    return this.clients.size;
  }

  shutdown(): void {
    for (const client of this.clients) {
      client.close(1001, "Server shutting down");
    }
    this.clients.clear();
  }

  private removeClient(ws: WebSocket): void {
    this.clients.delete(ws);
  }

  private sendJson(ws: WebSocket, payload: unknown): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }
}
