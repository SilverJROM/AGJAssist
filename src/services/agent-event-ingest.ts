import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { AgentEventRow, AgentEventsService } from "./agent-events-service.js";
import { hashPane, hasBusySignal } from "./overmind/pane-utils.js";
import { TmuxService } from "../tmux/tmux-service.js";

export interface AgentEventIngestRun {
  runId: string;
  runDir: string;
  role: string;
  batchId: string;
  session?: string | null;
  callbacksPath?: string;
  expectedBranch?: string;
}

export interface AgentEventIngestOptions {
  idleAfterActivityMs?: number;
  now?: () => number;
  gitHeadReader?: (runDir: string) => Promise<GitHeadSnapshot | null>;
}

export interface GitHeadSnapshot {
  branch: string | null;
  head: string;
}

interface PaneState {
  hash: string | null;
  lastActivityMs: number | null;
  emittedIdleDone: boolean;
}

const TERMINAL_STATES = new Set(["DONE", "BLOCKED"]);
const DEFAULT_IDLE_AFTER_ACTIVITY_MS = 5 * 60_000;

export class AgentEventIngest {
  private readonly seenCallbackLines = new Set<string>();
  private readonly gitHeads = new Map<string, string>();
  private readonly paneStates = new Map<string, PaneState>();
  private readonly idleAfterActivityMs: number;
  private readonly now: () => number;
  private readonly gitHeadReader: (runDir: string) => Promise<GitHeadSnapshot | null>;

  constructor(
    private readonly events: AgentEventsService,
    private readonly tmuxService: TmuxService,
    options: AgentEventIngestOptions = {}
  ) {
    this.idleAfterActivityMs = options.idleAfterActivityMs ?? DEFAULT_IDLE_AFTER_ACTIVITY_MS;
    this.now = options.now ?? Date.now;
    this.gitHeadReader = options.gitHeadReader ?? readGitHeadBestEffort;
  }

  async tick(run: AgentEventIngestRun): Promise<AgentEventRow[]> {
    const emitted: AgentEventRow[] = [];
    emitted.push(...await this.ingestCallbacks(run));
    const gitEvent = await this.ingestGitHead(run);
    if (gitEvent) emitted.push(gitEvent);
    const paneEvent = await this.ingestPaneIdle(run);
    if (paneEvent) emitted.push(paneEvent);
    return emitted;
  }

  recordMessage(
    run: AgentEventIngestRun,
    message: { role: string; content: string; status?: string; ts?: string }
  ): AgentEventRow {
    return this.events.recordEvent({
      run_id: run.runId,
      role: message.role,
      batch_id: run.batchId,
      session: run.session ?? null,
      type: "message",
      source: "post",
      correlation_id: `message:${run.runId}:${run.batchId}:${message.ts ?? this.now()}`,
      body: {
        content: message.content,
        status: message.status ?? "delivered"
      },
      ts: message.ts
    });
  }

  private async ingestCallbacks(run: AgentEventIngestRun): Promise<AgentEventRow[]> {
    const callbacksPath = run.callbacksPath ?? path.join(run.runDir, "callbacks.md");
    let raw = "";
    try {
      raw = await readFile(callbacksPath, "utf8");
    } catch {
      return [];
    }

    const rows: AgentEventRow[] = [];
    const lines = raw.split(/\r?\n/);
    lines.forEach((line, index) => {
      const parsed = parseCallbackLine(line);
      if (!parsed || parsed.batchId !== run.batchId) return;
      const key = `${callbacksPath}:${index}:${line}`;
      if (this.seenCallbackLines.has(key)) return;
      this.seenCallbackLines.add(key);
      rows.push(this.events.recordEvent({
        run_id: run.runId,
        role: parsed.role,
        batch_id: parsed.batchId,
        session: run.session ?? null,
        type: "status",
        state: parsed.state,
        source: "callback",
        correlation_id: correlationId(run.runId, parsed.batchId, parsed.state),
        body: {
          line,
          note: parsed.note
        }
      }));
    });
    return rows;
  }

