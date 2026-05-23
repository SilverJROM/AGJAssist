Batch-A6a: Sonnet brain plumbing + Tier-3 stuck escalation + BLOCKED push + waiting_human halt

Batch ID: A6a
Requirements: plan/overmind/og-requirements.md (R7, R8-remainder)
Branch: feat/overmind (CONTINUE)
North-star anchors: NS-4 (Sonnet via Claude subscription, NO outside API), NS-8 (brain only on rare ambiguity, tiny context), NS-3 (coordinator-only)

Estimated duration: SHORT (atomic <30min).

Context (read context-handoff.md first):
A5 built the Tier1-2 canned nudge ladder with a `// A6: Tier 3 Sonnet brain here` hook (in applyNudgeLadder, after nudge_count >= MAX_CANNED_NUDGES still stuck). A6a adds the Sonnet "brain" for the RARE case where canned nudges didn't work. Decision interception (awaiting_decision) is A6b — NOT this batch; but build the brain as a reusable interface so A6b can plug in.

Requirements (verbatim):
R7: "When the coordinator pane stays frozen after Tier 1-2: call new ClaudeCliProvider('sonnet').chat(...) with tiny context (last ~40 coordinator pane lines + tails of progress.md/callbacks.md), returning {action: nudge|escalate-question|escalate-blocked|false-alarm, nudge_text?, reason}. NO outside API. Auto-answers go ONLY to the coordinator, never a child."
R8 (remainder): "escalate-* → Telegram push (verdict-led, BLOCKED). Mark waiting_human, stop nudging until JROM acts."

Expected (acceptance criteria):
1. A brain abstraction, e.g. `src/services/overmind-brain.ts` exporting an interface `OvermindBrain { analyzeStuck(input: StuckInput): Promise<BrainVerdict> }` and a concrete `SonnetOvermindBrain` that uses `new ClaudeCliProvider("sonnet", <timeout>)`. StuckInput = { label, coordinatorPaneTail: string (~40 lines), progressTail: string, callbacksTail: string }. BrainVerdict = { action: 'nudge'|'escalate-blocked'|'false-alarm', nudgeText?: string, reason: string }. (escalate-question folds into escalate-blocked for A6a; A6b adds the decision flavor.) The system prompt instructs Sonnet to return STRICT JSON only.
2. Wire into OvermindWatcher: at the Tier-3 hook (canned nudges exhausted AND still stuck), call brain.analyzeStuck ONCE for that stuck-episode (guard: only when tier transitions 2→3, set tier=3; do NOT call Sonnet every tick).
   - action 'nudge' → sendCommand(coordinator_session, nudgeText, true, true) [coordinator ONLY], persist POST-nudge hash (same pattern as A5), keep tier=3.
   - action 'escalate-blocked' → notifyBlocked(verdict-led BLOCKED message per NOTIFICATION_PROTOCOL), set status='waiting_human'. A waiting_human workflow is NOT nudged again until it returns to working.
   - action 'false-alarm' → reset ladder (treat as working: nudge_count=0, tier=0).
   - Brain call wrapped in try/catch: on error → escalate-blocked (surface to JROM) rather than crash/spin. Log the failure.
3. waiting_human halt (R8): ensure the nudge ladder ONLY acts on status==='stuck'. status 'waiting_human' and 'awaiting_decision' must NOT be nudged. (awaiting_decision handling = A6b.)
4. Brain injected into OvermindWatcher via constructor (so unit tests inject a FAKE brain — do NOT call real Sonnet in unit tests). index.ts wires the real SonnetOvermindBrain.
5. `npx tsc` clean.

Likely files:
- src/services/overmind-brain.ts (NEW — interface + SonnetOvermindBrain)
- src/services/overmind-watcher.ts (Tier-3 wiring, waiting_human halt, brain injection)
- src/index.ts (construct + inject SonnetOvermindBrain)
- tests/overmind-brain.test.ts (NEW — with a FAKE brain: tier-3 nudge path, escalate-blocked sets waiting_human + notifies, false-alarm resets, brain-throws → escalate-blocked, and that waiting_human/awaiting_decision are never nudged)

Scope:
- Brain plumbing + Tier-3 stuck escalation + BLOCKED + waiting_human ONLY. NO decision-answering / north-star reading (A6b). NO UI (A7).
- Coordinator-only. Sonnet only (no outside API). Brain fires rarely (Tier-3, once per episode).
- Surgical.

Tests (targeted, FAKE brain — no real Sonnet):
- inject a fake brain returning each action; assert: nudge→sendCommand to coordinator + tier=3; escalate-blocked→status waiting_human + notify called; false-alarm→reset; brain throws→escalate-blocked; waiting_human/awaiting_decision never nudged.
- Run `npx vitest run tests/overmind-brain.test.ts` + keep overmind-nudge/classifier tests green + `npx tsc`.

Plan handshake (MANDATORY): read brief + handoff + overmind-watcher.ts (Tier-3 hook + applyNudgeLadder) + claude-cli-provider.ts + index.ts. Reply STATUS: PROPOSED with: the brain interface + SonnetOvermindBrain prompt approach (strict-JSON), the once-per-episode guard, the escalate-blocked→waiting_human flow, and the fake-brain test approach. WAIT for APPROVED-PLAN.

After APPROVED-PLAN: implement on feat/overmind, commit, gate. Artifacts batch-A6a/changes.md + test-report.md + independent-validation.md + decisions/ if any.

Completion: callback FIRST `[projcore callback] A6a <STATE> <note>`, THEN reply ending STATUS: <verb> -- reason.
