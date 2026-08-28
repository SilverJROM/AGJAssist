Standard-tier red-team pass for D0 validator attempt 2.

Commit under test: 5a54514d1553cc6f6ce6078d682767339c502c24

Scope authority note: HARNESS-SMOKE has no og-requirements.md text, so this
review treats the D0 scope paragraph as the contract.

Lens 1 - owner-gated route contract: PASS. The harness uses FENCE_ORIGIN,
OWNER_TOKEN, Authorization headers, the real /api/summary-endpoints route, and
the real /api/summary-agents/:agentName/summaries route. It does not rely on
the prior invented /api/agent-summaries or /api/summary-endpoints/default
paths.

Lens 2 - D3 named negative control: PASS. The required gate command returned
0. The positive report passed E1,E2,E3,F1,F2,F3, and the FENCE_STUB=D3 run
failed exactly E1 kind=assert.

Lens 3 - closed-C6 solicit-reply arrival fixture: FAIL. The harness creates and
fires a due C6-style reminder, but it does not capture the reply as the
arrival path. It sends `Reply: literal reply text` into tmux after firing, then
directly imports ReplySummaryService and calls `svc.summarize(agentName,
'Reply: literal reply text')`. That is a direct service shortcut with a faked
reply body, not proof that the closed-C6 fired pane reply was captured and
summarized by the production integration path.

Lens 4 - UI summaries verification: FAIL. E2 says UI checks are best-effort and
uses /api/summary-agents/:agentName/summaries as a proxy for UI visibility. It
never clicks data-testid="summaries-toggle", never requires
data-testid="agent-summaries-dropdown", and never asserts a
data-testid="summary-card" containing the literal fixture summary and endpoint
label/name.

Lens 5 - report emission and cleanup: PASS. The spec writes fence-report-v1 in
finally, and the focused run produced .fence-gate-pos.json,
.fence-gate-neg.json, fence-report-v1.json, and the attempt log.

Verdict: FAIL. The gate mechanics pass, but the harness still does not satisfy
the harness-correctness contract because it bypasses the reply-arrival capture
mechanism and does not verify the visible summaries UI.
