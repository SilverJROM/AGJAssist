Task: Overmind — replace passive NEEDS-INFO with an active 30-min routine that DEMANDS an updated list from the parent

Repo: /home/agjrom/TGBOTS/AGJAssist. Build = `npx tsc` + `npm run build`. Tests = `npx vitest run`. NO schema migration (use in-memory state — avoid migration risk).

JROM intent (verbatim):
- "rather that giving me this BS status ask the parent session about it and demand answers"
- "i dont like to see this NEEDS INFO bs, you have the means to ask the session about it"
- "lets have a routine check every 30mins if there are active workflows to check if all the parent, status, etc are still valid and if its not valid and algo cant make sense of it, ask the parent session about it to send an updated list to overmind"
- "when doing that ask a routine check to the session as well to update their task list if they havent done so. but only do this as an additional to the status request, not on its own"

So: stop surfacing "NEEDS INFO" to JROM as a passive badge. When overmind can't make sense of a workflow's registration, it ASKS THE PARENT (coordinator) session directly and demands an updated list. A 30-min routine re-asks until resolved. The task-list-update reminder is BUNDLED into that status/roster demand — never sent on its own.

Read first: src/services/overmind-watcher.ts (the tick loop, POLL_MS, assessRegistrationCompleteness, applyCompleteness, sessionExists usage, sendCommand), src/services/overmind-service.ts (OvermindWorkflow fields incl. monitoring_paused, info_request/info_check, tasks, child_sessions, child_roles, coordinator_session), and src/web/public/app.js (the `overmind-needs-info` badge render).

Acceptance criteria:
1. ADD a 30-min reconciliation routine in the watcher (RECONCILE_MS = 1_800_000). Gate it with an in-memory `lastReconcileAt` timestamp (NO DB column / NO migration) — e.g. inside tick(): if Date.now() - lastReconcileAt >= RECONCILE_MS, run reconcile() then set lastReconcileAt. reconcile() iterates active workflows (NOT terminal: completed/failed/paused; SKIP monitoring_paused).
2. For each such workflow, validate registration with what's observable:
   - parentAlive = await tmuxService.sessionExists(coordinator_session). If parent is NOT alive → skip (can't ask).
   - Determine if the registration has an unresolved gap the deterministic algo CANNOT auto-fix — reuse the existing gap signals (info_request being set is the simplest source of truth: tasklist missing / run_dir missing / dead registered child / roles missing). i.e. "the algo flagged a gap it can't resolve."
   - If parent alive AND a gap exists → DEMAND an updated list: send ONE consolidated single-line message to the coordinator via tmuxService.sendCommand(coordinator_session, msg, true, true):
     msg names the problem (e.g. "registered child(ren) X no longer alive" / "no tasklist" / "run_dir not found"), and DEMANDS the parent re-register its CURRENT child_sessions + child_roles + confirm status to overmind (POST /api/overmind/register), AND — bundled in the SAME message — "and update your task list (POST /api/overmind/tasks) if it has changed since you last reported." The task-list line MUST only appear as part of this status/roster demand, never as a standalone message.
   - Re-ask on each 30-min cycle while the gap persists (this is the "demand answers" persistence). Rate-limited by the 30-min cadence (don't ask more than once per cycle per workflow). Best-effort try/catch — never throw out of the tick.
3. STOP showing the prominent "NEEDS INFO" badge to JROM (src/web/public/app.js): remove/replace the `overmind-needs-info` "⚠ needs info" badge in the card header. The card should show the workflow's REAL status (working/idle/etc.). It's fine to keep a LOW-KEY, non-alarming indicator in the EXPANDED detail only (e.g. a small grey "⟳ asked parent to update: <what>" line) so JROM knows overmind is chasing it — but NOT a headline NEEDS-INFO status. Keep the info_request/info_check fields (internal gating) intact; just change the rendering.
4. Keep the existing per-tick completeness ask (immediate first ask) working; the new routine is the persistent re-ask + the bundled task-list reminder. Do NOT remove dead_child detection (JROM said keep it / ignore removing it) — it now feeds the parent-demand, not a JROM-facing badge.
5. Tests: add a unit test for the reconcile decision (given parent alive + a gap → a demand sendCommand to the coordinator containing the re-register ask + the bundled task-list line; given no gap → no message; given monitoring_paused or parent dead → no message; task-list line never sent without the status request). `npx tsc` + `npm run build` clean; `npx vitest run` fully green.

Scope/DON'T: overmind-watcher.ts + app.js (badge render) + tests. Do NOT add a DB migration. Do NOT touch the OVM chat, Notes, providers, or the /complete child-close reminder. Do NOT force-kill or auto-register on the parent's behalf — overmind ASKS; the parent re-registers.

Artifacts: short changes.md to plan/overmind/changes-reconcile-demand-parent.md (verbatim intent + per-file WHAT/WHY + Verification: tsc/build/vitest + how the 30-min gate works in-memory + how the task-list ask is bundled-only + that the NEEDS-INFO badge is no longer headlined). Commit `[overmind] 30-min reconcile routine: demand updated list from parent on registration drift (bundled task-list reminder); drop headline NEEDS-INFO badge`. End with STATUS marker.
