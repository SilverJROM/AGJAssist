import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import path from "node:path";

// ─── Defaults (exported so watcher/tests can fall back without injecting the service) ───
export const DEFAULT_IDLE_NUDGE_COOLDOWN_MIN = 20;
export const DEFAULT_TASK_STALE_ASK_COOLDOWN_MIN = 30;
export const DEFAULT_TASK_STALE_RECENT_UPDATE_GRACE_MIN = 45;
export const DEFAULT_ASK_UPDATE_COOLDOWN_MIN = 45;

export interface OvermindCooldowns {
  idle_nudge_cooldown_minutes: number;
  task_stale_ask_cooldown_minutes: number;
  ask_update_cooldown_minutes: number;
  task_stale_recent_update_grace_minutes: number;
}

interface AppSettingsShape {
  overmind: OvermindCooldowns;
}

const DEFAULTS: AppSettingsShape = {
  overmind: {
    idle_nudge_cooldown_minutes: DEFAULT_IDLE_NUDGE_COOLDOWN_MIN,
    task_stale_ask_cooldown_minutes: DEFAULT_TASK_STALE_ASK_COOLDOWN_MIN,
    ask_update_cooldown_minutes: DEFAULT_ASK_UPDATE_COOLDOWN_MIN,
    task_stale_recent_update_grace_minutes: DEFAULT_TASK_STALE_RECENT_UPDATE_GRACE_MIN
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

  private mergeDefaults(overmind: Partial<OvermindCooldowns> | undefined): OvermindCooldowns {
    const d = DEFAULTS.overmind;
    const o = overmind ?? {};
    return {
      idle_nudge_cooldown_minutes:
        typeof o.idle_nudge_cooldown_minutes === "number" && o.idle_nudge_cooldown_minutes >= 0
          ? o.idle_nudge_cooldown_minutes
          : d.idle_nudge_cooldown_minutes,
      task_stale_ask_cooldown_minutes:
        typeof o.task_stale_ask_cooldown_minutes === "number" && o.task_stale_ask_cooldown_minutes >= 0
          ? o.task_stale_ask_cooldown_minutes
          : d.task_stale_ask_cooldown_minutes,
      ask_update_cooldown_minutes:
        typeof o.ask_update_cooldown_minutes === "number" && o.ask_update_cooldown_minutes >= 0
          ? o.ask_update_cooldown_minutes
          : d.ask_update_cooldown_minutes,
      task_stale_recent_update_grace_minutes:
        typeof o.task_stale_recent_update_grace_minutes === "number" && o.task_stale_recent_update_grace_minutes >= 0
          ? o.task_stale_recent_update_grace_minutes
          : d.task_stale_recent_update_grace_minutes
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
