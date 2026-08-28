FINDING 1 of 2
WHAT FAILED: The focused D7 gate failed in e2e/command-center-summaries-fence.spec.ts E1. The positive run timed out at Playwright's 60000ms test timeout and wrote failed E1 kind=assert because no `LITERAL_SUMMARY_FOR_TEST` row appeared in GET /api/summary-agents/<unique-agent>/summaries.
THE FIX: Make E1 use an actual summary-creation mechanism that exists in the application under test. If the intended production arrival path is service-level, invoke it through a real app-owned CLI/API hook rather than a Playwright-local import; if the intended path is UI/API, add/use the concrete route or script that captures a tmux pane reply and calls ReplySummaryService with that captured text. The harness should then create/fire the C6 reminder, produce the pane reply, trigger that concrete capture mechanism, and poll only the public /api/summary-agents/<unique-agent>/summaries read path for `LITERAL_SUMMARY_FOR_TEST`.
WHY THE LAST ATTEMPT MISSED IT: It assumed opening the summaries dropdown generated summaries, but the UI only reads existing summaries.

FINDING 2 of 2
WHAT FAILED: e2e/command-center-summaries-fence.spec.ts currently waits 10000ms plus up to 120 polling iterations inside one Playwright test whose default timeout is 60000ms. When the summary is missing, the named assertion is masked by a test timeout before the intended polling budget completes.
THE FIX: Set an explicit test timeout large enough for the harness path, or reduce the E1 polling/wait budget so the named E1 assertion fails before Playwright's test-level timeout. Keep the outer command timeout wrapper unchanged.
WHY THE LAST ATTEMPT MISSED IT: It increased the poll loop from 60 to 120 without increasing the Playwright test timeout.
