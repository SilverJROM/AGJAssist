# Batch O2 Changes

## User Report

Next batch O2 (IMPLEMENTER; /projcore from AGJ-51). Read plan/overmind/projcore-run-2026-05-21-ovm/prompts/batch-O2.md and follow EXACTLY. O2 = (A) write the OVM operator primer doc + (B) OVM session manager endpoints: open(reuse-if-exists)/restart/close/status that create tmux OVM + launch 'claude --dangerously-skip-permissions --model sonnet' + send a kickoff to read the primer. MANDATORY handshake: STATUS: PROPOSED first, WAIT for APPROVED-PLAN. feat/overmind. Callback FIRST. Give me your PROPOSED plan now.

APPROVED-PLAN for O2. Proceed exactly as proposed. Make the primer accurate + concise (it's the brain's knowledge base). Implement on feat/overmind, commit, gate (manager unit test with mocked tmuxService: reuse-if-exists vs create, close terminates; npx tsc; npm run build). Artifacts batch-O2/changes.md + test-report.md + independent-validation.md. Append callback FIRST ([projcore callback] O2 DONE <note>), THEN STATUS: DONE -- reason. Don't do the TG commands (O4) or web tab (O3).

## Root Cause / Mechanism

OU2 needed a browser-authenticated session manager for the persistent `OVM` tmux console plus a startup primer for the Claude operator. Existing tmux primitives already supported bare session targets and safe text+enter sends; the missing layer was OVM-specific reuse/restart/close/status orchestration and endpoint exposure.

## Files Changed

- `plan/overmind/OVM_OPERATOR_PRIMER.md`: new concise operator knowledge base with Overmind features, known lessons, inspect/adjust commands, and hard safety rules.
- `src/services/ovm-session.ts`: new OVM session manager around `tmuxService`, including reuse detection, Claude launch, settle delay, kickoff, restart, close, and status.
- `src/api/routes/overmind-routes.ts`: added JWT-protected `/api/overmind/ovm/open`, `/restart`, `/close`, and `/status` endpoints.
- `src/api/server.ts`: threaded the optional OVM session manager into Overmind route registration.
- `src/index.ts`: constructs the real OVM session manager with the configured `OVERMIND_TOKEN`.
- `tests/ovm-session.test.ts`: mocked-tmux manager tests for reuse, create+launch+kickoff, restart, and close.
- `tests/overmind-routes.test.ts`: route coverage proving JWT protection and endpoint delegation.

## Scope Guard

No Telegram OVM chat commands (O4) and no OVM web tab UI (O3) were implemented.

Autonomous decisions: none.
