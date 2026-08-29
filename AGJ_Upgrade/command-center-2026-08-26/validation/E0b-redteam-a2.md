Validator red-team pass for E0b attempt 2.

Commit under test: HEAD at validation time, 9d7bf6b03e28cba38686eee4bd37633da0b6c687.

Scope note:
- HARNESS-SMOKE has no criterion text in og-requirements.md; per brief, this validation treats the E0b scope text as authority.

Lenses:
- Contract mapping: E5 acceptance_ids are the four distinct contributor IDs E1, E2, E3, and E4.
- Negative control mapping: E5 negative_control_cmd uses FENCE_STUB=E2 and expects only E2/assert as the named-red failure.
- Stub attribution: the wakeup fence spec has separate FENCE_STUB guards for E1, E2, E3, and E4.
- Literal independence: contributor checks use separate literal action specimens LITERAL_ACTION_E1 through LITERAL_ACTION_E4.
- Legacy-token scan: no LITERAL_ACTION_D1, LITERAL_ACTION_D2, or LITERAL_ACTION_D3 tokens remain in the wakeup fence spec.
- Report finalization: test.afterAll writes fence-report-v1.json in a finally path before shard cleanup.

Red-team result: standard-clean for the diff itself.

Execution result:
- Required focused command exited 143 before Playwright emitted test-level results.
- Generated fence-report-v1.json collected E1-E4 but had no passed IDs and verdict FAIL.
- Host state showed memory pressure with swap full during validation.
