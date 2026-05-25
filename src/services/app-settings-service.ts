import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import path from "node:path";

// ─── Defaults (exported so watcher/tests can fall back without injecting the service) ───
export const DEFAULT_STUCK_NUDGE_COOLDOWN_MIN = 20;
/** @deprecated Use DEFAULT_STUCK_NUDGE_COOLDOWN_MIN. */
export const DEFAULT_IDLE_NUDGE_COOLDOWN_MIN = DEFAULT_STUCK_NUDGE_COOLDOWN_MIN;
// JROM 2026-05-24 v2.1 — file-read cadence floor. The mtime-advanced shortcut
// in assessTaskStaleness still triggers an immediate re-read on file changes;
// this only applies when nothing has changed.
export const DEFAULT_EVIDENCE_READ_CADENCE_MIN = 3;
// JROM 2026-05-24 v2.3 — replaces the old DEFAULT_ASK_UPDATE_COOLDOWN_MIN
// (was 45). How long MAX(last_parent_update_at, progress.md mtime,
// callbacks.md mtime) must remain unchanged before the idle-detection nag
// fires.
export const DEFAULT_UNIFIED_IDLE_THRESHOLD_MIN = 30;
/** @deprecated Use DEFAULT_UNIFIED_IDLE_THRESHOLD_MIN. */
export const DEFAULT_EVIDENCE_IDLE_THRESHOLD_MIN = DEFAULT_UNIFIED_IDLE_THRESHOLD_MIN;

/** @deprecated Kept only as a const for callers that haven't migrated yet.
 *  Use DEFAULT_UNIFIED_IDLE_THRESHOLD_MIN. */
export const DEFAULT_ASK_UPDATE_COOLDOWN_MIN = DEFAULT_UNIFIED_IDLE_THRESHOLD_MIN;

export interface OvermindCooldowns {
  stuck_nudge_cooldown_minutes: number;
  // JROM v2.1 — read cadence (default 3 min) for progress.md + callbacks.md.
  evidence_read_cadence_minutes: number;
  unified_idle_threshold_minutes: number;
}

interface AppSettingsShape {
  overmind: OvermindCooldowns;
}

const DEFAULTS: AppSettingsShape = {
  overmind: {
    stuck_nudge_cooldown_minutes: DEFAULT_STUCK_NUDGE_COOLDOWN_MIN,
    evidence_read_cadence_minutes: DEFAULT_EVIDENCE_READ_CADENCE_MIN,
    unified_idle_threshold_minutes: DEFAULT_UNIFIED_IDLE_THRESHOLD_MIN
  }
};

const CACHE_TTL_MS = 5_000;

export class AppSettingsService {
  private cachedAt = 0;
  private cached: AppSettingsShape | null = null;

  // Computed at construction time so that process.cwd() can be overridden in tests
  // (module-level constants are evaluated once at import, defeating spies).
  private readonly dataDir: string;
  private readonly settingsFile: string;

  constructor() {
    this.dataDir = path.resolve(process.cwd(), "data");
    this.settingsFile = path.join(this.dataDir, "app-settings.json");
  }

  /** Returns the overmind cooldowns sub-object, with defaults filled in for missing keys. */
  get(): OvermindCooldowns {
    const now = Date.now();
    if (this.cached && now - this.cachedAt < CACHE_TTL_MS) {
      return this.mergeDefaults(this.cached.overmind);
    }
    // Cache expired — try sync read so callers in the watcher hot-path don't need to await.
    // A background refresh happens asynchronously; the stale value is returned in the interim.
    void this.refreshAsync();
    return this.cached
      ? this.mergeDefaults(this.cached.overmind)
      : { ...DEFAULTS.overmind };
  }

