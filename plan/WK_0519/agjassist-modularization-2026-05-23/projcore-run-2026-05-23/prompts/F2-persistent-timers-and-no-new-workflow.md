# F2 — Persistent timers + no-new-workflow rule (auto-adopt by project root)

You are the implementer for AGJAssist (master branch at
/home/agjrom/TGBOTS/AGJAssist). Two coupled hardening items from JROM raised
on 2026-05-24, after F1 landed in commit `4b61c10`:

## What JROM said (verbatim)

1. > "make sure all the timers are not fuckable it means its persistent not
>    some fragile timer that when an event/restart or something fucks it over
>    and it does not work, just make sure its properly shutdown when its not
>    needed any more like workflow is completed"

2. > "wtf like you created a new workflow again, i said refrain from doing
>    that, i want you to reuse 1 workflow for each parent session please fix
>    this. overmind should not allow these sessions to create their own
>    workflow and should always use a workflow already in the app. ovm should
>    auto find it and place it there and give the parent session a corrective
>    advice not to do that again and use this <workflow name for him> when
>    submitting a job"

JROM has locked the match key as **"by run_dir / project tree"** (see
AskUserQuestion answer recorded in this run).

## F2.1 — Persistent timers

Audit and fix EVERY in-memory cooldown/timer state in
`src/services/overmind-watcher.ts`. The current state:

- `lastIdleNudgeAt` — **already persistent** via `NudgeStateService`
  (`data/overmind-cooldown-state.json`). Reference implementation.
- `lastReconcileAsk` — in-memory `Map<number, string>` of last-asked
  signatures. Decide: is this state needed across restart? Loss of dedupe
  across pm2 restart means a parent might get the same reconcile demand
  twice when pm2 restarts. **Persist it** through `NudgeStateService`.
- `lastTaskStaleNudgeAt` — in-memory `Map<number, number>`. **Persist.**
- `apparentIdleSince` (subagent suppression) — in-memory `Map<number,
  number>`. Decide if persistence matters here; if yes, persist.
- `subagentInFlight` — in-memory. Decide.
- `parentIdleSince` — in-memory. Decide.
- **`lastAskUpdateNudgeAt`** — added in F1, in-memory. **MUST be persisted**
  (was the trigger for this work).

For each one not yet persistent, decide if loss-on-restart causes harm. If
yes, route through `NudgeStateService` (extend that service's shape if
needed — add an `askUpdateNudge` field; key by `workflow_id`). For ones where
loss-on-restart is genuinely fine (e.g. very-short-window state used inside
a single tick), KEEP it in memory but comment-justify why.

**Cleanup on workflow teardown.** When a workflow transitions to a terminal
status (`completed`, `failed`, `paused`), the watcher MUST clean its entry
out of every cooldown map (both in-memory and the JSON-backed
NudgeStateService). Add this to wherever the watcher detects a terminal
transition. Currently `lastAskUpdateNudgeAt.delete(workflowId)` is called in
ONE place — make sure ALL persistent maps drop entries the same way.

When a workflow is **deleted** via `DELETE /api/overmind/workflows/:id`, the
route handler must also tell `NudgeStateService` to drop that workflow_id
from all per-workflow maps. Add a `forgetWorkflow(id)` method that nukes
every per-id key across the JSON file.

Add tests verifying:
- Cooldown survives a `new OvermindWatcher(...)` reconstruction (i.e. across
  a simulated restart) when the NudgeStateService file is preserved.
- Cooldown entry is removed from the JSON file once a workflow's status
  flips to completed/failed/paused.
- `DELETE /api/overmind/workflows/:id` removes the JSON entry too.

## F2.2 — No-new-workflow rule (auto-adopt by project root)

Change `POST /api/overmind/register` semantics:

1. **Step 1 — existing coordinator_session.** If `coordinator_session=X`
   already has a row, UPSERT (current behavior, do not change).

2. **Step 2 — project-root match.** Else, derive the **project root** from
   the incoming `run_dir`:
   - Canonicalize the run_dir (resolve symlinks, normalize).
   - Find the longest existing-workflow run_dir that is a path-prefix of the
     incoming run_dir, OR the longest incoming-run_dir that is a path-prefix
     of an existing workflow's run_dir.
   - "Path-prefix" means component-aligned (`/a/b/c` is a prefix of
     `/a/b/c/d` but NOT of `/a/b/code`). Use `path.resolve` then split on
     `path.sep` and compare component arrays.
   - Among matches, pick the **most-recent active** one first; if none, the
     most-recent terminal one.
   - If a match exists with a different `coordinator_session` → REJECT with
     **HTTP 409** body `{ "error": "...", "use_existing": { "id": N,
     "coordinator_session": "...", "label": "...", "run_dir": "..." } }`.
     The error message MUST be the corrective advice text:
     > "Overmind: a workflow for this project tree is already registered as
     > `<existing_coordinator_session>` (id=<N>). Please use that session
     > name in your next POST /api/overmind/register, /tasks, /complete, and
     > /pause calls — overmind tracks one workflow per project tree. Do NOT
     > create new workflows for sub-phases of the same project."

3. **Step 3 — no match.** Genuinely new project tree → allow creation
   (current behavior, no change).

4. The existing `DuplicateRunDirError` (which checks exact `run_dir` match
   for active workflows) is now subsumed by the project-root match. Either
   delete it or fold it in.

5. The **corrective advice message must also be sent to the parent's tmux
   session** via `tmuxService.sendAndSubmit` so it surfaces in their pane
   (the parent will see the 409 in JSON, but also see a human-readable line
   in their tmux pane). Cooldown the in-pane message via NudgeStateService
   too — once per (incoming_session, target_workflow_id) pair within 30
   minutes, so a misconfigured parent retrying every minute doesn't spam.

6. Update `tests/overmind-routes.test.ts` + `tests/overmind-service.test.ts`
   with cases covering:
   - Same coord session re-register: still works (upsert).
   - New coord session, project-root-prefix matches existing → 409 +
     use_existing payload.
   - Brand-new project root → 201 (creates row).
   - Match against completed workflow → 409 too (do not create a parallel
     row even if the existing one is terminal — JROM's "1 workflow per
     parent session" applies even after completion).
   - The corrective message is sent via sendAndSubmit when the parent's
     coordinator_session is alive in tmux; not sent when it isn't.

## Acceptance gate

- `npx tsc --noEmit` clean.
- `npx vitest run` passes (baseline is `454 passed | 1 skipped | 0 failed`
  after F1; you'll add tests, expect ~470+ passed).
- `npm run build` succeeds.
- `pm2 restart agjassist` + `curl http://127.0.0.1:3101/api/health → 200`.
- Manual smoke: try `POST /api/overmind/register` against
  `run_dir=/home/agjrom/websites/HRIS/anything-new`. It MUST return 409
  with `use_existing.coordinator_session == "hris-d-22"` (or whatever the
  current HRIS row's coordinator_session is).

## Workflow

1. Read F1's implementation in commit `4b61c10` first (`git show 4b61c10`
   then read the changed files) so you understand what's already there
   before extending it.
2. Implement F2.1 first (persistent timers), commit.
3. Implement F2.2 (no-new-workflow), commit separately.
4. End with `STATUS: DONE` or `STATUS: BLOCKED <reason>` /
   `STATUS: NEEDS-DECISION <question>`.

## Out of scope

- UI changes (the dashboard already shows the workflow rows; no
  visualization change needed for the 409 / corrective message).
- Migrating the cooldown JSON file to a different store (it's fine as-is).
- Refactoring the watcher's other classifiers.
- Frontend changes to the workflow details (F1 covers it).
