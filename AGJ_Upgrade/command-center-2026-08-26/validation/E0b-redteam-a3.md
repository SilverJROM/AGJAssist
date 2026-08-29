Validator red-team pass for E0b attempt 3.

Commit under test: aab20bbfe9dc9a6bdc83b15def2a09661cbc475f.

Scope note:
- HARNESS-SMOKE has no criterion text in og-requirements.md; per brief, this validation treats the E0b scope text as authority.

Lenses:
- Pinned diff lens: the only a3 commit change is in `e2e/command-center-wakeup-fence.spec.ts`, where E3 now uses a valid route fixture selector.
- Route fixture lens: E3 still creates a real tmux session, but posts `routePaneTarget = ${sessionName}:0`, matching the public route's accepted selector form instead of the pane-qualified `#S:#I.#P` value.
- Attribution lens: E1, E2, E3, and E4 retain separate FENCE_STUB guards, so named-red attribution remains contributor-specific.
- Literal specimen lens: E1-E4 retain independent literal action tokens `LITERAL_ACTION_E1` through `LITERAL_ACTION_E4`; no D1/D2/D3 wakeup literals remain in the wakeup fence spec.
- Contract lens: E5 `acceptance_ids` are E1-E4 and its negative control is still `FENCE_STUB=E2` expecting E2/assert.
- Report-finally lens: the spec has `test.afterAll` writing `fence-report-v1.json` before shard cleanup.
- Execution lens: the focused E5 fence command completed with exit 0, four Playwright tests passed, and `fence-report-v1.json` reports E1-E4 passed with no failures.

Red-team result: standard-clean.
