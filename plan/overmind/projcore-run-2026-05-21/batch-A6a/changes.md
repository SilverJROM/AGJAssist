# Batch A6a Changes

## User Report

APPROVED-PLAN for A6a. Proceed exactly as proposed. Implement on feat/overmind, commit, gate (npx tsc clean + npx vitest run tests/overmind-brain.test.ts green; keep overmind-nudge/classifier tests green). Artifacts batch-A6a/changes.md + test-report.md + independent-validation.md + decisions/ if any. One reminder: the SonnetOvermindBrain must exec the 'claude' CLI from the running app - keep the call best-effort (try/catch -> escalate-blocked) so a brain failure never crashes/spins the watcher loop. Append callback FIRST ([projcore callback] A6a DONE <note>), THEN reply STATUS: DONE -- reason. Coordinator-only, Sonnet only, no decision-answering (that is A6b).

## Root Cause Mechanism

A5 intentionally stopped after deterministic Tier 1-2 canned nudges. The watcher had a Tier-3 placeholder after `nudge_count >= MAX_CANNED_NUDGES`, but no injected brain abstraction, no Sonnet-backed analyzer, and no blocked escalation path that marked the workflow `waiting_human`.

## Changes

- `src/services/overmind-brain.ts`: added `OvermindBrain`, stuck input/verdict types, and `SonnetOvermindBrain`, which defaults to `new ClaudeCliProvider("sonnet", timeout)` and asks for strict JSON only.
- `src/services/overmind-watcher.ts`: injected the brain, built tiny Tier-3 context from the coordinator tail plus `progress.md`/`callbacks.md` tails, called the brain only on the Tier 2 -> Tier 3 transition, and handled `nudge`, `escalate-blocked`, `false-alarm`, and brain failure.
- `src/index.ts`: wired the running app to use `SonnetOvermindBrain`.
- `tests/overmind-brain.test.ts`: added fake-brain tests for Tier-3 nudge, blocked escalation, false alarm reset, thrown-brain fallback, and `waiting_human`/`awaiting_decision` halt behavior.
- `tests/overmind-nudge.test.ts`: retained the A5 regression that persists the post-nudge pane hash so the ladder can advance to Tier 2/3 without treating Overmind's own nudge as new work.

## Caveats

No decision-answering or north-star answering was implemented; that remains A6b.

Autonomous decisions: none.
