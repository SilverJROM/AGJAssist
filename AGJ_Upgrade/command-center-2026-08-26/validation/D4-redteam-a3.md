commit=6a11ee027c1e9e0803fcc1c8cbb05c8b3c1a1ae3

Scope note: the validator prompt says E2/F1/F2/F3 have no criterion text, so I treated D4 scope as authority.

Focused test: PASS. Ran exactly:
node scripts/cc-run-isolated.mjs --slice D4 -- npx vitest run tests/summary-routes.test.ts --minWorkers=1 --maxWorkers=4
Result: tests/summary-routes.test.ts passed 15/15.

Lens 1 - owner-only route protection: PASS. The D4 endpoints use authMiddleware plus requireOwner, and an injected viewer request to GET /api/summary-endpoints returned 403.

Lens 2 - OpenAI-compatible base URL validation: PASS. Clean /v1 URL creation returned 201. Credential, query, fragment, invalid, and empty PATCH base_url specimens returned 400.

Lens 3 - secret exposure: PASS. Rejected credential/query/fragment specimens returned generic validation errors and did not echo supersecret, leakme, or token-leak. No logging calls were added in the route diff.

Lens 4 - PATCH preservation: PASS. PATCH with base_url="" returned 400, and GET /api/summary-endpoints/:id still returned the original literal base_url.

Lens 5 - per-agent summaries newest-first: PASS. A public GET after inserting older/newer literal timestamps returned summaries in ["newer", "older"] order.
