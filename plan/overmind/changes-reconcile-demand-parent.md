# changes: overmind 30-min reconcile — demand updated list from parent on registration drift

**Verbatim intent:**
> "rather than giving me this BS status ask the parent session about it and demand answers"
> "i dont like to see this NEEDS INFO bs, you have the means to ask the session about it"
> "lets have a routine check every 30mins if there are active workflows to check if all the parent, status, etc are still valid and if its not valid and algo cant make sense of it, ask the parent session about it to send an updated list to overmind"
> "when doing that ask a routine check to the session as well to update their task list if they havent done so. but only do this as an additional to the status request, not on its own"

---

## Files changed

### `src/services/overmind-watcher.ts`
**WHAT:** Added `RECONCILE_MS = 1_800_000`, in-memory `lastReconcileAt = 0` field, and a `reconcile()` method. Wired the 30-min gate into `tick()`.

**WHY:** Stop surfacing a passive NEEDS-INFO badge to JROM. When overmind can't resolve a registration gap deterministically (info_request is set), it now actively demands the parent coordinator re-register and confirm status every 30 minutes.

**How the in-memory gate works:** `lastReconcileAt` is a plain `number` initialized to `0`. In `tick()`, after processing all workflows, if `Date.now() - this.lastReconcileAt >= RECONCILE_MS` (1 800 000 ms = 30 min), `reconcile()` is called and `lastReconcileAt` is reset to `Date.now()`. No DB column, no migration. Resets to 0 on process restart (first reconcile fires after the first 30-min tick).

**reconcile() decision logic (per workflow):**
- Skip if `monitoring_paused` (JROM is talking to the coordinator — no interrupts)
- Skip if `info_request` is null (no gap, nothing to demand)
- Skip if `await sessionExistsSafe(coordinator_session)` is false (parent dead, can't send)
- Otherwise: send ONE consolidated demand naming the gap and requiring the parent to POST `/api/overmind/register` (current child_sessions + child_roles + status) — with the task-list reminder (`POST /api/overmind/tasks`) bundled INTO the same message. Never sent standalone.
- Re-asks on the next 30-min cycle while the gap persists (info_request remains set).
- Best-effort try/catch around each workflow — never throws out of tick.

### `src/web/public/app.js`
**WHAT:** Removed the `⚠ needs info` headline badge (`overmind-needs-info`) from the card header. Removed the `overmind-info-request` substatus line from the always-visible card area. Added a low-key grey `⟳ asked parent to update: <what>` line inside the expanded detail section only (visible only when the card is expanded).

**WHY:** The badge was alarming JROM passively. Now the card shows the real workflow status in the header; the fact that overmind is chasing the parent is a detail visible only on expansion, not a headline alert.

**What was kept intact:** `info_request` / `info_check` fields are unchanged (internal gap gating). Dead-child detection (`dead_child` in assessRegistrationCompleteness) is unchanged — it feeds the parent demand, not a JROM badge. The per-tick immediate first ask (applyCompleteness → sendCommand) is unchanged.

### `tests/overmind-reconcile.test.ts`
**WHAT:** New unit test file for the reconcile decision.

**Cases:**
1. Parent alive + gap (info_request set) → sendCommand to coordinator containing re-register ask + bundled task-list line
2. No gap (info_request null) → no sendCommand
3. monitoring_paused → no sendCommand even with a gap
4. Parent dead (sessionExists false) → no sendCommand
5. Task-list line ONLY appears bundled in the re-register demand — never as a standalone call (single sendCommand total)
6. tick() gate fires when RECONCILE_MS has elapsed (lastReconcileAt old)
7. tick() gate does NOT fire when RECONCILE_MS has not elapsed (lastReconcileAt recent)
8. Multiple workflows: only the one with gap + alive parent receives a demand

---

## Verification

- `npx tsc --noEmit`: clean (no errors)
- `npm run build`: clean
- `npx vitest run`: 27 files, 302 tests — all passed

The NEEDS-INFO badge is no longer shown as a headline card status. The 30-min gate is purely in-memory (`lastReconcileAt` field on the OvermindWatcher instance). The task-list ask is bundled-only: it appears only as the trailing clause of the re-register demand, never in isolation.
