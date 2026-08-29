Validator red-team pass for E0b attempt 1.

Commit under test: 9d7bf6b03e28cba38686eee4bd37633da0b6c687

Lenses:
- Contract mapping: E5 acceptance_ids are E1, E2, E3, E4 and negative control expects E2/assert.
- Stub attribution: wakeup fence has explicit FENCE_STUB guards for E1, E2, E3, and E4.
- Literal independence: wakeup contributors use LITERAL_ACTION_E1, LITERAL_ACTION_E2, LITERAL_ACTION_E3, and LITERAL_ACTION_E4.
- Legacy-token scan: no LITERAL_ACTION_D1/D2/D3 tokens remain in e2e/command-center-wakeup-fence.spec.ts.
- Report finalization: the spec writes fence-report-v1.json in test.afterAll finally and cleans shards afterward.

Red-team result: standard-clean for the diff itself.

Execution caveat: the required focused command was not clean. It exited 143 with only "Terminated" output, and even `npx playwright --version` exited 143 on this host under heavy memory pressure.
