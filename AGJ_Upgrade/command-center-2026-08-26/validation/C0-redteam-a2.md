# C0 Red-Team A2

Commit under test: `1391321095e5d4d9eb3e82d1ab98306eb4c0e678`

Verdict: standard-fail.

Lens 1 - focused gate execution: FAIL. The real server boots now, but `FENCE_ID=C6 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs --gate` exits 1. Positive and negative reports both record C5 and C6 failures.

Lens 2 - C5 UI mechanism: FAIL. The ARIA snapshot from the failed run shows no selected terminal pane and no open reminder sheet. The harness uses a generic select/index mechanism instead of selecting a known temp pane.

Lens 3 - C6 positive journey: PARTIAL/FAIL. C6 is named failed in the positive run, but the swallowed assertion error means the concrete failing assertion is not visible in `fence-report-v1.json`. The report should preserve enough diagnostic text while still collecting all ids.

Lens 4 - negative-control specificity: FAIL. `FENCE_STUB=C3` still fails C6 because C6 calls the same plain `/api/agent-reminders/active` endpoint that the stub intentionally breaks for the C5 UI path. The gate expects exactly C5.

Scope note: `HARNESS-SMOKE` has no criterion text in `og-requirements.md`; I treated the C0 scope paragraph and C6 fence contract as authority.
