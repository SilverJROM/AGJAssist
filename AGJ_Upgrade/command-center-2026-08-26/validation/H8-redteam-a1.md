H8 validator attempt 1 red-team notes

Commit under test: 78fe35e10ee05ad7bdae57c5e881d30bb2c02a0b
Criterion: HARNESS-SMOKE has no og-requirement text; Scope is treated as authority.

Commands run:
- git show 78fe35e10ee05ad7bdae57c5e881d30bb2c02a0b
- git diff 78fe35e10ee05ad7bdae57c5e881d30bb2c02a0b^..78fe35e10ee05ad7bdae57c5e881d30bb2c02a0b
- timeout --signal=TERM --kill-after=15s 180s bash -lc 'FENCE_ID=B8 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs --gate'
- timeout --signal=TERM --kill-after=15s 180s bash -lc 'FENCE_ID=B8 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs'

Focused gate result:
- Exit code 0.
- Positive report .fence-gate-pos.json collected A1,A2,A3,A4,A5,B1,B2 and passed all seven ids, including B2.
- Negative report .fence-gate-neg.json collected all seven ids, passed A1,A3,A4,A5,B1,B2, and failed A2 with kind assert.

Integration path result:
- Exit code 0.
- fence-report-v1.json contains verdict_line "fence=B8 verdict=PASS fault_class=none".
- fence-report-v1.json contains collected, passed, and failed arrays from the spec report.

Standard red-team lenses:
- Collection continuity: removing the throw inside check lets later assertions run after A2 red; the B2 negative report proves B2 still runs and passes after A2 fails.
- Report-path isolation: the runner passes FENCE_REPORT_PATH into Playwright; the generated root report is populated from the spec report instead of a fallback empty report.
- Verdict token shape: emitted verdict_line is whitespace-split key=value tokens with no spaces in values.
- B2 interception: FENCE_STUB=B2 registers an explicit GET /api/overmind/status before route groups, so the unregistered-route case is no longer dependent on a preHandler that cannot fire.
- Local drift: no uncommitted diffs exist in e2e/command-center-ovm-fence.spec.ts, e2e/run-command-center-playwright-fence.mjs, or src/api/server.ts.

Conclusion: standard-clean PASS.
