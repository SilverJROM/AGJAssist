Batch-W1: Brain-gated Telegram notifications — resolve-first, escalate-last

Batch ID: W1
Requirements: og-requirements-r3.md (WU1), north-star-r3.md (R3-NS-1, R3-NS-2, R3-NS-5)
Branch: feat/overmind (CONTINUE)
READ FIRST: ~/.claude/agents/NOTIFICATION_PROTOCOL.md (the verdict-led message format you must match).

Estimated: SHORT* — split W1a (brain reads decisions + raise resolution bar) / W1b (notify gating + transitions + format) if your PROPOSED is >30min.

Context:
Overmind already has: a Sonnet brain (src/services/overmind-brain.ts — analyzeStuck for stuck, answerDecision for awaiting_decision, both read north-star/trust-defaults), a watcher (overmind-watcher.ts) that escalates via notify, and a notify path (DONE from the /complete route; BLOCKED helper). WU1 raises the bar: NO escalation to JROM until the brain has tried to resolve from north-star + JROM's PREVIOUS DECISIONS, and ONLY genuinely-unresolvable issues notify.

Requirement (verbatim, WU1):
"Overmind TG-messages JROM ONLY on: completed→🎉DONE; blocked/stuck/waiting_human/awaiting_decision → brain MUST attempt resolution FIRST (read run_dir/north-star.md + ~/.claude/JROM/style/trust-defaults.md + JROM's previous decisions: run_dir/decisions/ + ~/.claude/JROM/decisions/, RELEVANCE-FILTERED by topic — grep/select, never dump all). If resolvable → resolve autonomously (answer/nudge COORDINATOR only), do NOT notify. Only TRULY unresolvable → notify (🛑 BLOCKED / 🚨 needs-input) citing what was checked + why unresolvable. Escalating a resolvable one = OVERMIND FAILURE. Once per transition. Verdict-led NOTIFICATION_PROTOCOL format. Best-effort. No other messages."

Expected (acceptance):
1. Extend the brain (overmind-brain.ts) so analyzeStuck AND answerDecision also receive + use JROM's PREVIOUS DECISIONS as context, in addition to north-star + trust-defaults. The watcher gathers them RELEVANCE-FILTERED: grep run_dir/decisions/*.md AND ~/.claude/JROM/decisions/*.md for terms from the blocker/decision text (or recent N), include only the top matches (cap total chars — token-light per R3-NS-5). Pass as a `priorDecisions` string in the brain input.
2. Resolution bar: the brain returns resolve (nudge/answer the coordinator) vs escalate. STRONG bias to resolve when north-star/decisions cover it. escalate ONLY when genuinely unresolvable. (System prompt must state: escalating a resolvable issue is a failure; resolve autonomously by default.)
3. Notify gating (the ONLY things that TG-fire), once per transition (track last-notified state to avoid repeats):
   - status → completed: 🎉 DONE.
   - brain verdict escalate-blocked (stuck unresolvable): 🛑 BLOCKED.
   - brain verdict escalate (decision/needs-input unresolvable): 🚨 needs-your-input.
   - brain verdict resolve: NO notification (autonomous coordinator action only).
   - Nothing else (no progress/working/etc).
4. Message format: match ~/.claude/agents/NOTIFICATION_PROTOCOL.md — header line (🎉/🛑/🚨 · workflow · overmind) → verdict line (✅/⛔/❓) → high-value labelled lines (the issue + what the brain checked + why unresolvable) → action line. Best-effort send (try/catch, log, never crash the loop).
5. npx tsc clean.

Likely files:
- src/services/overmind-brain.ts (priorDecisions in inputs + system-prompt bar)
- src/services/overmind-watcher.ts (gather relevance-filtered decisions; once-per-transition notify gating; route resolve vs escalate)
- src/api/routes/overmind-routes.ts (/complete DONE already there — confirm format)
- a notify-format helper (pure, node-testable: builds the verdict-led message strings)
- tests: brain receives priorDecisions; gating fires once per transition for completed/escalate-blocked/escalate, and NOT on resolve; format helper output

Scope:
- Notification gating + brain decisions-context ONLY. Don't touch the UI table/rename/history (W2-W4). Coordinator-only + Sonnet-only unchanged. Token-light decisions (relevance-filter, cap).
- Surgical.

Tests (targeted, FAKE brain — no real Sonnet):
- brain input includes priorDecisions (assert the watcher passes relevance-filtered decisions).
- fake brain returns resolve → NO notify, coordinator action taken.
- fake brain returns escalate-blocked → ONE BLOCKED notify (and not repeated next tick — once-per-transition).
- status→completed → ONE DONE notify.
- format helper produces verdict-led strings per protocol.
Run targeted vitest + tsc + npm run build.

Plan handshake (MANDATORY): read brief + NOTIFICATION_PROTOCOL.md + og/north-star-r3 + overmind-brain.ts + overmind-watcher.ts + overmind-routes.ts. Reply STATUS: PROPOSED with: how priorDecisions are gathered+capped (relevance filter), the brain system-prompt bar change, the once-per-transition tracking, the 3 notify triggers + format helper, and tests. Recommend split if needed. WAIT for APPROVED-PLAN.

After APPROVED-PLAN: implement, commit, gate (tests + tsc + npm run build). Artifacts batch-W1*/changes.md + test-report.md + independent-validation.md + decisions/ if any.

Completion: callback FIRST to plan/overmind/projcore-run-2026-05-21-r3/callbacks.md `[projcore callback] W1 <STATE> <note>`, THEN STATUS: <verb> -- reason.
