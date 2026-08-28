RED-TEAM D3 attempt 2

Commit under test: 6144ea00896d968f67f8b9460f9c651c9189a89c
Scope authority: E1/E3 have no criterion text, so the D3 slice scope is authoritative.

Focused test result:
PASS - node scripts/cc-run-isolated.mjs --slice D3 -- npx vitest run tests/unit/reply-summary-service.spec.ts --minWorkers=1 --maxWorkers=4

Lens 1 - selected /v1/chat/completions URL
PASS - SummaryEndpointService/schema store OpenAI-compatible base_url values including `/v1`; ReplySummaryService appends `/chat/completions`, producing exactly `/v1/chat/completions` for both seeded default and explicit endpoints.

Lens 2 - endpoint selection
PASS - The service uses getDefault() without endpointId and getById(endpointId) when provided, and the tests assert distinct literal URLs for those paths.

Lens 3 - endpoint-attributed persistence
PASS - Successful mocked LLM responses persist agent_name, endpoint_id, summary_text, and system provenance in agent_summaries.

Lens 4 - LLM failure degradation
PASS - Rejected fetch and non-2xx response paths return null and do not persist summary rows.

Lens 5 - test discrimination
PASS - The URL expectations and summary outputs are literals; the explicit endpoint fixture is deliberately different from the seeded default, so the doubled-/v1 regression would fail.

Verdict: PASS
