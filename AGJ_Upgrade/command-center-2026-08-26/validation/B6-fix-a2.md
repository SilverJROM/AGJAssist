FINDING 1 of 2
WHAT FAILED: B6 scope is the authority for B1/B2 because og-requirements.md has no criterion text. That scope requires removing registerGuardianRoutes and POST /api/guardian/escalate and stopping the API-layer imports of isLoopbackAddress / buildGuardianEscalationNotification. src/api/routes/guardian-routes.ts still imports those helpers at lines 3-4, exports registerGuardianRoutes at line 115, and registers "/api/guardian/escalate" at lines 120-121.
THE FIX: Delete src/api/routes/guardian-routes.ts and remove/update tests/guardian-routes.test.ts, since createApiServer no longer calls the route. If the file must stay temporarily, remove registerGuardianRoutes, the app.post("/api/guardian/escalate", ...) block, and the imports from ./overmind-routes.js and ../../services/overmind-notifications.js.
WHY THE LAST ATTEMPT MISSED IT: It removed only the createApiServer import/call and left a directly importable API route module.

FINDING 2 of 2
WHAT FAILED: tests/guardian-removal.test.ts is not discriminating for the failed scope clause. It checks src/api/server.ts and public createApiServer injection, but still passes while src/api/routes/guardian-routes.ts contains "registerGuardianRoutes", "/api/guardian/escalate", "isLoopbackAddress", and "buildGuardianEscalationNotification".
THE FIX: Add a regression specimen that reads src/api/routes/guardian-routes.ts if it exists and asserts it does not contain those four literals, or assert the file is absent. Keep the existing injection test as the public-path guard and keep the src/index.ts reminder-paging literals.
WHY THE LAST ATTEMPT MISSED IT: The test proved the server path was unregistered but did not inspect the stale route module named by the scope.
