E1 validator red-team a2

commit=245e1293ff1cb6f5c0b8f383f79f170f541d4d97

Scope authority note: D1/D2/D3 have no criterion text in og-requirements.md; per the brief, this validation used the E1 scope text as the authority.

Lens 1 - schema shape: PASS
The E1 schema includes a separate agent_one_time_wakeups table with pane_target, manual_fire_time, action, status, created_at, and updated_at. It does not reuse agent_wake_schedule.

Lens 2 - fresh vs upgrade path: PASS
Fresh DBs create SCHEMA_SQL and store SCHEMA_VERSION 39. Existing v38 DBs execute SCHEMA_SQL during migration and then update schema_version to 39.

Lens 3 - status enum discrimination: PASS
The attempt 2 test adds literal specimens for omitted status -> pending, accepted cancelled status, and rejected bogus status. A schema missing cancelled or lacking the CHECK would now fail.

Lens 4 - capability independence: PASS
The attempt 2 diff changes only tests/unit/agent-wakeup-schema.spec.ts and does not couple one-time wakeups to summaries or OVM wake scheduling.

Focused test: PASS
node scripts/cc-run-isolated.mjs --slice E1 -- npx vitest run tests/unit/agent-wakeup-schema.spec.ts --minWorkers=1 --maxWorkers=4
