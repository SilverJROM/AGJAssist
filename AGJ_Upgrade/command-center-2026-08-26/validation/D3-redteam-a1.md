RED-TEAM D3 attempt 1

Commit under test: 01b8e383443991161c20a65ba9026dcacf173372
Scope authority: E1/E3 have no criterion text, so the slice scope is authoritative.

Focused test result:
PASS - node scripts/cc-run-isolated.mjs --slice D3 -- npx vitest run tests/unit/reply-summary-service.spec.ts --minWorkers=1 --maxWorkers=4

Lens 1 - endpoint URL contract
FAIL - SummaryEndpointService/schema store OpenAI-compatible base_url values as-is including /v1, for example http://192.168.254.140:1234/v1. ReplySummaryService then calls `${base_url}/v1/chat/completions`, yielding /v1/v1/chat/completions. That does not call the selected /v1/chat/completions endpoint.

Lens 2 - endpoint attribution persistence
PASS - On a mocked successful LLM response, the service inserts agent_name, endpoint_id, summary_text, and provenance into agent_summaries.

Lens 3 - graceful LLM failure
PASS - Rejected fetch and non-2xx responses return null and do not insert summaries.

Lens 4 - test discrimination
PARTIAL - The tests use literal mocked LLM output for summary assertions, but the explicit endpoint URL test encodes the incorrect /v1/v1/chat/completions behavior as expected.

Verdict: FAIL
