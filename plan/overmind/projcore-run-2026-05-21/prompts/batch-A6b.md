Batch-A6b: Decision interception (Sonnet answers from north-star / escalates) + projcore frontload-correction

Batch ID: A6b
Requirements: plan/overmind/og-requirements.md (R15, R16)
Branch: feat/overmind (CONTINUE)
North-star anchors: NS-11 (decision interception + ALWAYS-ESCALATE guardrail), NS-12 (frontload enforcement), NS-3 (coordinator-only), NS-4 (Sonnet, no outside API)

Estimated duration: SHORT (atomic <30min).

Context (read context-handoff.md first):
A3 classifier already detects `awaiting_decision` and captures the menu/question text into pending_decision. A6a built the brain abstraction (src/services/overmind-brain.ts: OvermindBrain + SonnetOvermindBrain). A6b adds decision-answering: when a coordinator raises a decision that SHOULD have been frontloaded, the brain reads that workflow's north-star + trust-defaults and either answers it (safe + covered) or escalates to JROM — and corrects projcore to frontload.

Requirements (verbatim):
R15: "When the classifier flags awaiting_decision, the brain reads the workflow's own run_dir/north-star.md + global ~/.claude/JROM/style/trust-defaults.md and decides: answer-from-northstar (clearly covered AND NOT ALWAYS-ESCALATE class → send answer to COORDINATOR, log, correction) OR escalate-to-jrom (not covered OR ALWAYS-ESCALATE class → Telegram, leave coordinator waiting, do NOT auto-answer). Sonnet via ClaudeCliProvider, tiny context, NO outside API. Auto-answers go ONLY to coordinator."
R16: "Whenever overmind handles an awaiting_decision that should have been frontloaded, record a correction (decision-log + a concise coordinator note) reminding projcore that such decisions belong in §1.4a frontloaded interview / north-star at intake."

Expected (acceptance criteria):
1. Add `answerDecision(input: DecisionInput): Promise<DecisionVerdict>` to OvermindBrain + SonnetOvermindBrain.
   - DecisionInput = { label, pendingDecision: string, northStar: string, trustDefaults: string }.
   - DecisionVerdict = { action: 'answer'|'escalate', answerText?: string, reason: string }.
   - System prompt: answer ONLY if the north-star/trust-defaults clearly cover the decision; else escalate. Strict JSON.
2. **Deterministic ALWAYS-ESCALATE guardrail (defense-in-depth, runs in code BEFORE honoring an 'answer'):** scan pendingDecision (case-insensitive) for: merge to master, merge, deploy, qa, prod, production, delete, drop, force push, force-push, auth, rbac, password, secret, token, money, billing, payment, charge. If ANY hit → FORCE escalate regardless of brain verdict. Only safe, covered decisions auto-answer. (Define the keyword list as a named const.)
3. Wire into OvermindWatcher: when a workflow's classified status === 'awaiting_decision':
   - Read run_dir/north-star.md (best-effort; '' if missing) + ~/.claude/JROM/style/trust-defaults.md (best-effort).
   - Call brain.answerDecision (once per decision episode — guard so it doesn't re-fire every tick; e.g. only when pending_decision newly set / a 'decision_handled' marker not yet set — reuse an existing column, e.g. set tier to a sentinel or clear pending_decision after handling).
   - action 'answer' (and guardrail clear) → sendCommand(coordinator_session, answerText, true, true) [COORDINATOR ONLY] + persist post-nudge hash. THEN R16: sendCommand a brief follow-up note to the coordinator: "Overmind: that decision should have been frontloaded at intake (projcore §1.4a) — please put such decisions in the north-star next time." AND append a correction log entry to plan/.../corrections/ OR a dedicated overmind correction file (decision + verdict + 'should have been frontloaded').
   - action 'escalate' (or guardrail tripped) → notifyBlocked/notify (verdict-led ❓/🛑) with the verbatim pendingDecision + reason; leave coordinator waiting; do NOT auto-answer; mark handled so it doesn't re-fire.
   - Brain error → escalate (safe default).
4. waiting_human/awaiting_decision still never get the canned nudge ladder (A6a). awaiting_decision is handled ONLY by this decision path.
5. `npx tsc` clean.

Likely files:
- src/services/overmind-brain.ts (answerDecision + ALWAYS_ESCALATE_KEYWORDS const + guardrail helper)
- src/services/overmind-watcher.ts (awaiting_decision handling, north-star/trust-defaults read, once-per-episode guard, R16 correction)
- tests/overmind-decision.test.ts (NEW)

Scope:
- Decision interception + correction ONLY. Reuse A6a brain plumbing. NO UI (A7). Coordinator-only. Sonnet only.
- Surgical.

Tests (targeted, FAKE brain — no real Sonnet):
- north-star-covered SAFE decision + brain says answer → answerText sent to COORDINATOR + R16 correction note sent + correction logged.
- ALWAYS-ESCALATE keyword present (e.g. pendingDecision contains "merge to master") + brain says answer → FORCED escalate (no auto-answer, notify called). Assert the deterministic guardrail overrides the brain.
- north-star does NOT cover + brain says escalate → escalate to JROM, coordinator left waiting.
- handled once (not re-fired on the next tick).
- never sends to a child session.
- Run `npx vitest run tests/overmind-decision.test.ts` + keep prior overmind tests green + `npx tsc`.

Plan handshake (MANDATORY): read brief + handoff + overmind-brain.ts + overmind-watcher.ts (awaiting_decision path) + classifier. Reply STATUS: PROPOSED with: answerDecision shape + system prompt, the ALWAYS_ESCALATE keyword guardrail, the once-per-episode handled-guard mechanism, the R16 correction mechanism, and the fake-brain test plan. WAIT for APPROVED-PLAN.

After APPROVED-PLAN: implement on feat/overmind, commit, gate. Artifacts batch-A6b/changes.md + test-report.md + independent-validation.md + decisions/ if any.

Completion: callback FIRST `[projcore callback] A6b <STATE> <note>`, THEN reply ending STATUS: <verb> -- reason.
