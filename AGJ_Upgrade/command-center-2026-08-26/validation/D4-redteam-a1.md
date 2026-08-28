commit=f83c817b50bbac5ba37312752433ab34de411dfa

Scope note: the validator prompt says E2/F1/F2/F3 have no criterion text, so I treated D4 scope as authority.

Focused test: PASS. Ran exactly:
node scripts/cc-run-isolated.mjs --slice D4 -- npx vitest run tests/summary-routes.test.ts --minWorkers=1 --maxWorkers=4
Result: tests/summary-routes.test.ts passed 10/10.

Lens 1 - owner-only registration: PASS. All added routes use preHandler [authMiddleware, requireOwner].

Lens 2 - endpoint CRUD/default behavior: PASS. List/get/create/patch/delete/default paths are wired to SummaryEndpointService and focused tests cover owner success plus default deletion refusal.

Lens 3 - per-agent summaries newest-first: PASS. The public route uses a bound parameter for agent_name and orders by created_at DESC, id DESC.

Lens 4 - base URL shape: FAIL. isOpenAICompatibleBaseUrl checks only protocol and pathname. It accepts a URL whose full string does not end at /v1, e.g. https://token:supersecret@example.com/v1?api_key=leakme.

Lens 5 - secrets out of responses/logs: FAIL for responses, clean for logs. No logging calls were added, but the POST response echoes the credential-bearing base_url verbatim. Probe result: POST /api/summary-endpoints with base_url=https://token:supersecret@example.com/v1?api_key=leakme returned 201 and body.endpoint.base_url contained both supersecret and api_key=leakme.
