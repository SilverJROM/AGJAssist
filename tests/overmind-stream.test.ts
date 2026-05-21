import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { OvermindStreamManager } from "../src/api/websocket/overmind-stream-manager.js";
import { AuthService } from "../src/auth/auth-service.js";
import { OvermindService, OvermindWorkflow } from "../src/services/overmind-service.js";
import { OvermindWatcher } from "../src/services/overmind-watcher.js";
import { TmuxService } from "../src/tmux/tmux-service.js";
import {
  buildOvermindWsUrl,
  countDoneTasks,
  formatActiveSessionAttribution,
  formatStuckDuration,
  isActiveStatus,
  statusColor,
  statusIcon,
  summarizeWorkflows,
  taskGlyph
} from "../src/web/public/overmind-helpers.js";

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

function workflow(overrides: Partial<OvermindWorkflow> = {}): OvermindWorkflow {
  return {
    id: 1,
    label: "A7",
    coordinator_session: "coord-1",
    child_sessions: ["child-1"],
    run_dir: "/tmp/a7",
    status: "working",
    current_task: "dashboard",
    tasks: [
      { id: "A1", label: "Schema", state: "done" },
      { id: "A7", label: "Dashboard", state: "processing" }
    ],
    pending_decision: null,
    active_session: null,
    active_role: null,
    last_pane_hash: null,
    last_activity_at: "2026-05-21T00:00:00.000Z",
    stuck_since: null,
    nudge_count: 0,
    tier: 0,
    created_at: "2026-05-21T00:00:00.000Z",
    updated_at: "2026-05-21T00:00:00.000Z",
    ...overrides
  };
}

function makeManager(rows: OvermindWorkflow[] = [workflow()]) {
  const authService = {
    verifyToken: vi.fn((token: string) => token === "good" ? { id: 1 } : null)
  } as unknown as AuthService;
  const overmindService = {
    list: vi.fn(() => rows)
  } as unknown as OvermindService;
  return {
    manager: new OvermindStreamManager(authService, overmindService),
    authService,
    overmindService
  };
}

function parseLast(socket: FakeSocket) {
  return JSON.parse(socket.sent.at(-1) || "{}");
}

describe("OvermindStreamManager", () => {
  it("authenticates subscribers, sends an initial snapshot, and broadcasts updates", async () => {
    const initial = workflow();
    const updated = workflow({ status: "stuck", stuck_since: "2026-05-21T00:00:00.000Z" });
    const { manager } = makeManager([initial]);
    const socket = new FakeSocket();

    await manager.handleConnection(socket as unknown as WebSocket, "good");

    expect(manager.subscriberCount()).toBe(1);
    expect(parseLast(socket)).toEqual({ type: "snapshot", workflows: [initial] });

    manager.broadcast([updated]);

    expect(parseLast(socket)).toEqual({ type: "update", workflows: [updated] });
  });

  it("rejects invalid tokens before subscribing", async () => {
    const { manager } = makeManager();
    const socket = new FakeSocket();

    await manager.handleConnection(socket as unknown as WebSocket, "bad");

    expect(socket.closeCode).toBe(1008);
    expect(socket.closeReason).toBe("Authentication failed");
    expect(manager.subscriberCount()).toBe(0);
    expect(JSON.parse(socket.sent[0])).toEqual({ type: "error", message: "Authentication failed" });
  });

  it("broadcasts only to open clients and removes closed clients", async () => {
    const { manager } = makeManager();
    const openSocket = new FakeSocket();
    const closedSocket = new FakeSocket();

    await manager.handleConnection(openSocket as unknown as WebSocket, "good");
    await manager.handleConnection(closedSocket as unknown as WebSocket, "good");
    closedSocket.readyState = WebSocket.CLOSED;

    manager.broadcast([workflow({ id: 2 })]);

    expect(openSocket.sent).toHaveLength(2);
    expect(closedSocket.sent).toHaveLength(1);
    expect(manager.subscriberCount()).toBe(1);
  });

  it("removes subscribers on close and responds to ping", async () => {
    const { manager } = makeManager();
    const socket = new FakeSocket();

    await manager.handleConnection(socket as unknown as WebSocket, "good");
    socket.emit("message", JSON.stringify({ type: "ping" }));
    expect(parseLast(socket)).toEqual({ type: "pong" });

    socket.close();
    expect(manager.subscriberCount()).toBe(0);
  });
});

