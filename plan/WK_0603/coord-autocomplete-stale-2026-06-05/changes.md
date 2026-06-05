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
