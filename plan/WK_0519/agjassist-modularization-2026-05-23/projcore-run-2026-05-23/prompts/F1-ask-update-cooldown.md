# F1 — "Last parent update" stat + ask-update cooldown (system + per-workflow override)

You are the implementer for AGJAssist (the supervisor is Claude, working in
master at /home/agjrom/TGBOTS/AGJAssist). Build the feature described below
end-to-end: backend, frontend, tests, deploy-smoke. Strict zero-behavior-change
for everything else: existing tests must remain at the current baseline
(`443 passed | 1 skipped`); the test you add must pass.

## What JROM asked for (verbatim)

> add this stat on the overmind workflow details, time since last update, this
> is a tracker since the last time the parent session gave you an update and
> track it on the details in minutes, and add on the cooldowns that i can
> configure set it default to 45mins, but changeable. so basically the cooldown
> standard is if it breaches this CD, overmind (algorithmically) ask for an
> update to the parent session, and this refreshes everytime ovm gets an update
> (any update) from the session (has to be from api calls) not the ones that ovm
> actively checks. and on the workflow themselves on the details page have a
> manual override of this cooldown have a dropdown with 5mins increments on
> this update feature, but always default to the system cd.

## Locked design (do NOT redesign)

### Backend

1. **Schema bump v23 → v24** in `src/db/schema.ts` + the migration block in
   `src/db/database.ts` (the migration block stayed in database.ts per DEC-003).
   Add two nullable columns to `overmind_workflows`:
   - `last_parent_update_at TEXT` — ISO timestamp; written ONLY by
     parent-initiated API endpoints (register / tasks / complete / pause /
     resume). NEVER written by the watcher.
   - `ask_update_cooldown_override_minutes INTEGER` — nullable; null means "use
     system default". When set, it's the per-workflow override (5-min
     increments enforced at the route level).
   Both fields go into SCHEMA_SQL for fresh DBs AND into a guarded
   `ALTER TABLE overmind_workflows ADD COLUMN …` inside the v24 migration block
   for upgrade DBs. Follow the same pattern the v22/v23 migrations use
   (`pragma table_info(...)` to detect column presence first).

2. **`src/services/overmind/types.ts`**: add the two new fields to
   `OvermindWorkflow`, `last_parent_update_at: string | null` and
   `ask_update_cooldown_override_minutes: number | null`.

3. **`src/services/overmind-service.ts`** (the `OvermindService` class):
   - Add a private helper `touchParentUpdate(workflowId)` that runs
     `UPDATE overmind_workflows SET last_parent_update_at = ? WHERE id = ?` with
     `this.isoNow()`. Use this from `register`, `setTasks`,
     `setMonitoringPaused`, and the route-level `/complete`+`/pause`+`/resume`
     paths.
   - Specifically: call `touchParentUpdate` from inside `register` AFTER the
     INSERT/UPSERT lands (so the new row's `last_parent_update_at` is non-null
     immediately), inside `setTasks` (since tasks updates are the canonical
     "parent talked to me" signal), inside `setMonitoringPaused`, and inside
     `setStatus` ONLY when called from /complete (route-level call below).
   - Add `setAskUpdateCooldownOverride(id, minutes | null)` that validates
     minutes is null or a positive multiple of 5, then updates the column.
   - Update `mapRow` to surface the two new fields. Update SELECT lists if any
     are explicit (the class mostly uses `SELECT *`).

4. **`src/services/app-settings-service.ts`**: add
   `ask_update_cooldown_minutes` to `OvermindCooldowns` (default 45). Wire
   defaults / mergeDefaults / DEFAULTS exactly like the existing three keys.
   Add `export const DEFAULT_ASK_UPDATE_COOLDOWN_MIN = 45;`

5. **`src/api/routes/app-settings-routes.ts`** (or wherever the cooldown PATCH
   lives): no changes needed if it already accepts arbitrary keys of
   `OvermindCooldowns` — verify; if it whitelists keys, add the new one.

6. **`src/api/routes/overmind-routes.ts`**:
   - Add `app.post<{ Params: WorkflowParams; Body: { override_minutes?: number | null; token?: string } }>("/api/overmind/workflows/:id/ask-update-cooldown", …)` — JWT-authed (owner-only) like the rename route. Body: `{ override_minutes: number | null }`. Validation: null OR positive integer multiple of 5, between 5 and 240 inclusive. Returns the updated workflow.
   - In the existing `/register`, `/tasks`, `/complete`, `/pause`, `/resume`
     handlers: after the service call, ensure `last_parent_update_at` has been
     touched. The cleanest place is inside the service methods (above) so the
     routes don't need to know.

