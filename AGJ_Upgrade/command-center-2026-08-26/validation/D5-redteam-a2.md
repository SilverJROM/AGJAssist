# D5 validation red-team a2

Commit under test: 270ba0d40327be86a978ef40e5b083529606d7cf

Scope authority: F1/F2/F3 have no criterion text in og-requirements.md for this slice, so I judged the D5 scope text directly: port SummaryEndpointSettings UI sheet with add/edit/remove, radio default, seeded 140, owner-only errors.

Focused test result:
- `timeout --signal=TERM --kill-after=15s 180s npx playwright test e2e/command-center-endpoints.spec.ts --project=cc` passed 6/6.

Independent UI probe:
- `validation/D5-ui-probe-a2.mjs` used stateful literal route fixtures for PATCH `/api/summary-endpoints/2`, POST `/api/summary-endpoints/2/default`, DELETE `/api/summary-endpoints/2`, and POST 403.
- The probe passed and wrote screenshot/DOM evidence in `validation/D5-ui-a2.png` and `validation/D5-dom-aria-a2.txt`.

Red-team lenses:
- Product behavior lens: visible endpoint error state is now rendered via `data-testid="endpoint-error"` / `role="alert"`, and the strict probe confirms create-error, edit, delete, and default actions work against stateful fixtures.
- Focused spec discrimination lens: the committed edit test stores `patchBody` but never asserts it; it only asserts that some PATCH request happened.
- Focused spec discrimination lens: the committed delete test advertises row removal but intentionally returns the same two rows after DELETE and has no post-delete row assertion.
- Focused spec discrimination lens: the committed default test does not wait for or assert POST `/api/summary-endpoints/2/default`, does not assert `defaultedId === '2'`, and can pass from the radio's native checked state rather than a confirmed API/GET refresh.

Verdict: FAIL. Product behavior appears corrected, but the required focused spec still does not discriminate the scoped edit/delete/default mechanisms.
