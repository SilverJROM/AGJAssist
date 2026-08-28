FINDING 1 of 1
WHAT FAILED: GET /api/agent-reminders/active is registered with only authMiddleware in src/api/routes/agent-reminder-routes.ts, so a non-owner authenticated viewer can read active reminders despite the C4 scope saying owner-only active-reminder reads and non-owner fail-closed.
THE FIX: Change the GET /api/agent-reminders/active preHandler to [authMiddleware, requireOwner], then add a focused test in tests/agent-reminder-routes.test.ts that calls GET /api/agent-reminders/active with viewerToken and asserts 403.
WHY THE LAST ATTEMPT MISSED IT: The focused spec only checked owner GET success and never used the viewer token against the active-read endpoint.
