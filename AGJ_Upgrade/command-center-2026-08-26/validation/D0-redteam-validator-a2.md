D0 validator red-team a2

Commit under test: 7a4c7c0a77eb199995696786c3f979c2b1e1a3b4

Scope authority: HARNESS-SMOKE has no og-requirement text, so the D0 scope text was used as the contract.

Lenses:
- Contract routing: PASS. The harness uses FENCE_ORIGIN and OWNER_TOKEN, and does not add or depend on the forbidden unauth summary routes.
- Positive control: PASS. .fence-gate-pos.json collected E1,E2,E3,F1,F2,F3 with no failures.
- Negative control: PASS. .fence-gate-neg.json fails exactly E1 kind=assert under FENCE_STUB=D3.
- Report aggregation: PASS. fence-report-v1.json preserves the positive passed ids and records the expected negative as assert-negative instead of masking positive failures.
- Diff scope: PASS. The tested commit changes only the D0 harness and gate runner, with no product routes or product code.

Verdict: PASS.
