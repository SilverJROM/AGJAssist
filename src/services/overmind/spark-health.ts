import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { OvermindWorkflow, SparkHealth, SparkHealthState } from "./types.js";

const SPARK_HEALTH_STATES = new Set<SparkHealthState>([
  "HEALTHY",
  "IDLE-CLEAN",
  "CRASHED",
  "AMBIGUOUS",
  "ALERT-SOFT",
  "ALERT-MEDIUM",
  "ALERT-HARD",
  "UNKNOWN"
]);

const DEFAULT_STATE_CACHE = path.join(os.homedir(), ".claude", "agents", "telemetry", "spark-daemon-state.json");

interface SparkRunCache {
  last_classification?: unknown;
  last_tick?: unknown;
  last_ambiguous_at?: unknown;
}

interface SparkStateCache {
  runs?: Record<string, SparkRunCache>;
}

function stateCachePath(): string {
  return process.env.SPARK_DAEMON_STATE_CACHE || DEFAULT_STATE_CACHE;
}

function defaultHealth(): SparkHealth {
  return {
    state: "UNKNOWN",
    last_classification: null,
    minutes_since_ambiguous: null
  };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function normalizeState(value: unknown): SparkHealthState {
  if (typeof value !== "string") return "UNKNOWN";
  return SPARK_HEALTH_STATES.has(value as SparkHealthState) ? (value as SparkHealthState) : "UNKNOWN";
}

function minutesSince(value: unknown, nowMs: number): number | null {
  const timestamp = stringOrNull(value);
  if (!timestamp) return null;
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor((nowMs - parsed) / 60000));
}

function readStateCache(): SparkStateCache {
  try {
    const raw = fs.readFileSync(stateCachePath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") return parsed as SparkStateCache;
  } catch {
    // Missing or malformed daemon cache should never break dashboard reads.
  }
  return {};
}

function healthForRun(run: SparkRunCache | undefined, nowMs: number): SparkHealth {
  if (!run || typeof run !== "object") return defaultHealth();
  return {
    state: normalizeState(run.last_classification),
    last_classification: stringOrNull(run.last_tick),
    minutes_since_ambiguous: minutesSince(run.last_ambiguous_at, nowMs)
  };
}

export function augmentWorkflowSparkHealth<T extends Pick<OvermindWorkflow, "id">>(
  workflows: T[],
  nowMs = Date.now()
): Array<T & { spark_health: SparkHealth }> {
  const cache = readStateCache();
  const runs = cache.runs && typeof cache.runs === "object" ? cache.runs : {};
  return workflows.map((workflow) => ({
    ...workflow,
    spark_health: healthForRun(runs[String(workflow.id)], nowMs)
  }));
}
