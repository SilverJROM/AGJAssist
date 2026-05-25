# Overmind Idle Detection — Three-Path Refactor

## Goal
Replace the current overlapping dual-nudge system with a clean three-path design. One shared
cooldown key (`unified_idle_nudge`) prevents double-firing across all paths.

---

## Three Paths

### PATH 1 — Stuck response (existing, clean up)
- **Trigger**: `classifyWorkflow` result `status === "stuck"` (pane unchanged 90s)
- **Gate**: no subagent in flight, not terminal, not monitoring_paused
- **Cooldown**: `stuck_nudge_cooldown_minutes` (renamed from `idle_nudge_cooldown_minutes`, default 20min)
  via the **shared `unified_idle_nudge`** cooldown key
- **Action**: fire canned nudge (`CANNED_NUDGE` or `CANNED_NUDGE_NO_CHILD`), increment `nudge_count`
- **Escalation**: after `MAX_CANNED_NUDGES` (2) → Tier-3 Brain (unchanged logic)
- **Reset**: nudge_count back to 0 when status returns "working" (unchanged)

### PATH 2 — All sessions idle (existing behavior, kept separate)
- **Trigger**: `parentStatus !== "working"` AND all child statuses are `idle` or `closed`
  (the current `apparentIdle` detection using `apparentIdleSince` map — keep it)
- **Gate**: no subagent in flight, not terminal, not monitoring_paused
- **Grace delay**: `apparentIdleSince` must be ≥ `SUBAGENT_APPARENT_IDLE_BEFORE_ASK_MS` (keep at 10min)
- **Cooldown**: uses the **shared `unified_idle_nudge`** key, with cooldown = `stuck_nudge_cooldown_minutes` (20min)
  (the old `subagent_ask` key is RETIRED — merge into `unified_idle_nudge`)
- **Action**: fire a SINGLE unified idle message (see message template below) — no separate subagent ask message
- **Does NOT increment nudge_count** — this is not an escalation step
- **Note**: if PATH 1 fired at t=0 (20min cooldown), PATH 2 can't fire until t=20min.

### PATH 3 — Artifact fail-safe timer (new, replaces maybeAskForParentUpdate)
- **Trigger**: `MAX(last_parent_update_at, progress.md mtime, callbacks.md mtime, queue.md mtime)` is stale
  for ≥ `unified_idle_threshold_minutes` (30min default). Fires **regardless of pane state** (the session
  may appear "working" by pane — this is the fail-safe for when pane-based detection fails).
- **Gate**: not terminal, not monitoring_paused, not subagent_in_flight
- **Cooldown**: uses the **shared `unified_idle_nudge`** key, with cooldown = `unified_idle_threshold_minutes` (30min)
- **Action**: fire fail-safe nudge referencing artifact staleness
- **Does NOT increment nudge_count**
- **Per-workflow override**: `evidence_idle_threshold_override_minutes` on the workflow record
  (field already exists in DB, keep the name — no DB migration needed)

---

## Shared Cooldown Key

**All three paths use the same `unified_idle_nudge` key** in `WatcherCooldowns` and `NudgeStateService`.

On deploy, seed the key from the MAX of legacy keys to prevent a nudge burst:
```ts
const lastLegacy = Math.max(
  cooldowns.getLastFired(wid, "idle_nudge"),
  cooldowns.getLastFired(wid, "ask_update"),
  cooldowns.getLastFired(wid, "subagent_ask")
);
const lastUnified = nudgeState.getLastUnifiedIdleNudge(wid) ||
                    cooldowns.getLastFired(wid, "unified_idle_nudge") ||
                    lastLegacy;
```

---

## Messages

### PATH 1 — Stuck (keep existing CANNED_NUDGE / CANNED_NUDGE_NO_CHILD)
No change needed to message text.

### PATH 2 — All sessions idle (new unified message, replace the old subagent-specific message)
```
Overmind: all sessions appear idle — parent and all children are quiet.

If you have an in-process subagent running, reply with:
  [OVERMIND] subagent <name> ~<N>min
Otherwise, check callbacks.md for pending work, update progress.md with current status, or report STATUS.
```

### PATH 3 — Artifact fail-safe
```
Overmind: no tracked artifact has advanced in ~${staleMinutes} minutes (progress.md / callbacks.md / queue.md).
Are you still working? Update progress.md with current status, or POST /api/overmind/complete if done.
```

---

## File-by-File Changes

