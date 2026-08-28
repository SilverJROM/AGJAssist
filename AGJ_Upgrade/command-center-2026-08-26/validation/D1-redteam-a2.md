# D1 validator red-team a2

Commit under test: e1c0cca2cb7ca416184e6135991fa081c86ffae6

Focused command:
`node scripts/cc-run-isolated.mjs --slice D1 -- npx vitest run tests/unit/summary-schema.spec.ts --minWorkers=1 --maxWorkers=4`

Result: PASS, 4 tests passed. Log: `validation/D1-vitest-a2.log`.

Scope/requirements note: the prompt says E1/E3/F2/F3 have no criterion text and to treat D1 scope as authority. Local `og-requirements.md` does contain F2/F3 text, so I used the stricter combined reading: D1 scope plus F2 "one endpoint is the default; the seeded default is labelled 140" and F3 "no plaintext secrets."

Lens 1 - fresh schema shape: PASS. Fresh DB creates `summary_llm_endpoints` and `agent_summaries` with provenance and timestamp columns.

Lens 2 - seeded default: PASS. Fresh DB and v38 upgrade each contain exactly one default endpoint with literal name `140`, base URL `http://192.168.254.140:1234/v1`, model `qwen2.5-14b-instruct`, and provenance `system`.

Lens 3 - one-default invariant: PASS. Independent probe attempted to insert a second row with `is_default = 1`; SQLite rejected it through `idx_summary_llm_endpoints_one_default`.

Lens 4 - fresh-vs-upgrade parity: PASS. Fresh and v38-upgraded DBs expose the same D1 columns, seeded default, and unique default index.

Lens 5 - no plaintext secret columns: PASS. Neither D1 table adds `api_key`, `secret`, or token-like credential storage columns.

Lens 6 - test discrimination: PASS. The focused spec uses literal expected values for seeded `140` and a negative second-default specimen that fails if the partial unique index is removed.

Conclusion: PASS.
