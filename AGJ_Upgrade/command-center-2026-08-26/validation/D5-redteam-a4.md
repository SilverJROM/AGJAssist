# D5 validation red-team a4

Commit under test: 5990791a082b16d75224545b879ddef5fe1e90a6

Scope authority: F1/F2/F3 have no criterion text in og-requirements.md for this slice, so I judged the D5 scope text directly: port SummaryEndpointSettings UI sheet with add/edit/remove, radio default, seeded 140, owner-only errors.

Focused test result:
- `timeout --signal=TERM --kill-after=15s 180s npx playwright test e2e/command-center-endpoints.spec.ts --project=cc` passed 6/6.

Independent UI evidence:
- `validation/D5-ui-probe-a4.mjs` exercised the shipped UI with strict stateful fixtures.
- It required PATCH `/api/summary-endpoints/2` with literal edited values, POST `/api/summary-endpoints/2/default`, DELETE `/api/summary-endpoints/2`, and visible POST 403 owner error text.
- It passed and wrote screenshot/DOM evidence in `validation/D5-ui-a4.png` and `validation/D5-dom-aria-a4.txt`.

Red-team lenses:
- Scope coverage: seeded `140`, create, edit, delete, radio default, and owner-only error display are covered by the focused spec and independent probe.
- Test discrimination: create/edit payload assertions use literal values; edit/delete/default now assert literal endpoint id `2` in the request path; delete uses a stateful follow-up GET and visible row-removal assertions; owner error asserts the literal server error in `data-testid="endpoint-error"`.
- Product behavior: `src/web/public/app.js` holds endpoint list/form/default/error state inside the terminal settings sheet and routes POST/PATCH/DELETE/default calls through the existing `api()` helper.
- Error handling: endpoint actions clear previous errors before requests and render failures in a `role="alert"` element inside the Summary Endpoints sheet.
- Evidence: screenshot and DOM/ARIA artifacts exist for the user-visible settings sheet path.

Verdict: PASS. The D5 scope survives the standard-tier adversarial pass.
