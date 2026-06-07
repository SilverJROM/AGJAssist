# Changes - Issue-001 All-Done Workflows Auto-Complete

## User Report

> on the worklist there is a completed stale task list, can you fix the app to confirm the tasks if they are completed and always remove it from the list if they are already completed, the only workflows here should be active if they are stale ask the agents to work if its already completed remove them on active
> this is a bug on the app list, please fix this so this does not happen again

## Root Cause / Mechanism

- `handleAllTasksDone` in `src/services/overmind/completion-detector.ts` correctly detects that every registered task is `done`, then runs the completion brain.
- When the verdict was not `working` (including the no-brain deterministic `consult` fallback), the function sent a coordinator nudge and wrote `status = "waiting_human"`.
- `waiting_human` is still included by the Active worklist filter (`status NOT IN ('completed','failed','paused')`), so all-done workflows that never POSTed `/api/overmind/complete` stayed visible in Active indefinitely.

## Files Changed

- `src/services/overmind/completion-detector.ts` - changed the all-done non-`working` verdict path to reuse the canonical terminal completion transition.
- `tests/overmind-nudge.test.ts` - updated the stale all-done watcher test to assert auto-completion and once-only DONE notification; added coverage that a brain `working` verdict stays active.
- `tests/overmind-brain.test.ts` - updated completion-edge brain coverage for the new auto-complete behavior.
- `plan/WK_0603/coord-autocomplete-stale-2026-06-05/status/issue-001-iter1.status.yaml` - coord-compatible progress status.

## What Changed

- For all-done workflows where the completion brain does not say `working`, the detector now:
  - Clears pending/stuck/nudge state and records the all-done completion signature.
  - Calls `overmindService.setStatus(workflow.id, "completed", { touchParentUpdate: true })`.
  - Marks `done:completed` through `markNotificationTransition`.
  - Emits the same DONE notification body used by `/api/overmind/complete`, guarded so it fires once.
- The `working` verdict branch is unchanged and remains active.
- The stale-but-incomplete nudge path is untouched.

## Verification

- command or method: `npx tsc --noEmit`
- result: PASS
- evidence: completed with exit code 0.

- command or method: `npx vitest run tests/overmind-nudge.test.ts tests/overmind-brain.test.ts`
- result: PASS
- evidence: 2 test files passed, 35 tests passed.

- command or method: `npx vitest run`
- result: PASS
- evidence: 41 test files passed, 547 tests passed, 1 skipped.

- command or method: `npx tsc && cp -r src/web dist/ && pm2 restart agjassist`
- result: PASS
- evidence: PM2 restarted `agjassist` and reported status `online`.

- command or method: `curl -sS -o /tmp/agjassist-dev-smoke.html -w '%{http_code} %{content_type}\n' http://127.0.0.1:3101/`
- result: PASS
- evidence: `200 text/html; charset=utf-8`.

## Standing Rules

- When an Overmind workflow has a server-validated all-done task list and the completion brain does not return `working`, the deterministic result is terminal completion, not a human wait state.

## Caveats

- Earlier I started a focused and full Vitest run in parallel; `overmind-nudge.test.ts` uses a shared SQLite test path, so that produced transient disk I/O failures. Sequential reruns passed.

## Iteration 2 Send-Back

### User Report

> ...always remove it from the list if they are already completed... this is a bug on the app list, please fix this so this does not happen again.

### Root Cause / Mechanism

- Iteration 1 fixed workflows that newly reached an all-done signature.
- Already-parked all-done workflows still hit the top `completion_check === signature` early-return in `handleAllTasksDone`.
- That early-return cleared stuck/nudge state and returned before reaching the new terminal completion path, so runs like `status = "stuck"`, `completion_check = "23/23"`, and `23/23` tasks done stayed in Active forever.

### Files Changed

