E0c validator red-team pass, attempt 1

Commit under test: 126885a5460b6d494425f8ef450820438fcbb875
Scope authority: HARNESS-SMOKE has no criterion text, so the slice scope is the authority.

Lenses checked:
- Named commit/diff: only e2e/command-center-wakeup-fence.spec.ts changed; product code untouched.
- Failure-preservation mechanism: afterAll now writes the aggregate without deleting contributor shards, so a replacement worker can still read an earlier failed shard.
- Negative control discrimination: FENCE_STUB=E2 fails test_e2 after finishContributor writes its shard; final gate report preserves E2 as assert-negative.
- Stale-shard contamination: unrelated F-shards existed in the repo root, but this spec aggregates only CONTRIBUTOR_TESTS for E1-E4, so they did not affect the E5 report.
- Positive path regression: positive gate run passed E1-E4 with failed: [].

Result: standard-clean.
