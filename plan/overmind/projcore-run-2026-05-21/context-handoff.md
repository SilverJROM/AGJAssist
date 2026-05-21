## Accepted: A1-A5, A6a all PASS (A4, A5 needed iter1)
Branch: feat/overmind (no master merge until JROM review).
Implemented: A1 schema+CRUD; A2 endpoints; A3 classifier; A4 Telegram cmds + live watcher; A5 nudge ladder Tier1-2 coordinator-only; A6a Sonnet brain (src/services/overmind-brain.ts: OvermindBrain interface + SonnetOvermindBrain, ClaudeCliProvider sonnet) + Tier-3 stuck-escalation + BLOCKED→waiting_human halt. Brain live-verified (real Sonnet verdict parsed).
Req#s VERIFIED: R1,R2,R3,R4,R5,R6,R7,R8*,R9. IN-PROGRESS: R14 (UI=A7), R15 (detect built; answer=A6b). Open: R10,R11,R12,R13,R16.

## Next: Batch-A6b — decision interception (R15) + projcore frontload-correction (R16)
Reuse the A6a brain abstraction (src/services/overmind-brain.ts). Add a second brain method, e.g. `answerDecision(input: DecisionInput): Promise<DecisionVerdict>`.
Behavior when classifier status === 'awaiting_decision' (pending_decision already captured by A3):
- DecisionInput = { label, pendingDecision (the captured menu/question text), northStar (contents of run_dir/north-star.md), trustDefaults (contents of ~/.claude/JROM/style/trust-defaults.md) }.
- DecisionVerdict = { action: 'answer'|'escalate', answerText?: string, reason: string }.
- The brain's system prompt: answer ONLY if the north-star/trust-defaults clearly cover the decision; otherwise escalate.
- **Deterministic guardrail BEFORE auto-answering (NS-11, defense in depth):** even if the brain says 'answer', run a deterministic ALWAYS-ESCALATE keyword check on pendingDecision (merge to master|merge|deploy|qa|prod|production|delete|drop|force push|auth|rbac|password|secret|money|billing|payment). If any hit → force ESCALATE, do NOT auto-answer. Only truly safe, north-star-covered decisions get auto-answered.
  - action 'answer' → sendCommand(coordinator_session, answerText, true, true) [COORDINATOR ONLY], persist post-nudge hash (same A5 pattern). Then R16: also send a brief coordinator note like "Overmind: this decision should have been frontloaded at intake (projcore §1.4a) — please surface such decisions in the north-star next time." AND log a correction entry (a decisions/ file or a dedicated overmind correction log).
  - action 'escalate' → notify JROM (verdict-led, ❓/🛑) with the verbatim pendingDecision + the brain's reason; leave the coordinator waiting (do NOT auto-answer). Set/keep status so it isn't nudged.
- Guard: answer/escalate a given awaiting_decision episode ONCE (don't re-answer every tick). Track via a flag (e.g. reuse pending_decision: once answered/escalated, clear or mark it).
- Token efficiency: brain fires only on awaiting_decision (rare), tiny context (decision text + north-star excerpt + trust-defaults). NO outside API. Coordinator-only sends.
- Tests: FAKE brain — assert: north-star-covered safe decision → answer sent to coordinator + correction note + logged; ALWAYS-ESCALATE keyword (e.g. "merge to master") → forced escalate even if brain says answer; uncovered → escalate to JROM; answered once (not per tick); never sends to child.
- LIVE: projcore will do a minimal live check (a throwaway awaiting_decision pane) — keep the deterministic guardrail testable without real Sonnet.