- `src/services/overmind/completion-detector.ts` - moved the terminal completion transition into `completeWorkflowOnce` and calls it from the early-return path when the workflow is not `working`.
- `tests/overmind-nudge.test.ts` - added parked all-done regression coverage for non-`working` auto-complete and `working` stay-active behavior.

### What Changed

- Any all-done workflow whose completion signature is already recorded now auto-completes if its current status is not `working`.
- Workflows currently marked `working` still use the existing early-return cleanup and remain active.
- The iter1 newly-all-done completion path still uses the same `completeWorkflowOnce` terminal transition.

### Verification

- command or method: `npx tsc --noEmit && npx vitest run tests/overmind-nudge.test.ts tests/overmind-brain.test.ts && npx vitest run`
- result: PASS
- evidence: focused Overmind tests passed 37 tests; full suite passed 41 files, 549 tests, 1 skipped.

### Standing Rules

- Any server-validated all-done Overmind workflow that is not currently `working` must become terminal `completed`, even if its all-done `completion_check` was already recorded by an older tick.

### Caveats

- Live `wf=20` completion is left for coord validation after dev deploy and watcher tick, per the send-back brief.

## Iteration 3 Send-Back

### User Report

> ...always remove it from the list if they are already completed... this is a bug on the app list, please fix this so this does not happen again.

### Root Cause / Mechanism

- Iteration 2 correctly completed already-parked all-done workflows when status was not `working`.
- The remaining gap was the `working` early-return: a brain `working` verdict writes `status = "working"` and `completion_check = signature`.
- Subsequent ticks hit `completion_check === signature`; because status was `working`, the early-return skipped completion and also wrote `stuck_since = null` every tick.
- That meant an all-done run once classified `working` could never accumulate idle time and could remain Active forever after the coordinator stopped changing.

### Files Changed

- `src/services/overmind/completion-detector.ts` - added the frozen-working idle gate to the completion-check early-return using current pane hash vs previous `last_pane_hash` plus the standard stuck threshold.
- `tests/overmind-nudge.test.ts` - added regression coverage for active working all-done, idle-under-threshold working all-done, and idle-past-threshold auto-completion.

### What Changed

- All-done `working` workflows now stay `working` while the coordinator pane hash changes.
- When the coordinator pane hash is unchanged, `stuck_since` is started or preserved instead of being wiped.
- Once the unchanged pane has been idle past `STUCK_THRESHOLD_MS`, the workflow auto-completes through the same guarded terminal transition.
- No per-tick brain calls or nudges were added.

### Verification

- command or method: `npx tsc --noEmit`
- result: PASS
- evidence: completed with exit code 0.

- command or method: `npx vitest run tests/overmind-nudge.test.ts tests/overmind-brain.test.ts`
- result: PASS
- evidence: 2 files passed, 40 tests passed.

- command or method: `npx vitest run`
- result: PASS
- evidence: 41 files passed, 552 tests passed, 1 skipped.

### Standing Rules

- An all-done Overmind workflow may stay Active as `working` only while the coordinator pane is changing; once that pane is unchanged past the standard stuck threshold, it must become terminal `completed`.

### Caveats

- Live `wf=20` false-completion protection while `lkcamp-12` is busy is left for coord validation on the deployed dev watcher.

## Issue-002 Iteration 1

### User Report

> we only have 2 status its active or its stuck where as if its stuck ovm should either making it active again or closing it not this stale workflow
> always remove it from the list if they are already completed... fix this so this does not happen again.

### Root Cause / Mechanism

- The iter3 all-done closer used coordinator pane hash stability plus `STUCK_THRESHOLD_MS` to decide when a `working` all-done workflow should close.
- Codex/Claude TUI panes can redraw or change cursor state even at an idle prompt, so `coordinatorHash !== workflow.last_pane_hash` can keep resetting `stuck_since`.
- That made pane hash the source of truth for an already-complete task list, allowing an all-done run to linger as `working` indefinitely.
- Remaining-task workflows do not enter `handleAllTasksDone`; they continue through the existing classifier and nudge ladder. The focused nudge tests verify stuck remaining-task runs are nudged and active panes are reactivated instead of being closed by this path.

