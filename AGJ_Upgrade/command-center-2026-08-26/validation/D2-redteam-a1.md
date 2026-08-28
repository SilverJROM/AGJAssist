# D2 validator red-team a1

Commit under test: 37567aeb8c21fe73c2e5f96907c3774c533e8bbc

Scope/requirements note: the validator prompt says F1/F2/F3 have no criterion text and to treat D2 scope as authority. Local og-requirements.md does contain F1/F2/F3 text, so I used the D2 scope as the formal gate and the local text as context.

Focused command:
`node scripts/cc-run-isolated.mjs --slice D2 -- npx vitest run tests/unit/summary-endpoint-service.spec.ts --minWorkers=1 --maxWorkers=4`

Focused result: PASS. 1 file, 6 tests passed.

Lens 1 - CRUD surface: PASS. SummaryEndpointService adds list/getById/getByName/create/update/remove methods and tests create a non-default endpoint with literal values, update it, read it back through public methods, and remove it.

Lens 2 - seeded default path: PASS. The service reads the D1-backed seeded endpoint labelled `140` through getDefault/list using literal expected values for name, base_url, model, is_default, and provenance.

Lens 3 - default switching invariant: PASS. setDefault first verifies the target exists, clears prior defaults, sets exactly the target row default, and the test asserts there is only one default after switching to a deliberately non-seeded endpoint.

Lens 4 - default removal safety: PASS. remove refuses to delete the active default, preserving a usable default endpoint.

Lens 5 - secret/log exposure: PASS. The service selects/returns only endpoint metadata columns, never selects api_key/secret fields, and contains no logging calls.

Lens 6 - test discrimination: PASS. Expected seeded values and alternate endpoint values are literals, not computed from the service under test. The default-switch test uses endpoints the mechanism would not choose by itself.

Residual note: owner-only authorization is not implemented inside this service; existing project pattern puts role checks in route/UI layers. For D2 service scope, I treated "owner-scoped" as the owner-only endpoint configuration surface backed by this global endpoint store.
