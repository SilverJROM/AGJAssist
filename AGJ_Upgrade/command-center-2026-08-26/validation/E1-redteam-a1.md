E1 validator red-team a1

commit=599012e0be9ab62bf92b77f0125782201b4bed1d

Scope authority note: D1/D2/D3 have no criterion text in og-requirements.md; per the brief, this validation used the E1 scope text as the authority.

Lens 1 - schema shape: PASS
The diff adds a separate agent_one_time_wakeups table with pane_target, manual_fire_time, action, status, created_at, and updated_at. It does not reuse agent_wake_schedule.

Lens 2 - fresh vs upgrade path: PASS
Fresh DBs execute SCHEMA_SQL then insert SCHEMA_VERSION 39. Existing v38 DBs execute SCHEMA_SQL in the migration path and then update schema_version to 39.

Lens 3 - capability independence: PASS
The diff is confined to src/db/schema.ts and tests/unit/agent-wakeup-schema.spec.ts. It does not couple one-time wakeups to summaries or OVM wake scheduling.

Lens 4 - test discrimination: FAIL
The focused spec inserts status='pending' and updates to status='fired', but never inserts status='cancelled', never verifies the default pending status when status is omitted, and never rejects an invalid status. A mutant schema with CHECK(status IN ('pending','fired')) would still pass all three focused tests while violating the explicit pending/fired/cancelled scope.
