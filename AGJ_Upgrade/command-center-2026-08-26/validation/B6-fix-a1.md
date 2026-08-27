FINDING 1 of 2
WHAT FAILED: The B6 scope says to stop importing isLoopbackAddress / buildGuardianEscalationNotification and remove POST /api/guardian/escalate. src/api/routes/guardian-routes.ts still imports both helpers at lines 3-4, still exports registerGuardianRoutes at line 115, and still registers "/api/guardian/escalate" at lines 120-121.
THE FIX: Delete src/api/routes/guardian-routes.ts if no remaining caller needs it; otherwise remove registerGuardianRoutes, its app.post("/api/guardian/escalate", ...) registration, and the imports from ./overmind-routes.js and ../../services/overmind-notifications.js from that module. Remove or rewrite stale guardian-route unit tests that directly import this removed API-layer route.
WHY THE LAST ATTEMPT MISSED IT: It only unregistered the route from createApiServer and did not remove the orphan module surface required by the scope.

FINDING 2 of 2
WHAT FAILED: tests/guardian-removal.test.ts passes even while src/api/routes/guardian-routes.ts still imports isLoopbackAddress/buildGuardianEscalationNotification and still contains the guardian escalate route literal, so the focused test does not discriminate the helper-import/removal clause.
THE FIX: Add a source-level regression in tests/guardian-removal.test.ts that reads src/api/routes/guardian-routes.ts when it exists and asserts it does not contain "isLoopbackAddress", "buildGuardianEscalationNotification", "registerGuardianRoutes", or "/api/guardian/escalate"; alternatively assert the file no longer exists. Keep the existing Fastify inject check for the public createApiServer path.
WHY THE LAST ATTEMPT MISSED IT: The test covered server.ts and runtime registration only, not the stale route module named by the scope.