### Files Changed

- `src/services/overmind/completion-detector.ts` - removed pane-hash idle gating and switched all-done closure to the persisted `completion_check` signature.
- `tests/overmind-nudge.test.ts` - replaced pane-idle completion tests with task-list driven all-done tests, including the flapping-pane `working` case and remaining-task nudge preservation.
- `tests/overmind-brain.test.ts` - updated the brain consult edge case to assert the first tick records all-done and the second tick closes without another brain call.

### What Changed

- First all-done tick (`completion_check !== signature`) records `completion_check = signature` and does not close yet.
- Second all-done tick (`completion_check === signature`) closes unconditionally through `completeWorkflowOnce`, regardless of `status` or pane hash.
- Brain `working` now only grants the one persisted-signature tick; it cannot keep a fully done registered task list open indefinitely.
- Pane hash no longer influences completion of a fully done registered task list.

### Verification

- command or method: `npx tsc --noEmit`
- result: PASS
- evidence: completed with exit code 0.

- command or method: `npx vitest run tests/overmind-nudge.test.ts tests/overmind-brain.test.ts`
- result: PASS
- evidence: 2 files passed, 37 tests passed.

- command or method: `npx vitest run`
- result: PASS
- evidence: 41 files passed, 549 tests passed, 1 skipped.

### Standing Rules

- A fully done registered Overmind task list is the completion truth. Pane activity cannot keep it on the Active worklist beyond the bounded `completion_check` grace tick.

### Caveats

- No schema change was added; this uses the existing one-tick `completion_check` marker as the bounded grace.

## Issue-002 Iteration 2

### User Report

> active list is ACTIVE or STUCK; a stuck run must be reactivated or CLOSED, never left stale. All-done = close (task list is truth).

### Root Cause / Mechanism

- Iteration 1 made `handleAllTasksDone` close all-done workflows using the persisted task-list signature.
- The real stale run still never reached that handler because `OvermindWatcher.tickWorkflow` returned early when `subagentInFlight` was set.
- The early-return order was: subagent-in-flight updates status to `working` and returns before the `allTasksComplete(workflow.tasks)` branch.
- That is correct for workflows with remaining tasks, where an invisible subagent should suppress false idle nudges, but wrong for a fully done registered task list.
- I checked the pre-completion returns in `tickWorkflow`; `monitoring_paused` is the only other one before the all-done branch and is an explicit user state, so I did not change it.

### Files Changed

- `src/services/overmind-watcher.ts` - changed the `subagentInFlight` early-return to apply only when the workflow still has remaining tasks.
- `tests/overmind-nudge.test.ts` - added watcher coverage for all-done + subagent-in-flight closing, and remaining-tasks + subagent-in-flight staying `working`.

### What Changed

- `subagentInFlight` plus remaining tasks still updates the workflow as `working` and returns.
- `subagentInFlight` plus all tasks done now falls through to `handleAllTasksDone`, so the existing task-list driven close path runs.

### Verification

- command or method: `npx tsc --noEmit`
- result: PASS
- evidence: completed with exit code 0.

- command or method: `npx vitest run tests/overmind-nudge.test.ts tests/overmind-brain.test.ts tests/overmind-subagent.test.ts`
- result: PASS
- evidence: 3 files passed, 74 tests passed.

- command or method: `npx vitest run`
- result: PASS
- evidence: 41 files passed, 551 tests passed, 1 skipped.

### Standing Rules

- Subagent-in-flight suppression protects only workflows with remaining registered tasks; it cannot hold a fully done task list on the Active worklist.

### Caveats

- Live `wf=20` completion after deploy is left for coord validation over the running watcher ticks.

## Issue-003 Iteration 1

