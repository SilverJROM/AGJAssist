# Validation — W1 (WU1) — PASS
- tsc clean; brain+decision+nudge+notifications tests 17+ green. Schema v14 (last_notified_transition) live-migrated clean.
- priorDecisions wired into analyzeStuck + answerDecision; collectPriorDecisions reads run_dir/decisions + ~/.claude/JROM/decisions (relevance-filtered, capped). New overmind-notifications.ts protocol formatter + tests.
- Once-per-transition gating persisted (last_notified_transition). DONE/BLOCKED/needs-input only; resolve→no notify.
- LIVE brain: merge-to-master decision correctly ESCALATED citing prior decision 2026-05-21 (decisions-context in use); covered non-escalate decisions answer (A6b). Resolve-first/escalate-last validated.
- WU1 VERIFIED. Residual: live TG DELIVERY depends on the chronic polling/network env issue.
