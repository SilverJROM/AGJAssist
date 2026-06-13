import { WebSocket } from "ws";
import { AuthService } from "../../auth/auth-service.js";
import { AgentEventRow, AgentEventsService } from "../../services/agent-events-service.js";

export interface AgentEventsSnapshotMessage {
  type: "snapshot";
  run_id: string;
  events: AgentEventRow[];
}

export interface AgentEventsUpdateMessage {
  type: "event";
  run_id: string;
  event: AgentEventRow;
}

export type AgentEventsStreamMessage = AgentEventsSnapshotMessage | AgentEventsUpdateMessage;

export class AgentEventsStreamManager {
  private readonly clientsByRunId = new Map<string, Set<WebSocket>>();

  constructor(
    private readonly authService: AuthService,
    private readonly eventsService: AgentEventsService,
    private readonly replayLimit = 50
  ) {}

  async handleConnection(ws: WebSocket, token: string, runId: string): Promise<void> {
    const user = this.authService.verifyToken(token);
    if (!user) {
      this.sendJson(ws, { type: "error", message: "Authentication failed" });
      ws.close(1008, "Authentication failed");
      return;
    }

    const clients = this.clientsForRun(runId);
    clients.add(ws);
    this.sendJson(ws, {
      type: "snapshot",
      run_id: runId,
      events: this.eventsService.listEvents(runId).slice(-this.replayLimit)
    } satisfies AgentEventsSnapshotMessage);

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

    ws.on("close", () => this.removeClient(runId, ws));
    ws.on("error", () => this.removeClient(runId, ws));
  }

  broadcast(event: AgentEventRow): void {
    const clients = this.clientsByRunId.get(event.run_id);
    if (!clients) return;

    const message = JSON.stringify({
      type: "event",
      run_id: event.run_id,
      event
    } satisfies AgentEventsUpdateMessage);

    for (const client of clients) {
      if (client.readyState !== WebSocket.OPEN) {
        this.removeClient(event.run_id, client);
        continue;
      }

      try {
        client.send(message);
      } catch {
        this.removeClient(event.run_id, client);
      }
    }
  }

  subscriberCount(runId?: string): number {
    if (runId) return this.clientsByRunId.get(runId)?.size ?? 0;
    let count = 0;
    for (const clients of this.clientsByRunId.values()) count += clients.size;
    return count;
  }

  shutdown(): void {
    for (const clients of this.clientsByRunId.values()) {
      for (const client of clients) {
        client.close(1001, "Server shutting down");
      }
    }
    this.clientsByRunId.clear();
  }

  private clientsForRun(runId: string): Set<WebSocket> {
    const existing = this.clientsByRunId.get(runId);
    if (existing) return existing;
    const clients = new Set<WebSocket>();
    this.clientsByRunId.set(runId, clients);
    return clients;
  }

  private removeClient(runId: string, ws: WebSocket): void {
    const clients = this.clientsByRunId.get(runId);
    if (!clients) return;
    clients.delete(ws);
    if (clients.size === 0) this.clientsByRunId.delete(runId);
  }

  private sendJson(ws: WebSocket, payload: unknown): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }
}