### 1. `src/services/app-settings-service.ts`
- Add `unified_idle_threshold_minutes: number` to `OvermindCooldowns` interface (default 30)
- Rename `idle_nudge_cooldown_minutes` → `stuck_nudge_cooldown_minutes` in interface, DEFAULTS, and `mergeDefaults`
- Add backward-compat read: if `idle_nudge_cooldown_minutes` is in the JSON, use its value for `stuck_nudge_cooldown_minutes`
- Export `DEFAULT_UNIFIED_IDLE_THRESHOLD_MIN = 30` and `DEFAULT_STUCK_NUDGE_COOLDOWN_MIN = 20`
- Keep `DEFAULT_EVIDENCE_IDLE_THRESHOLD_MIN` as a deprecated alias pointing to `DEFAULT_UNIFIED_IDLE_THRESHOLD_MIN`

### 2. `src/services/nudge-state-service.ts`
- Add `lastUnifiedIdleNudgeAt?: number` to `WorkflowNudgeState` interface
- Add `getLastUnifiedIdleNudge(workflowId: number): number` method
- Add `setLastUnifiedIdleNudge(workflowId: number, ms: number): void` method
- Keep old `getLastIdleNudge`/`setLastIdleNudge`, `getLastAskUpdateNudge`/`setLastAskUpdateNudge` as no-op
  backward-compat stubs (they write to `lastUnifiedIdleNudgeAt` internally so old callers still work)

### 3. `src/services/overmind/idle-detector.ts`
Replace `maybeAskForParentUpdate` entirely with two exports:

```ts
// Helper: returns the max mtime across all tracked artifact files
export async function getLastTrackedArtifactActivityMs(runDir: string): Promise<number>

// Helper: returns the effective fail-safe threshold in ms (per-workflow override or global setting)
export function effectiveUnifiedIdleThresholdMs(workflow, appSettings?): number

// PATH 3 implementation
export async function maybeFireArtifactFailsafe(
  workflow: OvermindWorkflow,
  resolvedRunDir: string,
  deps: {
    tmuxService: TmuxService;
    cooldowns: WatcherCooldowns;
    appSettings?: AppSettingsService;
    nudgeState?: NudgeStateService;
    TERMINAL_STATUSES: OvermindWorkflowStatus[];
  }
): Promise<boolean>  // returns true if nudge was fired
```

`maybeFireArtifactFailsafe` logic:
1. Guard: terminal / monitoring_paused / subagent_in_flight → return false
2. `lastActivityMs = getLastTrackedArtifactActivityMs(runDir)`
3. `thresholdMs = effectiveUnifiedIdleThresholdMs(workflow, appSettings)`
4. If `now - lastActivityMs <= thresholdMs` → return false
5. Check `unified_idle_nudge` cooldown (same threshold) → if still in cooldown → return false
6. Build message with staleMinutes, fire, record `unified_idle_nudge` → return true

### 4. `src/services/overmind/nudge-ladder.ts`
Modify `applyNudgeLadder`:
- Change the cooldown key from `"idle_nudge"` → `"unified_idle_nudge"`
- Change the setting read from `idle_nudge_cooldown_minutes` → `stuck_nudge_cooldown_minutes`
- Update `nudgeState` calls: use `getLastUnifiedIdleNudge` / `setLastUnifiedIdleNudge`
- Everything else (Tier-3 Brain, MAX_CANNED_NUDGES, nudge_count, message text) stays the same

### 5. `src/services/overmind-watcher.ts`
In `tickWorkflow`:

**Remove**:
- The call to `maybeAskForParentUpdate` (replaced by PATH 3)
- The standalone `subagent_ask` block (the 10min idle → ask about subagent message) — this becomes PATH 2
- The `lastSubagentAskAt` store alias