### User Report

> "ask the parent agent to confirm, always nudge the owners of the task to complete it ovm does not do it"
>
> "ask owner agent again, ovm only reports what is given to him, the only exception i see here is if there i no active parent agent session anymore, with that we need to add a new tab named 'ERROR' where there is an orphan tasks with no parent, otherwise let the parent settle it he needs to complete it or start working again"

### Root Cause / Mechanism

- `handleAllTasksDone` used `completion_check` as a one-tick grace marker, then called `completeWorkflowOnce` on the next matching all-done tick.
- `completeWorkflowOnce` called `overmindService.setStatus(id, "completed")`, which let OVM close runs from watcher judgment instead of waiting for the owner path at `POST /api/overmind/complete`.
- The watcher already had parent and child tmux liveness in the same tick, but there was no persisted run flag for the special case where no parent coordinator session and no child session are alive.

### Files Changed

- `src/services/overmind/completion-detector.ts` - removed watcher-side completion and DONE notification; all-done now either sends one guarded owner-confirmation nudge per `completion_check` signature or marks the run orphaned when no owner/child session is alive.
- `src/services/overmind-watcher.ts` - computes parent/child liveness, threads orphan detection into all-done handling, sets `orphaned=true` for dead-parent/dead-child runs with remaining tasks, and clears `orphaned=false` when the owner path is live again.
- `src/services/overmind-service.ts`, `src/services/overmind/types.ts` - exposes the `orphaned` boolean in workflow payloads and excludes orphaned runs from daemon/project active-run counts.
- `src/db/schema.ts`, `src/db/database.ts` - bumped schema to v29 and added `overmind_workflows.orphaned INTEGER NOT NULL DEFAULT 0`.
- `tests/overmind-nudge.test.ts`, `tests/overmind-brain.test.ts` - replaced auto-complete assertions with owner-nudge, no-spam, orphan, and recovery coverage.
- `tests/overmind-service.test.ts`, `tests/unit/database.spec.ts`, `tests/overmind-reconcile.test.ts`, `tests/overmind-stream.test.ts`, `tests/overmind-subagent.test.ts`, `tests/notes-migration.test.ts`, `tests/notes-folders.test.ts` - updated schema/type expectations for v29 and `orphaned`.

### What Changed

- OVM no longer calls `setStatus("completed")` from `handleAllTasksDone`.
- All-done + live owner sends one guarded parent nudge asking the owner to confirm and `POST /api/overmind/complete`.
- Repeated ticks for the same all-done signature do not re-nudge and do not complete.
- Parent dead + no live child sets `orphaned=true` and suppresses nudges.
- Parent alive on a later tick clears `orphaned=false`.
- Owner completion remains the existing `/api/overmind/complete` path.

### Verification

- command or method: `npx tsc --noEmit`
- result: PASS
- evidence: completed with exit code 0.

- command or method: `npx vitest run tests/overmind-nudge.test.ts tests/overmind-service.test.ts tests/unit/database.spec.ts tests/overmind-routes.test.ts`
- result: PASS
- evidence: 4 files passed, 135 tests passed.

- command or method: `npx vitest run`
- result: PASS
- evidence: 41 files passed, 553 tests passed, 1 skipped.

### Standing Rules

- OVM is a reporter and nudger. OVM must not auto-complete or auto-resolve a run from watcher judgment.
- The owner closes a run by posting `/api/overmind/complete`.
- The only OVM-side exception is orphan detection: parent coordinator session dead and no live child session sets `orphaned=true`.

### Caveats

- The ERROR tab UI is intentionally not included; the backend now exposes `orphaned` for that follow-up.
- Live all-done owner-nudge behavior is left for coord validation after dev deploy.

## Issue-004 Iteration 1

### User Report

> "the only exception … no active parent agent session anymore … we need to add a new tab named 'ERROR' where there is an orphan tasks with no parent."

