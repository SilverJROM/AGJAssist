# Batch A3b Changes

## Branch: `feat/agj-upgrade-A3b-wake-scheduler`

Cut from `feat/agj-upgrade-A3a-agent-events` @ `cbc9b70`.

## User Report (verbatim from brief)

"R21 — App-owned wake/callback substrate: agents request wake + emit status through ONE uniform app interface; the app performs SCHEDULING/WAKING regardless of provider."

## Root Cause (mechanism-level)

Feature: adds the app-owned wake scheduler half of R21 with additive wake storage, request API, overmind-cadence processing, tmux pokes, and coordinator status events.

## Code Changes

- `src/db/schema.ts` — Bumped schema to v34 and added `agent_wake_schedule` with due/run indexes, persisted outcome, and JSON body.
- `src/db/database.ts` — Added guarded v33 to v34 migration for the wake schedule table and indexes.
- `src/services/agent-wake-scheduler.ts` — Added `requestWake` and claim-then-process due wake handling for `poke-pane` and `wake-coordinator`.
- `src/services/overmind-watcher.ts` — Added an optional wake scheduler tick after active workflow ticks; omitted scheduler remains a no-op.
- `src/index.ts` — Wired `AgentEventsService` and `AgentWakeScheduler` into app startup.
- `tests/unit/agent-wake-scheduler.spec.ts` — Added outcome tests for due poke, future wake, no double fire, coordinator signal, and skipped missing target.
- `tests/unit/database.spec.ts` — Updated schema-version expectations and asserted upgraded DBs include `agent_wake_schedule`.

## Commits

- `314e52e` [batch-A3b] agent_wake_schedule + app scheduler | scenarios: A3b

## Standing Rules (if discovered)

- Future wake processors must stamp `fired_at` before side effects and persist a terminal outcome for both fired and deliberately skipped wakes.

## Verification

- Build: PASS (`npm run build`)
- Type-check: PASS (`npx tsc -p tsconfig.json --noEmit`)
- DEV deploy: localhost only — no deploy requested in A3b brief.
- Smoke verify:
  - API/service: `AgentWakeScheduler.requestWake(...)` inserted temp DB rows; `tick()` processed due rows and produced expected DB/tmux/event outcomes in `tests/unit/agent-wake-scheduler.spec.ts`.
  - Overmind guard: full suite PASS with existing `new OvermindWatcher(...)` standalone tests, proving omitted scheduler is a no-op.

## Bug Reproductions (if bug fixes)

- Not a bug-fix batch.

## Caveats

- [PRE-EXISTING] Working tree contains unrelated modified/untracked overmind audit and planning artifacts from before A3b. A3b staged/committed only scoped source, test, and batch artifact files.