  /** Load settings from disk (async). Must be called at startup to warm the cache. */
  async load(): Promise<void> {
    try {
      const raw = await readFile(this.settingsFile, "utf-8");
      const parsed = JSON.parse(raw) as Partial<AppSettingsShape>;
      this.cached = this.mergeShape(parsed);
      this.cachedAt = Date.now();
    } catch {
      // File missing or corrupt — use defaults, create the file.
      this.cached = { ...DEFAULTS };
      this.cachedAt = Date.now();
      await this.persistSafe(this.cached);
    }
  }

  /**
   * Update a single overmind cooldown key.
   * Validates that value is a finite number >= 0; rejects NaN and negatives.
   * Writes atomically via rename. Updates cache immediately.
   */
  async setOvermindCooldown(
    key: keyof OvermindCooldowns,
    value: number
  ): Promise<void> {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`Invalid cooldown value for ${key}: must be a non-negative finite number`);
    }
    // Ensure we have the latest state before mutating.
    if (!this.cached) await this.load();
    const next: AppSettingsShape = {
      overmind: {
        ...this.mergeDefaults(this.cached!.overmind),
        [key]: value
      }
    };
    await this.persistAtomic(next);
    this.cached = next;
    this.cachedAt = Date.now();
  }

  private async refreshAsync(): Promise<void> {
    try {
      const raw = await readFile(this.settingsFile, "utf-8");
      const parsed = JSON.parse(raw) as Partial<AppSettingsShape>;
      this.cached = this.mergeShape(parsed);
      this.cachedAt = Date.now();
    } catch {
      // Ignore — stale cache is fine for a background refresh.
    }
  }

  private mergeDefaults(
    overmind: Partial<OvermindCooldowns> & {
      idle_nudge_cooldown_minutes?: number;
      evidence_idle_threshold_minutes?: number;
      ask_update_cooldown_minutes?: number;
    } | undefined
  ): OvermindCooldowns {
    const d = DEFAULTS.overmind;
    const o = overmind ?? {};
    const stuckCooldownFromOldKey =
      typeof o.idle_nudge_cooldown_minutes === "number" && o.idle_nudge_cooldown_minutes >= 0
        ? o.idle_nudge_cooldown_minutes
        : undefined;
    const unifiedThresholdFromOldKey =
      typeof o.evidence_idle_threshold_minutes === "number" && o.evidence_idle_threshold_minutes > 0
        ? o.evidence_idle_threshold_minutes
        : typeof o.ask_update_cooldown_minutes === "number" && o.ask_update_cooldown_minutes > 0
          ? o.ask_update_cooldown_minutes
          : undefined;
    return {
      stuck_nudge_cooldown_minutes:
        typeof o.stuck_nudge_cooldown_minutes === "number" && o.stuck_nudge_cooldown_minutes >= 0
          ? o.stuck_nudge_cooldown_minutes
          : (stuckCooldownFromOldKey ?? d.stuck_nudge_cooldown_minutes),
      evidence_read_cadence_minutes:
        typeof o.evidence_read_cadence_minutes === "number" && o.evidence_read_cadence_minutes > 0
          ? o.evidence_read_cadence_minutes
          : d.evidence_read_cadence_minutes,
      unified_idle_threshold_minutes:
        typeof o.unified_idle_threshold_minutes === "number" && o.unified_idle_threshold_minutes > 0
          ? o.unified_idle_threshold_minutes
          : (unifiedThresholdFromOldKey ?? d.unified_idle_threshold_minutes)
    };
  }

  private mergeShape(parsed: Partial<AppSettingsShape>): AppSettingsShape {
    return {
      overmind: this.mergeDefaults(parsed.overmind)
    };
  }

  private async persistAtomic(data: AppSettingsShape): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    const tmp = `${this.settingsFile}.tmp.${Date.now()}`;
    await writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
    await rename(tmp, this.settingsFile);
  }

  private async persistSafe(data: AppSettingsShape): Promise<void> {
    try {
      await this.persistAtomic(data);
    } catch {
      // Non-fatal if data dir isn't writable yet.
    }
  }
}
