# W1 Changes

- Added relevance-filtered prior JROM decision context for both stuck analysis and decision interception.
- Raised Sonnet brain prompts to resolve autonomously by default and treat escalation of covered issues as a failure.
- Added protocol-shaped overmind notification builders for DONE, BLOCKED, and needs-input.
- Persisted once-per-transition notification gating with `overmind_workflows.last_notified_transition` and schema v14 migration.
- Routed stuck and waiting-human states through brain-gated resolve/escalate handling; resolve nudges only the coordinator and sends no Telegram message.
- Updated completion notifications to use the verdict-led DONE format and persisted transition gate.

