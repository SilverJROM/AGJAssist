commit=0890c6f467fa87b096876175f32bbe22c962cf2e

Scope note: the validator prompt says E2/F1/F2/F3 have no criterion text, so I treated D4 scope as authority.

Focused test: PASS. Ran exactly:
node scripts/cc-run-isolated.mjs --slice D4 -- npx vitest run tests/summary-routes.test.ts --minWorkers=1 --maxWorkers=4
Result: tests/summary-routes.test.ts passed 14/14.

Lens 1 - owner-only route protection: PASS. D4 routes continue to use [authMiddleware, requireOwner].

Lens 2 - previous secret-bearing URL failure: PASS. POST/PATCH reject embedded credentials, query strings, and fragments; probe responses did not echo supersecret, leakme, or token-leak.

Lens 3 - valid OpenAI-compatible URL path: PASS. Clean http(s) URLs with path /v1 continue to create/update endpoints through the API.

Lens 4 - per-agent summaries newest-first: PASS. The route still uses a bound agent_name parameter and ORDER BY created_at DESC, id DESC.

Lens 5 - PATCH validation completeness: FAIL. PATCH /api/summary-endpoints/:id validates base_url only when body?.base_url is truthy. A literal empty-string update is falsey, bypasses isOpenAICompatibleBaseUrl, returns 200, and persists base_url="".
