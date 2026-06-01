# Batch B2 Review

## Diff Review

- Scope is limited to the active-runs endpoint, its service query, and route tests.
- The endpoint uses the approved canonical path: `/api/overmind/runs/active`.
- The SQL uses `JOIN overmind_projects p ON p.id = w.project_id`, so legacy active rows with no project do not appear in daemon registry output.
- Active set is defined as non-terminal: `status NOT IN ('completed', 'failed', 'paused')`.
- Auth behavior matches Overmind lifecycle endpoints: non-loopback returns `403`, missing or bad token returns `401`.
- Dispatch manifests are read from disk only under each run's `dispatch` directory and only include `.json` files.

## Risk Review

- The route performs synchronous directory reads per returned active run. This is acceptable for the small daemon registry response and avoids adding async route complexity. Missing dispatch directories return an empty list.
- Child role fallback is `"child"` if a stored role is missing for a session. Existing code already treats child roles as an indexed companion array.
- No daemon TTL cache was implemented here because that is explicitly daemon-side deferred.

## Out Of Scope Confirmed

- No daemon script changes.
- No `/api/runs/active` alias.
- No Tier-1/Tier-2 daemon logic.
- No telemetry changes.

