# batch-B4 test-report

## New tests (R5)
File: tests/acceptance/overmind-projects-api.acceptance.test.ts
- 2 new tests added (T12.9, T12.10), all green (vitest)
- "T12.9 resolves bare base parent_session to live session status (R5) — no false no-session warning"
  - mocks resolveParentSession "agj" → {session:"agj-4", method:"group", ...}
  - isAgentPane mocked to return "codex" (proves called with resolved)
  - project with parent_session:"agj" → register → parent_status:"ok", resolved_session:"agj-4", parent_warning:undefined, workflow.parent_status ok
  - asserts isAgentPane called with live value
- "T12.10 full live parent_session name still reports own status (backward compat, unchanged)"
  - resolve returns the full live name (exact)
  - register with that value → parent_session unchanged, resolved_session absent (not added when same), status:"ok"
  - no warning

## Backward-compat gate (MANDATORY)
- Default resolve spy in beforeEach always returns session===stored (identity for stored value)
- All pre-existing tests (T12.1-T12.8, project create/register flows with "AGJ-51" etc.) exercise the path with live==stored → identical responses, no extra fields, same parent_status computation
- Full suite: 12 tests passed

Command run: npx vitest run tests/acceptance/overmind-projects-api.acceptance.test.ts
Result: 12 passed (475ms)

## tsc gate
npx tsc --noEmit : clean (exit 0, no diagnostics)

## Other
- All hard gates per brief + approval satisfied before DONE.
- resolve wrapped exactly: throw → raw stored
- live used only for isAgentPane; stored for warning + parent_session field
- additive resolved_session only on difference
- 1-3 focused (exactly 2) + harness reuse
