import type { OvermindChildSessionStatus, OvermindTaskLogEntry } from "../overmind-service.js";
import { hasBusySignal } from "./pane-utils.js";

export interface RunIdleDecisionInput {
  coordinatorPane: string;
  childPanes: string[];
  childStatuses: OvermindChildSessionStatus[];
  lastActivityAt: string | null;
  lastParentUpdateAt: string | null;
  taskLog: OvermindTaskLogEntry[];
  trackedArtifactActivityMs: number;
  gitHeadActivityMs: number;
  nowMs: number;
  idleThresholdMs: number;
}

export interface RunIdleDecision {
  idle: boolean;
  active: boolean;
  coordinatorBusy: boolean;
  childBusy: boolean;
  childWorking: boolean;
  recentActivity: boolean;
  latestActivityMs: number;
}

export function decideRunIdle(input: RunIdleDecisionInput): RunIdleDecision {
  const coordinatorBusy = hasBusySignal(input.coordinatorPane);
  const childBusy = input.childPanes.some((pane) => hasBusySignal(pane));
  const childWorking = input.childStatuses.some((child) => child.status === "working");
  const latestActivityMs = Math.max(
    parseTimestampMs(input.lastActivityAt),
    parseTimestampMs(input.lastParentUpdateAt),
    latestTaskLogActivityMs(input.taskLog),
    input.trackedArtifactActivityMs,
    input.gitHeadActivityMs,
    0
  );
  const recentActivity =
    latestActivityMs > 0 && input.nowMs - latestActivityMs <= input.idleThresholdMs;
  const active = coordinatorBusy || childBusy || childWorking || recentActivity;

  return {
    idle: !active,
    active,
    coordinatorBusy,
    childBusy,
    childWorking,
    recentActivity,
    latestActivityMs
  };
}

function latestTaskLogActivityMs(taskLog: OvermindTaskLogEntry[]): number {
  return Math.max(...taskLog.map((entry) => parseTimestampMs(entry.at)), 0);
}

function parseTimestampMs(value: string | null): number {
  if (!value) return 0;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}
