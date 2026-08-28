# C0 Red-Team A1

Verdict: standard-fail.

Lens 1 - runnable real server: FAIL. The focused C6 gate cannot start the Playwright webServer because `src/services/ovm-session.ts` imports missing `src/services/overmind/pane-utils.js`.

Lens 2 - positive C1-C6 discrimination: FAIL. C5 asserts `LITERAL_ACTIVE_C5` in the UI row, but the current public row renders only id and cadence minutes.

Lens 3 - negative-control specificity: FAIL. `FENCE_STUB=C3` intercepts `/api/agent-reminders/active` globally, while both C4 and C5 use that endpoint. The C6 gate expects exactly C5 to fail.

Lens 4 - report/fail-closed behavior: PARTIAL. `fence-report-v1.json` is written with `verdict=FAIL`, but because the spec never starts it records no named failed ids. That is acceptable for fail-closed execution, but not enough for a clean harness pass.

Scope note: `HARNESS-SMOKE` has no criterion text in `og-requirements.md`; I treated the C0 scope paragraph and C6 fence contract as authority.
