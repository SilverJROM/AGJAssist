## Accepted: A1-A5 all PASS (A4 + A5 each needed iter1, both live-verified)
Branch: feat/overmind (no master merge until JROM review).
Implemented:
- A1 schema+CRUD; A2 endpoints; A3 classifier; A4 Telegram cmds + live watcher (tmux bare-session fix); A5 nudge ladder Tier1-2 coordinator-only (post-nudge-hash fix, live: Tier1→2→stop, child clean) + DONE notify from /complete route.
Req#s VERIFIED: R1,R2,R3,R4,R5,R6,R9. IN-PROGRESS: R8 (DONE wired; BLOCKED+live=A6a), R14 (UI=A7), R15 (detect built; answer=A6b). Open: R7,R10,R11,R12,R13,R16.

A6 SPLIT into A6a + A6b (both SHORT). Do A6a first.

## Next: Batch-A6a — Sonnet brain plumbing + Tier-3 stuck escalation + BLOCKED push + waiting_human
Key facts:
- Brain model: `new ClaudeCliProvider("sonnet", <timeout>)` then `.chat(messages, ...)`. NS-4: NO outside API (no OpenRouter/Ollama for the brain). This is the user's Claude subscription.
- Tier-3 hook is at the `// A6: Tier 3 Sonnet brain here` comment in overmind-watcher.ts applyNudgeLadder (after nudge_count >= MAX_CANNED_NUDGES and still stuck).
- A6a behavior: when canned Tier1-2 exhausted AND still stuck, call the Sonnet brain ONCE with TINY context: last ~40 lines of the coordinator pane + tail of run_dir/progress.md + run_dir/callbacks.md. Brain returns a small JSON: {action: 'nudge'|'escalate-blocked'|'false-alarm', nudge_text?, reason}. 
  - nudge → sendCommand(coordinator, nudge_text, true, true) (coordinator only!), persist post-nudge hash (same fix as A5), mark tier=3.
  - escalate-blocked → notify BLOCKED (verdict-led per NOTIFICATION_PROTOCOL), set status='waiting_human', STOP nudging until JROM acts (paused-like: a waiting_human / blocked workflow is not re-nudged).
  - false-alarm → treat as working (reset ladder).
- waiting_human halt (R8): a workflow in waiting_human OR awaiting_decision is NOT nudged (the classifier already yields these; ensure the nudge ladder skips them — only 'stuck' nudges).
- Token efficiency (NS-8): brain fires ONLY at Tier-3 (rare) with tiny context. NOT every tick. Guard: only call once per stuck-episode (e.g. when tier transitions 2→3); don't re-call Sonnet every tick.
- Best-effort: brain call wrapped in try/catch; on failure, fall back to escalate-blocked (surface to JROM) rather than crash/spin.
- Decoupling: inject the brain as an interface (e.g. `OvermindBrain { analyzeStuck(input): Promise<{action,...}> }`) so A6b can reuse it for decisions and so it's mockable in tests (do NOT call real Sonnet in unit tests).
- LIVE SMOKE (per live-smoke lesson): projcore will verify Tier3 fires after Tier1-2 on a stuck throwaway — but to avoid real Sonnet cost/latency in the gate, the brain interface lets us inject a fake in a focused integration check; the REAL Sonnet call will be sanity-checked once, minimally.

## Then: Batch-A6b — decision interception (R15, R16)
- On status==='awaiting_decision' (classifier already detects + captures pending_decision): call the brain's `answerDecision(input)` where input includes pending_decision + the workflow's run_dir/north-star.md content + ~/.claude/JROM/style/trust-defaults.md.
- Brain returns {action:'answer'|'escalate', answer_text?, reason, should_have_been_frontloaded:bool}.
  - answer → ONLY if north-star clearly covers AND not ALWAYS-ESCALATE class (irreversible/merge-to-master/QA-PROD-deploy/auth/money/hardened/scope-creep). sendCommand the answer to the COORDINATOR. 
  - escalate → notify JROM (verdict-led) with the verbatim decision; leave coordinator waiting.
  - R16: log a correction + send a brief coordinator note that this should have been frontloaded (§1.4a).
- Guardrail (NS-11) is the brain's system prompt + a deterministic ALWAYS-ESCALATE keyword check BEFORE auto-answering (defense in depth: even if the brain says 'answer', a deterministic check blocks merge/deploy/auth/money words → force escalate).