**Keep**:
- `apparentIdleSince` map (reused for PATH 2's grace period)
- `subagentInFlight` map (used for suppression gate in all three paths)
- `applyNudgeLadder` call (PATH 1 — unchanged trigger, just uses new cooldown key)
- `applyDecisionInterception` (unchanged)

**Add after the subagent-in-flight tracking block and before `allTasksComplete` check**:

```ts
// PATH 2 — All sessions idle nudge
if (!currentSaEntry) {
  const parentNotWorking = parentStatus !== "working";
  const allChildrenQuiet = childStatuses.every(c => c.status === "idle" || c.status === "closed");
  const apparentIdle = parentNotWorking && allChildrenQuiet;

  if (apparentIdle) {
    if (!this.apparentIdleSince.has(wid)) this.apparentIdleSince.set(wid, nowMs);
  } else {
    this.apparentIdleSince.delete(wid);
  }

  const idleSince = this.apparentIdleSince.get(wid);
  if (
    idleSince !== undefined &&
    nowMs - idleSince >= SUBAGENT_APPARENT_IDLE_BEFORE_ASK_MS
  ) {
    const stuckCooldownMs = (this.appSettings?.get().stuck_nudge_cooldown_minutes ?? 20) * 60_000;
    const lastUnified =
      this.nudgeState?.getLastUnifiedIdleNudge(wid) ??
      this.cooldowns.getLastFired(wid, "unified_idle_nudge");
    if (nowMs - lastUnified >= stuckCooldownMs) {
      const hasChildren = (workflow.child_sessions?.length ?? 0) > 0;
      const msg = hasChildren
        ? "Overmind: all sessions appear idle — parent and all children are quiet.\n\nIf you have an in-process subagent running, reply with:\n  [OVERMIND] subagent <name> ~<N>min\nOtherwise, check callbacks.md for pending work, update progress.md with current status, or report STATUS."
        : "Overmind: your session appears idle — no child sessions are active.\n\nIf you have an in-process subagent running, reply with:\n  [OVERMIND] subagent <name> ~<N>min\nOtherwise, resume work or report STATUS.";
      try {
        await this.tmuxService.sendAndSubmit(workflow.coordinator_session, msg);
        this.cooldowns.recordFired(wid, "unified_idle_nudge", nowMs);
        this.nudgeState?.setLastUnifiedIdleNudge(wid, nowMs);
      } catch (err) {
        console.error("Overmind PATH 2 idle nudge failed:", err);
      }
    }
  }
}

// PATH 3 — Artifact fail-safe (fires regardless of pane state)
await maybeFireArtifactFailsafe(workflow, resolvedRunDir, {
  tmuxService: this.tmuxService,
  cooldowns: this.cooldowns,
  appSettings: this.appSettings,
  nudgeState: this.nudgeState,
  TERMINAL_STATUSES,
  subagentInFlight: this.subagentInFlight.has(wid),
});
```

**Remove** `lastSubagentAskAt` CooldownTimestampStore (the `"subagent_ask"` key is retired).

**In `cleanupWorkflowState`**: retire cleanup of `"idle_nudge"`, `"ask_update"`, `"subagent_ask"` keys — only cleanup `"unified_idle_nudge"` going forward (old keys will expire naturally).

### 6. `src/services/overmind/workflow-cleanup.ts`
Update `cleanupWorkflowState` to also forget `"unified_idle_nudge"` in addition to (or replacing) the old keys.

---

## Tests to Update/Add

### `tests/overmind-nudge.test.ts`
- Update tests that reference `idle_nudge_cooldown_minutes` → `stuck_nudge_cooldown_minutes`
- Update tests that reference `getLastIdleNudge` / `getLastAskUpdateNudge` → `getLastUnifiedIdleNudge`
- Update tests that reference cooldown key `"idle_nudge"` or `"ask_update"` → `"unified_idle_nudge"`
- Add tests for PATH 2 (all-idle nudge), PATH 3 (artifact fail-safe)
- Add test: PATH 1 fires at t=0 → PATH 2 cannot fire within `stuck_nudge_cooldown_minutes`
- Add test: PATH 3 fires despite pane being "working" (pane changed) if artifacts stale ≥ threshold

### `tests/app-settings-service.spec.ts`
- Update to use renamed setting `stuck_nudge_cooldown_minutes`
- Test backward-compat: JSON with `idle_nudge_cooldown_minutes` key is read as `stuck_nudge_cooldown_minutes`

### `tests/nudge-state-service.spec.ts`
- Add tests for `getLastUnifiedIdleNudge` / `setLastUnifiedIdleNudge`

---

## What NOT to change
- `STUCK_THRESHOLD_MS = 90_000` — keep, used only for "stuck" classification in classifier
- `MAX_CANNED_NUDGES = 2` — keep
- `SUBAGENT_APPARENT_IDLE_BEFORE_ASK_MS = 10min` — keep
- `SUBAGENT_REASK_GRACE_MS` — RETIRE (the 2h re-ask grace is replaced by the shared 20min cooldown)
- `evidence_read_cadence_minutes` setting — keep, separate concern
- `evidence_idle_threshold_override_minutes` on workflow DB record — keep (used as PATH 3 per-workflow override)
- Tier-3 Brain logic in `nudge-ladder.ts` — keep entirely, just moves to use new cooldown key
- `applyDecisionInterception` — keep entirely unchanged
- `RECONCILE_MS` (30min reconcile) — keep, separate concern

---

## Run tests to verify
```
cd /home/agjrom/TGBOTS/AGJAssist && npm test -- --testPathPattern="overmind-nudge|app-settings|nudge-state" 2>&1
```

If all pass, also run full test suite:
```
cd /home/agjrom/TGBOTS/AGJAssist && npm test 2>&1
```
