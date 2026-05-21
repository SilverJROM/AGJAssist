## Accepted: Batch-A1 — STATUS: PASS
HEAD: 1c99aed (branch feat/overmind — renamed from feat/overmind-a1-schema)
Implemented: schema v11 `overmind_workflows` table + indexes + v10→v11 migration in src/db/database.ts; new `OvermindService` (src/services/overmind-service.ts) with sync CRUD (register/upsert, list, get, getBySession, update, setStatus, setTasks, delete) and JSON-at-boundary for child_sessions/tasks; tests/overmind-service.test.ts (3 tests).
Req#s closed: R1 VERIFIED.
Open in matrix: R2-R16, R13 (12 reqs across batches A2-A7, B, C).
Branch/merge policy (decided): ALL batches commit on single branch `feat/overmind`; NO merge to master until JROM reviews the whole feature at the end.
Env/migration gotchas: vitest.config now includes `tests/**/*.test.ts` (was only `.spec.ts`). database.spec asserts v11. Migration is additive (CREATE IF NOT EXISTS) — safe on the live data/ DB at next pm2 restart.
Service surface for A2: OvermindService.register(input), list, get, getBySession, update, setStatus, setTasks(id,currentTask,tasks[]), delete. Types: OvermindWorkflow, OvermindTask{id,label,state}, OvermindWorkflowStatus.
Validation lessons: codex handshake clean, mechanism-level PROPOSED, caught the database.spec drift itself.
