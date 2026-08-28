# D1 validator red-team a1

Commit under test: 99dce4e5a38e54b7d2f6073063ec0ddf78cfd3be

Focused command:
`node scripts/cc-run-isolated.mjs --slice D1 -- npx vitest run tests/unit/summary-schema.spec.ts --minWorkers=1 --maxWorkers=4`

Result: PASS, 3 tests passed. Log: `validation/D1-vitest-a1.log`.

Scope/requirements note: the validator prompt says E1/E3/F2/F3 have no criterion text and to treat the slice scope as authority. Local `og-requirements.md` does contain F2 text: "One endpoint is the default; the seeded default is labelled 140 (lokalAI)." I used that text and the D1 scope phrase "with one default" as the strict requirement.

Lens 1 - fresh schema shape: PASS. Fresh DB creates `summary_llm_endpoints` and `agent_summaries`, stores provenance/timestamps, and exposes no `api_key` or `secret` column.

Lens 2 - v38 upgrade parity: PARTIAL. Upgrade creates the same tables because `SCHEMA_SQL` runs during upgrade, but it does not seed the default endpoint required by F2.

Lens 3 - one-default invariant: FAIL. `idx_summary_llm_endpoints_default` is a non-unique index, so SQLite accepts two rows with `is_default = 1`. Probe artifact: `validation/D1-default-probe-a1.json`.

Lens 4 - seeded 140 default: FAIL. Fresh DB has zero default endpoints; the commit does not insert a row labelled `140`.

Lens 5 - secret exposure: PASS for D1 schema. No plaintext secret column was added to either table.

Conclusion: FAIL. The focused tests are green but do not discriminate the F2/default requirement.
