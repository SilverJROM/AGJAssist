# B12l Changes

## User Report

`APPROVED-PLAN for B12l, WITH widened scope for the non-string failures — good catch stopping. The reconcile/subagent/decision/brain failures are B12i fallout; fix them, but TRIAGE each one: (1) If the guard correctly SUPPRESSES because the fixture's parent_session is a fake/no-session session → update the FIXTURE to provide a valid agent parent (mock is_agent_pane / getParentSessionForWorkflow to return an agent 'claude'/'codex' or a resolvable parent) so the test exercises its ORIGINAL intent (reconcile/decision/brain logic), nudge proceeds. That's adapting fixtures to the new guard, not gutting. (2) If the guard THROWS/errors on a null/missing parent (resolution failure) → that's a B12i ROBUSTNESS BUG: fix the guard to degrade gracefully (treat resolution-failure/error as 'unknown' → SEND the nudge, never throw). A nudge path must never crash because the parent can't be resolved. Document per-test which category in test-report.md. Plus the projcore.md/PROTOCOL doc edits + stale-string refreshes as planned. GOAL: npx vitest run tests/overmind*.test.ts fully GREEN, with each fix categorized. If any failure is a genuine deeper behavior gap you can't cleanly resolve, STATUS: NEEDS-CLARIFICATION for that one. Proceed. Callback FIRST on DONE.`

## Root Cause

R12.5 moved project identity and parent routing to JROM-owned Overmind projects, but live projcore/project-spec docs still described projcore-owned labels and `--label` / `--parent-label` registration.

The overmind test sweep also carried pre-B12i/B12h assumptions:
- Some assertions expected unprefixed/short nudge strings while production now emits `overmind:` plus expanded watcher/wakeup reminder text.
- Several tests used fake coordinator sessions without mocking `isAgentPane`, so B12i's guard correctly treated them as `no-session` and suppressed the nudge before the test's original logic could run.
- Minimal service stubs lacked `getParentSessionForWorkflow`, and parent resolution errors could crash a nudge path.

## Files

- `~/.claude/agents/projcore.md`: surgical R12.5 spec sync; registered by run-dir only, removed project-label frontload, added no-project stop condition.
- `~/.claude/agents/PROJECT_SPECS_PROTOCOL.md`: `projcore_session:` documented as legacy/informational; Overmind project `parent_session` is authoritative.
- `spark-daemon-runkit/batch-b12l/artifacts/*`: snapshots of the two live docs.
- `src/services/overmind/parent-nudge-guard.ts`: resolution failure now warns, treats pane kind as `unknown`, and sends to workflow coordinator.
- `src/services/overmind-watcher.ts`: exported test constants refreshed to current prefixed output strings.
- `tests/overmind-*.test.ts`: stale expectations and B12i fixture fallout fixed without weakening assertions.

## Autonomous Decisions

- Added a focused regression test for parent resolution failure in `tests/overmind-parent-nudge-guard.test.ts`; this is the only production robustness change beyond stale expectation and fixture updates.