7. **`src/services/overmind-watcher.ts`** — add the "ask for update" nudge:
   - In `tickWorkflow`, after the existing classification but BEFORE the
     idle-nudge ladder, check: if `workflow.last_parent_update_at` is not null
     AND `now - last_parent_update_at_ms > effectiveCooldownMs(workflow)`,
     emit ONE nudge to the parent: `"Overmind: you haven't sent any update via
     the API in ~N minutes — please POST /api/overmind/tasks (or /complete if
     you're done) so I can track this run."` Then set an in-memory cooldown on
     this specific ask (same Map pattern as `lastIdleNudgeAt`, e.g.
     `lastAskUpdateNudgeAt: Map<number, number>`) and re-arm via the same
     cooldown window (don't ask again for at least `effectiveCooldownMs` from
     the previous ask).
   - `effectiveCooldownMs(workflow)`:
     ```
     const overrideMin = workflow.ask_update_cooldown_override_minutes;
     const systemMin = appSettings.get().ask_update_cooldown_minutes;
     return (overrideMin ?? systemMin) * 60 * 1000;
     ```
   - Skip the check entirely when `workflow.monitoring_paused === true` OR
     when the workflow is in a terminal status (paused / completed / failed).
   - Use `tmuxService.sendAndSubmit` (same pattern as other nudges).

8. **`src/services/overmind/types.ts`** + **`src/api/websocket/overmind-stream-manager.ts`**: the websocket already streams the full workflow row — adding the two new fields should flow through automatically. Verify nothing strips them.

### Frontend (vanilla Preact/HTM in `src/web/public/app.js`, no build step)

1. **Workflow details panel** — the section that shows `last_activity_at`,
   `stuck_since`, etc. should now also show:
   - Row: `Last parent API update:  <N min ago>` (computed from
     `last_parent_update_at`; show `"—"` if null). Mirror the visual style of
     the existing "Last activity" row.
   - Below that, a dropdown labelled `Ask-update cooldown override:` with
     options `System default (N min)` (where N is the system value, refreshed
     when settings change), then `5 min`, `10 min`, …, `180 min` (5-min
     increments). Selecting `System default` POSTs `{override_minutes: null}`;
     a numeric option POSTs `{override_minutes: <n>}`. Default selection is
     `System default (N min)` when `ask_update_cooldown_override_minutes` is
     null, otherwise the matching numeric option.
   - On change → POST `/api/overmind/workflows/:id/ask-update-cooldown` with
     JWT. Optimistic UI; on error, revert + show a toast.

2. **Settings page** (the `OvermindCooldownsSection` from earlier work): add a
   fourth numeric input row, labelled `Ask-update cooldown (minutes)`, between
   `Task stale ask cooldown` and `Task stale recent update grace`. Wire the
   same way the other three are wired (PATCH to the settings route on blur or
   on Enter).

3. **Cache-bust**: bump `?v=` in `src/web/public/index.html`.

### Tests (vitest)

Add tests that fail before the feature and pass after, following the
conventions of the existing overmind tests:

1. **`tests/overmind-service.test.ts`** —
   - "register sets last_parent_update_at to now"
   - "setTasks refreshes last_parent_update_at"
   - "setAskUpdateCooldownOverride accepts null and positive multiples of 5
     between 5 and 240; rejects other values"

2. **`tests/overmind-routes.test.ts`** —
   - "POST /api/overmind/workflows/:id/ask-update-cooldown sets / clears the
     override, JWT-authed"
   - "validation rejects 7, -5, 245, 4.5"

3. **`tests/overmind-watcher.test.ts`** (or wherever the watcher's existing
   nudge tests live — search first; pick the file with the idle-nudge test for
   parity):
   - "ask-update nudge fires once when last_parent_update_at is older than the
     effective cooldown"
   - "ask-update nudge re-arms once the in-memory cooldown elapses"
   - "ask-update nudge respects per-workflow override (overrides system
     default)"
   - "ask-update nudge does NOT fire for paused or terminal workflows"

4. **`tests/app-settings-service.test.ts`** (or wherever that's tested) — the
   new `ask_update_cooldown_minutes` key round-trips with default 45.

### Acceptance gate

- `npx tsc --noEmit` clean.
- `npx vitest run` shows `<at-least-443+N> passed | 1 skipped | 0 failed` where
  N is the number of tests you added.
- `npm run build` succeeds.
- `pm2 restart agjassist` + `curl http://127.0.0.1:3101/api/health` → 200.
- DB upgrade path: a fresh DB AND a v23-snapshot DB both end at v24 with the
  two new columns. (If you have any doubt, add a brief test that opens a v23
  DB and verifies v24 columns exist post-init.)
- The dashboard shows the new "Last parent API update" row on each workflow
  card; the dropdown defaults to "System default (45 min)" and persists when
  changed.

### Out of scope

- Notification/Telegram changes (the watcher's existing nudge plumbing is what
  carries the new ask message).
- Renaming or migrating any existing column.
- Settings UI redesign — minimal addition only.

### Workflow

1. Read the relevant files listed above to confirm exact insertion points.
2. Implement backend first (schema → service → routes), test as you go.
3. Implement frontend.
4. Build + restart + smoke.
5. Commit on master with message: `[overmind] last-parent-update tracking + ask-update cooldown (system + per-workflow override)`
6. End with one of: `STATUS: DONE` / `STATUS: BLOCKED <reason>` / `STATUS: NEEDS-DECISION <question>`.