describe("Overmind watcher stream callback", () => {
  it("calls onUpdate with the refreshed workflow list after tick updates", async () => {
    let rows = [workflow({ last_pane_hash: null })];
    const overmindService = {
      list: vi.fn(() => rows),
      update: vi.fn((id: number, fields: Partial<OvermindWorkflow>) => {
        rows = rows.map(row => row.id === id ? { ...row, ...fields } : row);
        return rows.find(row => row.id === id) || null;
      })
    } as unknown as OvermindService;
    const tmuxService = {
      capturePane: vi.fn(async () => "quiet pane")
    } as unknown as TmuxService;
    const onUpdate = vi.fn();
    const watcher = new OvermindWatcher(overmindService, tmuxService, undefined, undefined, onUpdate);

    await watcher.tick();

    expect(overmindService.update).toHaveBeenCalledOnce();
    expect(onUpdate).toHaveBeenCalledOnce();
    expect(onUpdate.mock.calls[0][0][0].last_pane_hash).toBeTruthy();
  });
});

describe("Overmind public helpers", () => {
  it("formats statuses, task glyphs, counts, durations, and websocket URLs", () => {
    expect(statusIcon("working")).toBe("▶");
    expect(statusIcon("awaiting_decision")).toBe("❓");
    expect(statusIcon("unknown")).toBe("•");
    expect(taskGlyph("done")).toBe("✓");
    expect(taskGlyph("missing")).toBe("○");
    expect(countDoneTasks([
      { id: "A1", label: "One", state: "done" },
      { id: "A2", label: "Two", state: "processing" }
    ])).toBe(1);
    expect(formatActiveSessionAttribution({
      coordinator_session: "hris-d-22",
      child_sessions: ["hrcdx-33"],
      active_session: "hrcdx-33",
      active_role: "child"
    })).toBe("working: hrcdx-33 (child) · hris-d-22 (parent) idle/waiting");
    expect(formatActiveSessionAttribution({
      coordinator_session: "hris-d-22",
      child_sessions: ["hrcdx-33"],
      active_session: "hris-d-22",
      active_role: "parent"
    })).toBe("working: hris-d-22 (parent) · hrcdx-33 (child) idle/waiting");
    expect(formatActiveSessionAttribution({
      coordinator_session: "hris-d-22",
      child_sessions: ["hrcdx-33"],
      active_session: null,
      active_role: null
    })).toBe("— no session active");
    expect(formatStuckDuration("2026-05-21T00:00:00.000Z", Date.parse("2026-05-21T01:02:03.000Z"))).toBe("1h 2m");
    expect(buildOvermindWsUrl("a b", { protocol: "https:", host: "example.test" })).toBe("wss://example.test/ws/overmind?token=a%20b");
  });

  it("maps workflow statuses to overmind color classes", () => {
    expect(statusColor("working")).toBe("ovm-yellow");
    expect(statusColor("waiting_human")).toBe("ovm-green");
    expect(statusColor("awaiting_decision")).toBe("ovm-green");
    expect(statusColor("stuck")).toBe("ovm-red");
    expect(statusColor("failed")).toBe("ovm-red");
    expect(statusColor("completed")).toBe("ovm-grey");
    expect(statusColor("paused")).toBe("ovm-grey");
    expect(statusColor("active")).toBe("ovm-neutral");
    expect(statusColor("unknown")).toBe("ovm-neutral");
  });

  it("classifies active dashboard workflow statuses", () => {
    expect(isActiveStatus("working")).toBe(true);
    expect(isActiveStatus("active")).toBe(true);
    expect(isActiveStatus("waiting_human")).toBe(true);
    expect(isActiveStatus("awaiting_decision")).toBe(true);
    expect(isActiveStatus("stuck")).toBe(true);
    expect(isActiveStatus("completed")).toBe(false);
    expect(isActiveStatus("paused")).toBe(false);
  });

  it("summarizes workflows for the home quick-view card", () => {
    expect(summarizeWorkflows([
      { status: "working" },
      { status: "waiting_human" },
      { status: "completed" },
      { status: "paused" }
    ])).toEqual({ total: 4, active: 2 });
    expect(summarizeWorkflows(null)).toEqual({ total: 0, active: 0 });
  });
});
