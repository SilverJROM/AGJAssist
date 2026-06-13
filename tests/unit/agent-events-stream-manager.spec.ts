import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { AgentEventsStreamManager } from "../../src/api/websocket/agent-events-stream-manager.js";
import { AuthService } from "../../src/auth/auth-service.js";
import { DatabaseService } from "../../src/db/database.js";
import { AgentEventsService } from "../../src/services/agent-events-service.js";

class FakeSocket extends EventEmitter {
  readyState = WebSocket.OPEN;
  sent: string[] = [];
  closeCode: number | null = null;
  closeReason = "";

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closeCode = code ?? null;
    this.closeReason = reason ?? "";
    this.readyState = WebSocket.CLOSED;
    this.emit("close");
  }
}

let tmpDir: string;
let db: DatabaseService;
let events: AgentEventsService;
let manager: AgentEventsStreamManager;

function parseLast(socket: FakeSocket) {
  return JSON.parse(socket.sent.at(-1) || "{}");
}

function makeEvent(runId: string, overrides: Partial<Parameters<AgentEventsService["recordEvent"]>[0]> = {}) {
  return events.recordEvent({
    run_id: runId,
    role: "implementer",
    batch_id: "A3c",
    session: "agent:0.0",
    type: "status",
    state: "WORKING",
    source: "post",
    correlation_id: `event:${runId}:${Math.random()}`,
    body: { note: "working" },
    ts: "2026-06-13T12:00:00.000Z",
    ...overrides
  });
}

describe("AgentEventsStreamManager", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agj-agent-events-ws-"));
    db = new DatabaseService(path.join(tmpDir, "events.sqlite"));
    events = new AgentEventsService(db);
    const authService = {
      verifyToken: (token: string) => token === "good" ? { id: 1 } : null
    } as unknown as AuthService;
    manager = new AgentEventsStreamManager(authService, events);
    events.onEvent((event) => manager.broadcast(event));
  });

  afterEach(() => {
    manager.shutdown();
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("replays recent events for the subscribed run on connect", async () => {
    const event = makeEvent("run-x", {
      role: "coordinator",
      type: "message",
      state: null,
      body: { text: "hello" }
    });
    makeEvent("run-y");
    const socket = new FakeSocket();

    await manager.handleConnection(socket as unknown as WebSocket, "good", "run-x");

    expect(parseLast(socket)).toMatchObject({
      type: "snapshot",
      run_id: "run-x",
      events: [
        {
          id: event.id,
          run_id: "run-x",
          role: "coordinator",
          type: "message",
          state: null,
          ts: "2026-06-13T12:00:00.000Z"
        }
      ]
    });
  });

  it("broadcasts recordEvent writes only to subscribers of the matching run_id", async () => {
    const runXSocket = new FakeSocket();
    const runYSocket = new FakeSocket();
    await manager.handleConnection(runXSocket as unknown as WebSocket, "good", "run-x");
    await manager.handleConnection(runYSocket as unknown as WebSocket, "good", "run-y");

    makeEvent("run-x", {
      role: "implementer",
      type: "status",
      state: "DONE"
    });

    expect(runXSocket.sent).toHaveLength(2);
    expect(parseLast(runXSocket)).toMatchObject({
      type: "event",
      run_id: "run-x",
      event: {
        run_id: "run-x",
        role: "implementer",
        type: "status",
        state: "DONE",
        ts: "2026-06-13T12:00:00.000Z"
      }
    });
    expect(runYSocket.sent).toHaveLength(1);
    expect(parseLast(runYSocket)).toMatchObject({
      type: "snapshot",
      run_id: "run-y",
      events: []
    });
  });

  it("rejects invalid tokens before subscribing", async () => {
    const socket = new FakeSocket();

    await manager.handleConnection(socket as unknown as WebSocket, "bad", "run-x");

    expect(socket.closeCode).toBe(1008);
    expect(socket.closeReason).toBe("Authentication failed");
    expect(manager.subscriberCount()).toBe(0);
    expect(JSON.parse(socket.sent[0])).toEqual({ type: "error", message: "Authentication failed" });
  });
});
