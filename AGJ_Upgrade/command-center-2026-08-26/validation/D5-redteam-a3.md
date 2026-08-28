# D5 validation red-team a3

Commit under test: 51008ba051983653bcf032430a8bd8a71990ae92

Scope authority: F1/F2/F3 have no criterion text in og-requirements.md for this slice, so I judged the D5 scope text directly: port SummaryEndpointSettings UI sheet with add/edit/remove, radio default, seeded 140, owner-only errors.

Focused test result:
- `timeout --signal=TERM --kill-after=15s 180s npx playwright test e2e/command-center-endpoints.spec.ts --project=cc` passed 6/6.

Independent UI probe:
- `validation/D5-ui-probe-a3.mjs` used stateful literal route fixtures and exact endpoint-id checks for PATCH `/api/summary-endpoints/2`, POST `/api/summary-endpoints/2/default`, DELETE `/api/summary-endpoints/2`, and POST 403.
- The probe passed and wrote screenshot/DOM evidence in `validation/D5-ui-a3.png` and `validation/D5-dom-aria-a3.txt`.

Red-team lenses:
- Product behavior lens: the shipped UI still satisfies the D5 behaviors under strict validation fixtures: seeded 140 renders, edit payload is sent, delete refresh removes the row, default posts `/2/default`, and owner-only errors render visibly.
- Focused spec edit-target lens: the committed edit test asserts PATCH payload values but only waits for a PATCH request whose URL includes `/api/summary-endpoints/`; it does not assert the selected endpoint id `/2`. A wrong implementation could PATCH `/api/summary-endpoints/1` with the edited payload and the test route would still mark `patched = true`, return the edited row fixture, and pass.
- Focused spec delete-target lens: the committed delete test only waits for any DELETE request under `/api/summary-endpoints/`; its route fixture sets `deleted = true` for any DELETE path. A wrong implementation could DELETE `/api/summary-endpoints/1`, then the fixture would still return only endpoint 140 and the test would pass.
- Focused spec default lens: the default radio test now asserts POST `/api/summary-endpoints/2/default`, `defaultedId === '2'`, and checked/unchecked state, so this lens is clean.
- Focused spec owner-error lens: the owner-error test asserts the literal role error in `data-testid="endpoint-error"`, so this lens is clean.

Verdict: FAIL. Product behavior appears corrected, but the required focused spec still does not discriminate edit/delete target endpoint ids.
