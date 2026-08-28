#!/usr/bin/env node
import { DatabaseService } from '../src/db/database.js';
import { SummaryEndpointService } from '../src/services/summary-endpoint-service.js';
import { ReplySummaryService } from '../src/services/reply-summary-service.js';
import { TmuxService } from '../src/tmux/tmux-service.js';

const dbPath = process.env.DB_PATH;
if (!dbPath) {
  console.error('DB_PATH is required');
  process.exit(1);
}

const args = process.argv.slice(2);
const agentIdx = args.indexOf('--agent-name');
const sessionIdx = args.indexOf('--session');
if (agentIdx === -1 || sessionIdx === -1) {
  console.error('Missing --agent-name or --session');
  process.exit(1);
}

const agentName = args[agentIdx + 1];
const session = args[sessionIdx + 1];
if (!agentName || !session) {
  console.error('--agent-name and --session require values');
  process.exit(1);
}

const db = new DatabaseService(dbPath);
const endpointService = new SummaryEndpointService(db);
const summaryService = new ReplySummaryService(db, endpointService);
const tmux = new TmuxService();

const pane = await tmux.capturePane(session, 200);
if (!pane.trim()) {
  console.error('Captured pane was empty');
  process.exit(1);
}

const summary = await summaryService.summarize(agentName, pane);
if (!summary) {
  console.error('No summary was produced');
  process.exit(1);
}

process.stdout.write(`${summary}\n`);