### Root Cause / Mechanism

- Issue-003 exposed `workflow.orphaned` in the backend payload, but the Overmind workflow view still derived its Active tab only from `isActiveStatus(workflow.status)`.
- Because `orphaned` workflows can still have an active/stuck status, the UI had no separate ERROR bucket and would continue listing those rows in Active.
- The dashboard quick-view summary used the same status-only active count, so orphaned active-status rows could inflate the active count there too.

### Files Changed

- `src/web/public/app.js` - added the ERROR tab with `ERROR (N)`, filtered Active to exclude `orphaned === true`, routed the ERROR tab to orphan-only workflows, and added the visible orphan reason line on orphan rows.
- `src/web/public/style.css` - added restrained ERROR tab and orphan reason styling using the existing red OVM status color.
- `src/web/public/overmind-helpers.js` - excluded orphaned workflows from the active quick-view count.
- `tests/overmind-stream.test.ts` - added regression coverage that an orphaned stuck workflow is counted in total but excluded from active summary.

### What Changed

- Active tab now shows only active/stuck-style workflows where `orphaned !== true`.
- ERROR tab shows only workflows where `orphaned === true`.
- Orphan cards keep the existing workflow row rendering and show: "No active parent session — orphaned (parent must resume or this needs cleanup)".
- Completed and History behavior is unchanged.

### Verification

- command or method: `npx tsc --noEmit`
- result: PASS
- evidence: completed with exit code 0.

- command or method: `npx vitest run tests/overmind-stream.test.ts`
- result: PASS
- evidence: 1 file passed, 13 tests passed.

- command or method: `npx vitest run`
- result: PASS
- evidence: 41 files passed, 553 tests passed, 1 skipped.

### Standing Rules

- Active workflow lists and counts must exclude `orphaned === true`; orphaned workflows belong only in ERROR until the parent session recovers or cleanup happens.

### Caveats

- Screenshot evidence is captured after dev deploy with a temporary live DB orphan fixture and then removed.

## Issue-005 Iteration 1

### User Report

> "on the completed tab, add a dropdown to show how many past runs has been done, like 5-10-15, and only show that."

### Root Cause / Mechanism

- The Completed tab used every workflow whose status was `completed` or `paused` as its visible list.
- There was no tab-scoped limit state and no explicit most-recent-first sorting before rendering, so JROM could not restrict the Completed tab to the last 5/10/15 runs.

### Files Changed

- `src/web/public/app.js` - added Completed-tab-only dropdown state with default `10`, kept the Completed badge as the total available count, and rendered only the selected most-recent completed rows.
- `src/web/public/overmind-helpers.js` - added `completedWorkflowsMostRecent()` to filter completed/paused workflows, sort by `ended_at` descending with `updated_at` fallback, and enforce 5/10/15 limits.
- `src/web/public/style.css` - added compact styling for the Completed tab dropdown.
- `tests/overmind-stream.test.ts` - added regression coverage for most-recent-first ordering, fallback sorting, status filtering, and limit truncation.

### What Changed

- Completed tab now defaults to showing the last 10 completed runs.
- Dropdown options are 5, 10, and 15 and remain in memory when switching tabs.
- Active, ERROR, History, and OVM tabs do not show the dropdown.
- Completed tab badge still shows the total completed/paused rows available.

### Verification

- command or method: `npx tsc --noEmit`
- result: PASS
- evidence: completed with exit code 0.

- command or method: `npx vitest run tests/overmind-stream.test.ts`
- result: PASS
- evidence: 1 file passed, 14 tests passed.

- command or method: `npx vitest run`
- result: PASS
- evidence: 41 files passed, 554 tests passed, 1 skipped.

### Standing Rules

- Completed-tab visibility controls limit only the visible list; the tab badge remains the total available completed-run count.

### Caveats

- Screenshot evidence is captured after dev deploy with the live Completed tab set to 5.
