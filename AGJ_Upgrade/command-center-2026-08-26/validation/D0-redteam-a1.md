Standard-tier red-team pass for D0 validator attempt 1.

Commit under test: e88a200c3c5a37dd5ad7959a674dc1a8203ad03c

Lens 1 - owner-gated route contract: PARTIAL PASS. The harness uses FENCE_ORIGIN,
OWNER_TOKEN, Authorization headers, and the real /api/summary-endpoints and
/api/summary-agents/:agentName/summaries routes. It no longer relies on the
invented unauth 200, /api/agent-summaries, or /api/summary-endpoints/default
paths.

Lens 2 - D3 negative discrimination: PASS. The required gate command returned
0, with the positive run passing all E1,E2,E3,F1,F2,F3 and the FENCE_STUB=D3
negative run producing named red E1 kind=assert.

Lens 3 - closed-C6 arrival fixture: FAIL. The harness never creates a C6-style
due solicit reminder, never starts a real tmux temp pane, never fires
scripts/cc-fire-due.mts, never provides a real local summary endpoint response,
and never proves that an agent reply was captured into agent_summaries. The
only summary-agent assertions allow an empty summaries array.

Lens 4 - UI summaries surface: FAIL. E2 only asserts that body text is nonempty
on /#/terminals. It does not open data-testid="summaries-toggle", require
data-testid="agent-summaries-dropdown", or assert a summary card containing the
literal summary from the arrival fixture.

Lens 5 - report emission: PASS. The spec writes fence-report-v1 JSON in finally,
and the runner produced .fence-gate-pos.json, .fence-gate-neg.json, and
fence-report-v1.json on disk.

Verdict: FAIL. Runtime gate mechanics pass, but the harness does not satisfy
the slice's harness-correctness contract because it does not exercise the
closed-C6 solicit-reply arrival fixture and is not discriminating for persisted
or visible summaries.
