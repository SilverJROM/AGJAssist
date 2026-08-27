FINDING 1 of 5
WHAT FAILED: Only e2e/command-center-ovm-fence.spec.ts writes fence-report-v1.json from a finally block. The reminders/summaries/wakeup/window specs still throw from check() before their final fs.writeFileSync, so a failed non-B8 run leaves stale report data. Confirmed with `FENCE_STUB=C3 FENCE_ID=C6 ...`: Playwright failed `FENCE_ASSERT:C1`, but fence-report-v1.json still contained B8 A1/A2/A3/A4/A5/B1/B2 data with only the verdict_line rewritten to C6.
THE FIX: Apply the OVM spec's try/catch/finally + final `expect(failed).toEqual([])` pattern to e2e/command-center-reminders-fence.spec.ts, e2e/command-center-summaries-fence.spec.ts, e2e/command-center-wakeup-fence.spec.ts, and e2e/command-center-window-fence.spec.ts so every failed journey writes its own collected/passed/failed report before throwing.
WHY THE LAST ATTEMPT MISSED IT: The attempt fixed the B8 smoke spec only, but A0 owns all five fence journeys.

FINDING 2 of 5
WHAT FAILED: FENCE_STUB coverage is B8-only. scripts/cc-run-isolated.mjs defines a handler only for B2, while fence-contract.json also requires C3, D3, E2, and F1 negative controls to replace contributors and fail on C5, E1, D3, and G3 respectively.
THE FIX: Add explicit stub mechanisms for C3, D3, E2, and F1 in the same harness path used by B2; each handler must alter the public assertion surface so the selected fence records the contract's expected_negative_fail_ids with kind "assert".
WHY THE LAST ATTEMPT MISSED IT: It implemented the focused B8/B2 control but did not expand the mechanism across the full five-fence contract.

FINDING 3 of 5
WHAT FAILED: e2e/run-command-center-playwright-fence.mjs --gate still treats any negative nonzero exit as a valid negative. Lines 91-98 do not read the negative report or verify expected_negative_fail_ids/expected_negative_kind, and line 96 synthesizes the expected failure id even if the actual failure was import/env/not_found or a different assert.
THE FIX: In --gate, run positive and negative with separate FENCE_REPORT_PATH files, read the negative report, and require every id in fence.expected_negative_fail_ids to appear with fence.expected_negative_kind before exiting 0 or writing those failures to fence-report-v1.json.
WHY THE LAST ATTEMPT MISSED IT: The named-report validation was added to --harness-smoke but not to --gate.

FINDING 4 of 5
WHAT FAILED: The FENCE_STUB mechanism is a port-3210 HTTP proxy in scripts/cc-run-isolated.mjs, not an in-process contributor replacement. The scope requires `FENCE_STUB=<contributor>` to replace that unit in-process before the same assertions; the proxy only rewrites selected HTTP paths and cannot replace module behavior, background jobs, DB writes, or WebSocket paths inside Fastify.
THE FIX: Load a test-mode stub registry/preload inside the Fastify process launched from src/index.ts, map FENCE_STUB to the contributor unit from fence-contract.json, and patch that module/function before route registration or job execution; keep the Playwright assertions unchanged.
WHY THE LAST ATTEMPT MISSED IT: It solved page.request interception at the network boundary instead of replacing the contributor unit in the application process.

FINDING 5 of 5
WHAT FAILED: `node scripts/cc-run-isolated.mjs --serve` deletes the temp DB on cleanup but does not print reclaimed_bytes. The focused harness output contains no reclaimed_bytes line from the serve-mode isolated runner, even though the slice requires the isolated runner to delete temp DB/server and print reclaimed_bytes.
THE FIX: Track the copied temp DB size in serve mode and print `reclaimed_bytes=<bytes>` from the cleanup path before process exit, without suppressing Playwright teardown.
WHY THE LAST ATTEMPT MISSED IT: reclaimed_bytes was implemented only for the non-serve command wrapper path.
