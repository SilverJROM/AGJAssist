Standard-tier red-team pass for D0 validator attempt 3.

Commit under test: 8a0ebc526ecf5f5b8086e27ea36124ccd97e7541

Scope authority note: HARNESS-SMOKE has no og-requirements.md text, so this
review treats the D0 scope paragraph as the contract.

Lens 1 - focused gate execution: FAIL. The required command
`FENCE_ID=D7 AGJASSIST_FENCE_DB_MODE=temp-copy node
e2e/run-command-center-playwright-fence.mjs --gate` exited 1. The positive run
timed out at Playwright's 60000ms test timeout and wrote failed E1 kind=assert;
the negative D3 run also failed E1 kind=assert. Because the positive run is
red, the gate verdict is FAIL.

Lens 2 - owner-gated route contract: PASS. The harness uses FENCE_ORIGIN,
OWNER_TOKEN, Authorization headers, /api/summary-endpoints, and
/api/summary-agents/:agentName/summaries. It does not use the old invented
unauthenticated 200, /api/agent-summaries, or /api/summary-endpoints/default
paths.

Lens 3 - closed-C6 arrival fixture: FAIL. The harness now creates/fires a
C6-style reminder and echoes a reply into tmux, but it assumes navigating to
/#/terminals and opening the summaries dropdown triggers "production capture
path" summary creation. The inspected app path only GETs
/api/summary-agents/:activeTarget/summaries and /api/summary-endpoints; it does
not call ReplySummaryService or any capture/summarization route. The positive
run proves this: no LITERAL_SUMMARY_FOR_TEST row appeared before timeout.

Lens 4 - UI verification: PARTIAL PASS. E2 now requires
data-testid="agent-summaries-dropdown" and data-testid="summary-card" with the
literal summary and endpoint label 140. That is the right visible mechanism,
but it is unreachable because E1 never creates the summary row.

Lens 5 - report emission: PASS. The spec writes fence-report-v1 in finally, and
the focused run produced .fence-gate-pos.json, .fence-gate-neg.json,
fence-report-v1.json, and the attempt log.

Verdict: FAIL. The harness is closer, but it is not green and still relies on a
nonexistent UI-triggered summary generation mechanism.
