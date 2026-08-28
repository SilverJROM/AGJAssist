C4 attempt 2 validator red-team pass

Commit under test: 3bde8f4fd6b8a29513cd7c7fee520874989b9fe6

Focused command:
node scripts/cc-run-isolated.mjs --slice C4 -- npx vitest run tests/agent-reminder-routes.test.ts --minWorkers=1 --maxWorkers=4

Result: PASS, 7 tests passed.

Lenses:
- Owner-only route gate: GET active, POST create, PATCH update, and DELETE cancel all use [authMiddleware, requireOwner].
- Non-owner fail-closed: viewer token asserts literal 403 for GET active plus POST/PATCH/DELETE.
- Malformed input fail-closed: cadence <= 0 and negative repeat_limit return 400 on covered routes.
- Include/skip path: PATCH sends include 0 and include 1 recipients and verifies the public response preserves include 0.
- Registration path: createApiServer registers registerAgentReminderRoutes with services.authService and services.db.

Verdict: standard-clean.
