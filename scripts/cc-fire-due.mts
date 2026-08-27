#!/usr/bin/env node
import { DatabaseService } from '../src/db/database.js';
import { AgentSolicitService } from '../src/services/agent-solicit-service.js';
import { TmuxService } from '../src/tmux/tmux-service.js';
import { SafetyService } from '../src/services/safety-service.js';
import { AuditService } from '../src/services/audit-service.js';
import { TerminalGroupsService } from '../src/services/terminal-groups-service.js';
import { DelegationService } from '../src/services/delegation-service.js';
import { AgentReminderScheduler } from '../src/services/agent-reminder-scheduler.js';

const dbPath = process.env.DB_PATH;
if (!dbPath) {
  console.error('DB_PATH is required');
  process.exit(1);
}

const db = new DatabaseService(dbPath);
const solicitService = new AgentSolicitService(db);
const safetyService = new SafetyService(db);
const auditService = new AuditService(db);
const groupsService = new TerminalGroupsService(db);
const delegationService = new DelegationService(db, auditService);
const tmuxService = new TmuxService();
tmuxService.setSafetyService(safetyService);

const scheduler = new AgentReminderScheduler(
  solicitService,
  tmuxService,
  safetyService,
  auditService,
  groupsService,
  delegationService
);

const args = process.argv.slice(2);
const userIdIdx = args.indexOf('--user-id');
const groupIdx = args.indexOf('--folder-group');
if (userIdIdx === -1 || groupIdx === -1) {
  console.error('Missing --user-id or --folder-group');
  process.exit(1);
}
const userId = Number(args[userIdIdx + 1]);
const folderGroup = args[groupIdx + 1];

await scheduler.fireDue(userId, folderGroup);
