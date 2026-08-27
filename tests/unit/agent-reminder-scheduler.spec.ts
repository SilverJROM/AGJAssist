import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DatabaseService } from "../../src/db/database.js";
import { AgentSolicitService } from "../../src/services/agent-solicit-service.js";
import { AgentReminderScheduler } from "../../src/services/agent-reminder-scheduler.js";
import { SafetyService } from "../../src/services/safety-service.js";
import { AuditService } from "../../src/services/audit-service.js";
import { TerminalGroupsService } from "../../src/services/terminal-groups-service.js";
import { DelegationService } from "../../src/services/delegation-service.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempDirs: string[] = [];

function tempDb(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agjassist-agent-reminder-scheduler-"));
  tempDirs.push(dir);
  return path.join(dir, name);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("AgentReminderScheduler fireDue", () => {
  let db: DatabaseService;
  let solicitService: AgentSolicitService;
  let safetyService: SafetyService;
  let auditService: AuditService;
  let groupsService: TerminalGroupsService;
  let delegationService: DelegationService;
  let tmuxService: any;
  let scheduler: AgentReminderScheduler;
  let userId: number;

  beforeEach(() => {
    const dbPath = tempDb("test.sqlite");
    db = new DatabaseService(dbPath);
    db.prepare("INSERT INTO users (telegram_id, role) VALUES (12345, 'owner')").run();
    userId = (db.prepare("SELECT id FROM users WHERE telegram_id = 12345").get() as { id: number }).id;

    solicitService = new AgentSolicitService(db);
    safetyService = new SafetyService(db);
    auditService = new AuditService(db);
    groupsService = new TerminalGroupsService(db);
    delegationService = new DelegationService(db, auditService);

    // Mock TmuxService
    tmuxService = {
      listPanes: vi.fn().mockResolvedValue([
        { target: "sess-a:0.0", session: "agent-a", window: "0", pane: "0", command: "", title: "" },
        { target: "sess-b:0.0", session: "agent-b", window: "0", pane: "0", command: "", title: "" }
      ]),
      sendCommand: vi.fn().mockResolvedValue({ message: "sent", blocked: false })
    };

    scheduler = new AgentReminderScheduler(
      solicitService,
      tmuxService,
      safetyService,
      auditService,
      groupsService,
      delegationService
    );

    // Create terminal group for user
    groupsService.put(userId, {
      groups: [{ id: "group-a", name: "group-a", sessions: ["agent-a", "agent-b"] }],
      activeGroup: "group-a"
    });
  });

  afterEach(() => {
    db.close();
    vi.clearAllMocks();
  });

  it("fires due reminder to included agents only, skips excluded, safety checks, audits, advances", async () => {
    // Create due reminder with past next_fire
    const reminder = solicitService.create({
      user_id: userId,
      folder_group: "group-a",
      cadence_minutes: 30,
      repeat_limit: null,
      solicit_message: "give me a status update",
      next_fire: "2000-01-01 00:00:00",
      recipients: [
        { agent_name: "agent-a", include: 1 },
        { agent_name: "agent-b", include: 0 }
      ]
    });

    const results = await scheduler.fireDue(userId);
    expect(results).toHaveLength(1);
    const res = results[0];
    expect(res.reminderId).toBe(reminder.id);
    expect(res.sent).toHaveLength(1);
    expect(res.sent[0].agentName).toBe("agent-a");
    expect(res.sent[0].target).toBe("sess-a:0.0");
    expect(res.skipped).toHaveLength(0);

    // Tmux send called only for included agent
    expect(tmuxService.sendCommand).toHaveBeenCalledTimes(1);
    expect(tmuxService.sendCommand).toHaveBeenCalledWith("sess-a:0.0", "give me a status update");

    // Audit logged
    expect(res.auditIds).toHaveLength(1);
    const auditRows = db.prepare("SELECT * FROM audit_log WHERE action_type = ?").all("reminder_fire") as any[];
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].agent_name).toBe("agent-a");
    expect(auditRows[0].tmux_target).toBe("sess-a:0.0");

    // Reminder advanced
    const updated = solicitService.getById(reminder.id);
    expect(updated?.repeat_count).toBe(1);
    // next_fire advanced by 30 minutes from 2000-01-01 00:00:00
    // The service uses ISO string for advance, so we check repeat_count and active
    expect(updated?.active).toBe(1);
  });

  it("skips agent with no pane", async () => {
    const reminder = solicitService.create({
      user_id: userId,
      folder_group: "group-a",
      cadence_minutes: 30,
      solicit_message: "ping",
      next_fire: "2000-01-01 00:00:00",
      recipients: [{ agent_name: "agent-missing", include: 1 }]
    });

    const results = await scheduler.fireDue(userId);
    expect(results[0].sent).toHaveLength(0);
    expect(results[0].skipped).toHaveLength(1);
    expect(results[0].skipped[0].reason).toBe("no pane");
    expect(tmuxService.sendCommand).not.toHaveBeenCalled();
  });

  it("blocks send when safety pattern matches", async () => {
    // Add safety pattern that blocks the message
    safetyService.addPattern("give me a status update", "test block", false);

    const reminder = solicitService.create({
      user_id: userId,
      folder_group: "group-a",
      cadence_minutes: 30,
      solicit_message: "give me a status update",
      next_fire: "2000-01-01 00:00:00",
      recipients: [{ agent_name: "agent-a", include: 1 }]
    });

    const results = await scheduler.fireDue(userId);
    expect(results[0].sent).toHaveLength(0);
    expect(results[0].skipped).toHaveLength(1);
    expect(results[0].skipped[0].reason).toBe("safety blocked");
    expect(tmuxService.sendCommand).not.toHaveBeenCalled();
  });
});
