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

// The daemon ticks ~every 30s. If a run's last_tick is older than this, the daemon
// isn't actively classifying it (stopped / disabled / dropped), so its last
// classification is FROZEN and must NOT drive the dashboard (e.g. a stale CRASHED
// haunting a live run). 120s = 4x the tick interval.
const STALE_TICK_MS = 120_000;
// When spark data is stale, reflect the run's own liveness: an active run is healthy.
const ACTIVE_HEALTHY_STATUSES = new Set<string>(["active", "working"]);

function tickAgeMs(value: unknown, nowMs: number): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000; // epoch ms vs seconds
    return Math.max(0, nowMs - ms);
  }
  const ts = stringOrNull(value);
  if (!ts) return null;
  const parsed = Date.parse(ts);
  return Number.isFinite(parsed) ? Math.max(0, nowMs - parsed) : null;
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

function healthForRun(run: SparkRunCache | undefined, nowMs: number, status?: string): SparkHealth {
  const age = run && typeof run === "object" ? tickAgeMs(run.last_tick, nowMs) : null;
  const stale = age === null || age > STALE_TICK_MS;
  if (!run || typeof run !== "object" || stale) {
    // Daemon isn't actively classifying this run (off / disabled / dropped) → never
    // surface its frozen classification. Reflect the run's own liveness instead:
    // an active/working run shows HEALTHY (green); anything else, UNKNOWN.
    if (status && ACTIVE_HEALTHY_STATUSES.has(status)) {
      return { state: "HEALTHY", last_classification: null, minutes_since_ambiguous: null };
    }
    return defaultHealth();
  }
  return {
    state: normalizeState(run.last_classification),
    last_classification: stringOrNull(run.last_tick),
    minutes_since_ambiguous: minutesSince(run.last_ambiguous_at, nowMs)
  };
}

export function augmentWorkflowSparkHealth<T extends Pick<OvermindWorkflow, "id" | "status">>(
  workflows: T[],
  nowMs = Date.now()
): Array<T & { spark_health: SparkHealth }> {
  const cache = readStateCache();
  const runs = cache.runs && typeof cache.runs === "object" ? cache.runs : {};
  return workflows.map((workflow) => ({
    ...workflow,
    spark_health: healthForRun(runs[String(workflow.id)], nowMs, workflow.status as string | undefined)
  }));
}
