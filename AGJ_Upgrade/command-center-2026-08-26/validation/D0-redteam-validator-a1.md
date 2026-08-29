D0 validator red-team a1

Commit under test: 917e3edf619f216e34bc0cc734256cb41dc8c070

Lenses:
- Contract routing: PASS. The spec uses FENCE_ORIGIN plus OWNER_TOKEN and does not invent the forbidden unauth summary routes.
- Collection surface: PARTIAL. The spec names E1,E2,E3,F1,F2,F3, but the positive run stops at F3 before E2.
- Negative control: PASS. FENCE_STUB=D3 produces exactly E1 kind=assert in .fence-gate-neg.json.
- Positive control: FAIL. .fence-gate-pos.json shows F3 kind=assert because [data-testid="summary-endpoint-sheet"] remains hidden after [data-testid="terminal-menu"] is clicked.
- Report integrity: FAIL. fence-report-v1.json records only the negative E1 failure and drops the positive F3 failure.

Verdict: FAIL.
