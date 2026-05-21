Batch-W6: Per-session status — classify parent + each child independently (incl closed child)

Batch ID: W6
Requirements: og-requirements-r3.md (WU6 + its addendum)
Branch: feat/overmind (CONTINUE). Schema currently v18 (last block added completion_check) → bump to v19.
Estimated: SHORT.

Context: the watcher (overmind-watcher.ts) captures the coordinator pane + each child pane each tick. Currently it derives ONE workflow `status` + active_session/active_role. WU6: also classify EACH session independently and persist.

Requirement (WU6 + addendum):
"parent_status = full classifier on the coordinator pane (working|idle|waiting_human|awaiting_decision|stuck). child_statuses = per child: working|idle from pane busy markers, OR 'closed' if the child's tmux session no longer exists (detect via tmux has-session / capture failure). Keep overall workflow `status`. If NO child registered → name shows n/a (UI). Closed child → status 'closed' (grey)."

Expected (acceptance):
1. Schema v19 (18→19): add `parent_status TEXT` + `child_statuses TEXT NOT NULL DEFAULT '[]'` (JSON array of {session, status}). Guarded version<19 migration (PRAGMA table_info + ALTER ADD COLUMN, idempotent). Add to SCHEMA_SQL fresh path too.
2. tmuxService: add `sessionExists(target): Promise<boolean>` using `tmux has-session -t <session>` (exit 0 = exists). (Or equivalent.)
3. Watcher tick: 
   - parent_status: run the existing classifier logic on the COORDINATOR pane alone → working|idle|waiting_human|awaiting_decision|stuck. ('idle' = no busy markers, not frozen-past-threshold; reuse/adapt classifyWorkflow — parent gets the full state.)
   - child_statuses: for each child_session: if !sessionExists → 'closed'; else busy markers in its pane → 'working', else 'idle'. Build [{session, status}].
   - Persist parent_status + child_statuses via update(). Keep the existing overall `status` + active_session/active_role (unchanged — the overall status still drives the top badge/tabs).
4. overmind-service: OvermindWorkflow includes parent_status + child_statuses (parsed array); update() maps them; register/setTasks don't need to set them (watcher owns them).
5. npx tsc clean.

Likely files:
- src/db/database.ts (v19 + migration + SCHEMA_SQL)
- src/tmux/tmux-service.ts (sessionExists)
- src/services/overmind-watcher.ts (per-session classify + persist)
- src/services/overmind-service.ts (interface + mapping)
- tests: classifier-per-session (parent full status; child working/idle; child closed when sessionExists=false) + service v19 round-trip

Scope: per-session status classification + persist ONLY. UI restructure is W7 (don't touch the card yet). Don't change overall status/nudge/brain. Migration safe on live DB. Surgical.

Tests (targeted): parent pane busy → parent_status working; parent idle → idle; parent NEEDS-INFO/decision pane → waiting_human/awaiting_decision. child pane busy → working; idle → idle; sessionExists=false → closed. service v19 round-trips parent_status + child_statuses. Run vitest + tsc + npm run build.

Plan handshake (MANDATORY): read brief + database.ts (v18 migration pattern) + overmind-watcher.ts (tick + classify + capture) + tmux-service.ts + overmind-service.ts. Reply STATUS: PROPOSED with v19 migration, sessionExists, per-session classify (parent full / child working|idle|closed), persistence, tests. WAIT for APPROVED-PLAN.
After APPROVED-PLAN: implement, commit, gate (tests + tsc + npm run build). Artifacts batch-W6/changes.md + test-report.md + independent-validation.md. projcore LIVE-SMOKE: a workflow with a busy child + idle parent → parent_status idle, child working; kill a child session → status closed.
Completion: callback FIRST to plan/overmind/projcore-run-2026-05-21-r3/callbacks.md [projcore callback] W6 <STATE> <note>, THEN STATUS: <verb> -- reason.
