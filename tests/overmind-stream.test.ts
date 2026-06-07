import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { OvermindStreamManager } from "../src/api/websocket/overmind-stream-manager.js";
import { AuthService } from "../src/auth/auth-service.js";
import { OvermindService, OvermindWorkflow } from "../src/services/overmind-service.js";
import { OvermindWatcher } from "../src/services/overmind-watcher.js";
import { hashPane } from "../src/services/overmind/pane-utils.js";
import { TmuxService } from "../src/tmux/tmux-service.js";
import {
  buildOvermindWsUrl,
  buildTmuxWsUrl,
  countDoneTasks,
  currentElapsedMs,
  elapsedMs,
  formatActiveSessionAttribution,
  formatElapsed,
  formatStuckDuration,
  groupOvermindHistoryByWorkflow,
  isActiveStatus,
  statusColor,
  statusIcon,
  summarizeWorkflows,
  taskGlyph,
  totalElapsedMs
} from "../src/web/public/overmind-helpers.js";

const isAgentPaneMock = vi.hoisted(() => vi.fn());

vi.mock("../src/services/overmind/agent-pane.js", () => ({
  isAgentPane: isAgentPaneMock
}));

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
    ended_at: null,
    task_log: [],
    last_pane_hash: null,
    last_activity_at: "2026-05-21T00:00:00.000Z",
    stuck_since: null,
    nudge_count: 0,
    tier: 0,
    last_notified_transition: null,
    run_started_at: "2026-05-21T00:00:00.000Z",
    accumulated_ms: 0,
    completion_check: null,
    parent_status: null,
    child_statuses: [],
    info_request: null,
    info_check: null,
    monitoring_paused: false,
    paused_at: null,
    paused_by: null,
    last_parent_update_at: null,
    evidence_idle_threshold_override_minutes: null,
    orphaned: false,
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
    expect(parseLast(socket)).toMatchObject({
      type: "snapshot",
      workflows: [expect.objectContaining(initial)]
    });

    manager.broadcast([updated]);

    expect(parseLast(socket)).toMatchObject({
      type: "update",
      workflows: [expect.objectContaining(updated)]
    });
  });

  it("can include a registration announcement on an update broadcast", async () => {
    const updated = workflow({ id: 12, label: "agjassist · run-1", run_dir: "/tmp/agjassist/run-1" });
    const { manager } = makeManager();
    const socket = new FakeSocket();

    await manager.handleConnection(socket as unknown as WebSocket, "good");
    manager.broadcast([updated], {
      kind: "overmind-registration",
      project_slug: "agjassist",
      workflow_id: updated.id,
      label: updated.label,
      run_dir: updated.run_dir,
      at: "2026-06-02T00:00:00.000Z"
    });

    expect(parseLast(socket)).toMatchObject({
      type: "update",
      workflows: [expect.objectContaining(updated)],
      announcement: {
        kind: "overmind-registration",
        project_slug: "agjassist",
        workflow_id: 12,
        label: "agjassist · run-1",
        run_dir: "/tmp/agjassist/run-1",
        at: "2026-06-02T00:00:00.000Z"
      }
    });
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
  beforeEach(() => {
    isAgentPaneMock.mockReset();
    isAgentPaneMock.mockResolvedValue("codex");
  });

  it("calls onUpdate with the refreshed workflow list after tick updates", async () => {
    let rows = [workflow({ last_pane_hash: null })];
    const overmindService = {
      list: vi.fn(() => rows),
      get: vi.fn((id: number) => rows.find(row => row.id === id) || null),
      update: vi.fn((id: number, fields: Partial<OvermindWorkflow>) => {
        rows = rows.map(row => row.id === id ? { ...row, ...fields } : row);
        return rows.find(row => row.id === id) || null;
      }),
      getParentSessionForWorkflow: vi.fn(() => null)
    } as unknown as OvermindService;
    const tmuxService = {
      capturePane: vi.fn(async () => "quiet pane"),
      sessionExists: vi.fn(async () => true),
      sendAndSubmit: vi.fn(async () => true)
    } as unknown as TmuxService;
    const onUpdate = vi.fn();
    const watcher = new OvermindWatcher(overmindService, tmuxService, undefined, undefined, onUpdate);

    await watcher.tick();

    expect(overmindService.update).toHaveBeenCalledOnce();
    expect(onUpdate).toHaveBeenCalledOnce();
    expect(onUpdate.mock.calls[0][0][0].last_pane_hash).toBeTruthy();
  });

  it("persists independent parent and child statuses, including closed child sessions", async () => {
    let rows = [workflow({
      child_sessions: ["child-working", "child-closed"],
      last_pane_hash: hashPane("quiet parent")
    })];
    const overmindService = {
      list: vi.fn(() => rows),
      get: vi.fn((id: number) => rows.find(row => row.id === id) || null),
      update: vi.fn((id: number, fields: Partial<OvermindWorkflow>) => {
        rows = rows.map(row => row.id === id ? { ...row, ...fields } : row);
        return rows.find(row => row.id === id) || null;
      }),
      getParentSessionForWorkflow: vi.fn(() => null)
    } as unknown as OvermindService;
    const tmuxService = {
      capturePane: vi.fn(async (target: string) => {
        if (target === "coord-1") return "quiet parent";
        if (target === "child-working") return "Working (8s)\nesc to interrupt";
        return "";
      }),
      sessionExists: vi.fn(async (target: string) => target !== "child-closed"),
      sendAndSubmit: vi.fn(async () => true)
    } as unknown as TmuxService;
    const watcher = new OvermindWatcher(overmindService, tmuxService);

    await watcher.tick();

    expect(overmindService.update).toHaveBeenCalledOnce();
    expect(rows[0].parent_status).toBe("idle");
    expect(rows[0].child_statuses).toEqual([
      { session: "child-working", status: "working" },
      { session: "child-closed", status: "closed" }
    ]);
    expect(rows[0].status).toBe("working");
  });

  it("keeps a frozen coordinator working when an observed child pane changes", async () => {
    let childPane = "child initial output";
    let rows = [workflow({
      child_sessions: ["child-active"],
      last_pane_hash: null
    })];
    const overmindService = {
      list: vi.fn(() => rows),
      get: vi.fn((id: number) => rows.find(row => row.id === id) || null),
      update: vi.fn((id: number, fields: Partial<OvermindWorkflow>) => {
        rows = rows.map(row => row.id === id ? { ...row, ...fields } : row);
        return rows.find(row => row.id === id) || null;
      }),
      getParentSessionForWorkflow: vi.fn(() => null)
    } as unknown as OvermindService;
    const tmuxService = {
      capturePane: vi.fn(async (target: string) => {
        if (target === "coord-1") return "quiet parent";
        if (target === "child-active") return childPane;
        return "";
      }),
      sessionExists: vi.fn(async () => true),
      sendAndSubmit: vi.fn(async () => true)
    } as unknown as TmuxService;
    const watcher = new OvermindWatcher(overmindService, tmuxService);

    await watcher.tick();
    childPane = "child changed output";
    await watcher.tick();

    expect(rows[0].status).toBe("working");
    expect(rows[0].stuck_since).toBeNull();
    expect(rows[0].child_statuses).toEqual([
      { session: "child-active", status: "working" }
    ]);
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
    expect(elapsedMs("2026-05-21T00:00:00.000Z", null, Date.parse("2026-05-21T01:02:03.000Z"))).toBe(3723000);
    expect(elapsedMs("2026-05-21T00:00:00.000Z", "2026-05-21T02:14:00.000Z", Date.parse("2026-05-21T04:00:00.000Z"))).toBe(8040000);
    expect(elapsedMs("2026-05-21 00:00:00", null, Date.parse("2026-05-21T00:00:30.000Z"))).toBe(30000);
    expect(currentElapsedMs("2026-05-21T01:00:00.000Z", null, Date.parse("2026-05-21T01:02:03.000Z"))).toBe(123000);
    expect(currentElapsedMs("2026-05-21 01:00:00", "2026-05-21T01:05:00.000Z", Date.parse("2026-05-21T02:00:00.000Z"))).toBe(300000);
    expect(currentElapsedMs(null, null, Date.parse("2026-05-21T02:00:00.000Z"))).toBe(0);
    expect(totalElapsedMs(60000, "2026-05-21T01:00:00.000Z", null, Date.parse("2026-05-21T01:02:00.000Z"))).toBe(180000);
    expect(totalElapsedMs(null, "2026-05-21T01:00:00.000Z", "2026-05-21T01:01:00.000Z")).toBe(60000);
    expect(formatElapsed(8040000)).toBe("2h 14m");
    expect(formatElapsed(59000)).toBe("<1m");
    expect(buildOvermindWsUrl("a b", { protocol: "https:", host: "example.test" })).toBe("wss://example.test/ws/overmind?token=a%20b");
    expect(buildTmuxWsUrl("OVM:0.0", "a b", { protocol: "https:", host: "example.test" })).toBe("wss://example.test/ws/tmux/OVM%3A0.0?token=a%20b");
    expect(buildTmuxWsUrl("", "token", { protocol: "http:", host: "example.test" })).toBeNull();
  });

  it("maps workflow statuses to overmind color classes", () => {
    expect(statusColor("working")).toBe("ovm-green");
    expect(statusColor("idle")).toBe("ovm-yellow");
    expect(statusColor("active")).toBe("ovm-yellow");
    expect(statusColor("waiting_human")).toBe("ovm-blue");
    expect(statusColor("awaiting_decision")).toBe("ovm-blue");
    expect(statusColor("stuck")).toBe("ovm-red");
    expect(statusColor("failed")).toBe("ovm-red");
    expect(statusColor("completed")).toBe("ovm-grey");
    expect(statusColor("paused")).toBe("ovm-grey");
    expect(statusColor("closed")).toBe("ovm-grey");
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
      { status: "stuck", orphaned: true },
      { status: "completed" },
      { status: "paused" }
    ])).toEqual({ total: 5, active: 2 });
    expect(summarizeWorkflows(null)).toEqual({ total: 0, active: 0 });
  });

  it("groups archived task history by workflow with newest entries first", () => {
    expect(groupOvermindHistoryByWorkflow([
      {
        id: 1,
        coordinator_session: "coord-a",
        name: "Workflow A",
        at: "2026-05-21T10:00:00.000Z",
        current_task: "First",
        done: 1,
        total: 3
      },
      {
        id: 2,
        coordinator_session: "coord-b",
        name: "Workflow B",
        at: "2026-05-21T12:00:00.000Z",
        current_task: "Only",
        done: 2,
        total: 2
      },
      {
        id: 3,
        coordinator_session: "coord-a",
        name: "Workflow A renamed",
        at: "2026-05-21T11:00:00.000Z",
        current_task: "Second",
        done: 2,
        total: 3
      }
    ])).toEqual([
      {
        key: "coord-b",
        coordinator_session: "coord-b",
        name: "Workflow B",
        latest_at: "2026-05-21T12:00:00.000Z",
        entries: [
          {
            id: 2,
            coordinator_session: "coord-b",
            name: "Workflow B",
            at: "2026-05-21T12:00:00.000Z",
            current_task: "Only",
            done: 2,
            total: 2
          }
        ]
      },
      {
        key: "coord-a",
        coordinator_session: "coord-a",
        name: "Workflow A renamed",
        latest_at: "2026-05-21T11:00:00.000Z",
        entries: [
          {
            id: 3,
            coordinator_session: "coord-a",
            name: "Workflow A renamed",
            at: "2026-05-21T11:00:00.000Z",
            current_task: "Second",
            done: 2,
            total: 3
          },
          {
            id: 1,
            coordinator_session: "coord-a",
            name: "Workflow A",
            at: "2026-05-21T10:00:00.000Z",
            current_task: "First",
            done: 1,
            total: 3
          }
        ]
      }
    ]);
    expect(groupOvermindHistoryByWorkflow(null)).toEqual([]);
  });
});