  private async ingestGitHead(run: AgentEventIngestRun): Promise<AgentEventRow | null> {
    const snapshot = await this.gitHeadReader(run.runDir);
    if (!snapshot) return null;
    if (run.expectedBranch && snapshot.branch !== run.expectedBranch) return null;

    const key = `${run.runId}:${run.batchId}`;
    const previousHead = this.gitHeads.get(key);
    this.gitHeads.set(key, snapshot.head);
    if (!previousHead || previousHead === snapshot.head) return null;

    return this.events.recordEvent({
      run_id: run.runId,
      role: run.role,
      batch_id: run.batchId,
      session: run.session ?? null,
      type: "status",
      state: "DONE",
      source: "git",
      correlation_id: correlationId(run.runId, run.batchId, "DONE"),
      body: {
        previous_head: previousHead,
        head: snapshot.head,
        branch: snapshot.branch
      }
    });
  }

  private async ingestPaneIdle(run: AgentEventIngestRun): Promise<AgentEventRow | null> {
    if (!run.session) return null;

    let pane = "";
    try {
      pane = await this.tmuxService.capturePane(run.session, 200);
    } catch {
      return null;
    }
    const nowMs = this.now();
    const currentHash = hashPane(pane);
    const key = `${run.runId}:${run.batchId}:${run.session}`;
    const existing = this.paneStates.get(key);
    if (!existing) {
      this.paneStates.set(key, {
        hash: currentHash,
        lastActivityMs: null,
        emittedIdleDone: false
      });
      return null;
    }

    if (existing.hash !== currentHash) {
      this.paneStates.set(key, {
        hash: currentHash,
        lastActivityMs: nowMs,
        emittedIdleDone: false
      });
      return null;
    }

    if (
      existing.lastActivityMs === null ||
      existing.emittedIdleDone ||
      hasBusySignal(pane) ||
      nowMs - existing.lastActivityMs < this.idleAfterActivityMs
    ) {
      return null;
    }

    existing.emittedIdleDone = true;
    return this.events.recordEvent({
      run_id: run.runId,
      role: run.role,
      batch_id: run.batchId,
      session: run.session,
      type: "status",
      state: "DONE",
      source: "pane",
      correlation_id: correlationId(run.runId, run.batchId, "DONE"),
      body: {
        idle_after_activity_ms: nowMs - existing.lastActivityMs,
        pane_hash: currentHash
      }
    });
  }
}

export function parseCallbackLine(line: string): {
  role: string;
  batchId: string;
  state: string;
  note: string | null;
} | null {
  const match = /^\[projcore callback\]\s+(\S+)\s+(\S+)\s+STATUS:\s+([A-Z-]+)(?:\s+[—-]\s+(.+))?\s*$/.exec(line);
  if (!match) return null;
  const state = match[3];
  if (!TERMINAL_STATES.has(state) && state !== "WORKING" && state !== "PROPOSED" && state !== "NEEDS-INFO" && state !== "REVISE-PLAN") {
    return null;
  }
  return {
    role: match[1],
    batchId: match[2],
    state,
    note: match[4] ?? null
  };
}

export function correlationId(runId: string, batchId: string, state: string): string {
  return `terminal:${runId}:${batchId}:${state}`;
}

export async function readGitHeadBestEffort(runDir: string): Promise<GitHeadSnapshot | null> {
  const gitDir = path.join(runDir, ".git");
  try {
    const gitStat = await stat(gitDir);
    if (!gitStat.isDirectory()) return null;
  } catch {
    return null;
  }

  try {
    const headRaw = await readFile(path.join(gitDir, "HEAD"), "utf8");
    const refMatch = /^ref:\s*(.+)\s*$/m.exec(headRaw);
    if (!refMatch) {
      return { branch: null, head: headRaw.trim() };
    }

    const ref = refMatch[1];
    const refRaw = await readFile(path.join(gitDir, ref), "utf8");
    return {
      branch: ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref,
      head: refRaw.trim()
    };
  } catch {
    return null;
  }
}
