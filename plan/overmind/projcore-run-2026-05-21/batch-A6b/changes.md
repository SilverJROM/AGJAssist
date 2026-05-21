# Batch A6b Changes

## User Report

APPROVED-PLAN for A6b. Proceed exactly as proposed. The deterministic ALWAYS_ESCALATE_KEYWORDS guardrail overriding the brain is the key safety property — make sure the test proves a 'merge to master' decision is force-escalated even when the fake brain returns action=answer. Implement on feat/overmind, commit, gate (npx tsc clean + npx vitest run tests/overmind-decision.test.ts green; keep all prior overmind tests green). Artifacts batch-A6b/changes.md + test-report.md + independent-validation.md + decisions/ if any. Append callback FIRST ([projcore callback] A6b DONE <note>), THEN reply STATUS: DONE -- reason. Coordinator-only, Sonnet only, no UI.

## Root Cause Mechanism

A3 could classify coordinator numbered-option prompts as `awaiting_decision` and capture `pending_decision`, and A6a added the Sonnet-backed stuck brain. The watcher still treated `awaiting_decision` as a passive non-nudge state: it did not read the workflow north-star/trust-defaults, could not answer covered decisions, could not deterministically override risky auto-answers, and did not create the R16 projcore frontload correction.

## Changes

- `src/services/overmind-brain.ts`: added `DecisionInput`, `DecisionVerdict`, `answerDecision(...)`, the Sonnet decision prompt, and strict JSON normalization for answer/escalate verdicts.
- `src/services/overmind-brain.ts`: added named `ALWAYS_ESCALATE_KEYWORDS` plus `hasAlwaysEscalateKeyword(...)` for deterministic guardrail enforcement.
- `src/services/overmind-watcher.ts`: routed `awaiting_decision` into a decision path instead of the nudge ladder, reads `run_dir/north-star.md` and `~/.claude/JROM/style/trust-defaults.md`, and calls `brain.answerDecision(...)`.
- `src/services/overmind-watcher.ts`: forces escalation when the pending decision matches the guardrail, sends safe answers only to the coordinator, sends the R16 frontload correction note, logs corrections under `corrections/overmind-decision-corrections.md`, and marks each same pending-decision episode handled once.
- `tests/overmind-decision.test.ts`: added fake-brain coverage for safe answers, forced `merge to master` escalation even when the fake brain returns `answer`, uncovered escalation, once-only handling, and child-session non-targeting.
- `tests/overmind-brain.test.ts`: updated the fake brain to satisfy the expanded `OvermindBrain` interface.

## Caveats

The deterministic keyword helper currently treats the listed guardrail strings as case-insensitive substring matches. That intentionally favors over-escalation for safety.

Autonomous decisions: none.
