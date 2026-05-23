Batch-A5: Nudge ladder Tier 1-2 (coordinator-ONLY) + DONE/BLOCKED Telegram push

Batch ID: A5
Requirements: plan/overmind/og-requirements.md (R6, R8)
Branch: feat/overmind (CONTINUE)
North-star anchors: NS-3 (talk coordinator-only, NEVER child), NS-8 (deterministic tiers, zero tokens), NS-4 (Sonnet brain is A6 — NOT this batch)

Estimated duration: SHORT (atomic <30min).

Context (read context-handoff.md first):
A4 made the watcher live (reads real panes, classifies, updates the row). A5 acts on `stuck`: send canned nudges to the COORDINATOR only, with a tier/backoff ladder. Plus: push DONE/BLOCKED to Telegram. NO Sonnet/LLM yet (A6 plugs Tier 3 in where you leave the hook).

Requirements (verbatim):
R6: "On stuck: send a canned re-engage message to the coordinator session only via tmuxService.sendCommand(session, '...', true, true) (skipSafetyCheck). Backoff across ticks (nudge_count/tier); busy markers reset the timer. Never send keys to a child codex session."
R8: "escalate-* → Telegram push via existing bot.sendMessage, structured per NOTIFICATION_PROTOCOL (verdict-led, DONE/BLOCKED categories ONLY). Mark waiting_human, stop nudging until JROM acts. Completion → DONE push."

Expected (acceptance criteria):
1. In OvermindWatcher.tick (or a nudge step it calls), when a workflow's classified status is `stuck`:
   - Tier 1 (nudge_count 0 → 1): `tmuxService.sendCommand(coordinator_session, CANNED_NUDGE, true, true)`. Set tier=1, nudge_count=1. CANNED_NUDGE = "Overmind: you appear idle — check your implementer pane / callbacks.md and route the current batch, or report STATUS." (single line, no newlines).
   - Tier 2 (nudge_count 1 → 2): on a LATER tick still stuck → send again, tier=2, nudge_count=2. Backoff: do NOT nudge every tick — only escalate a tier when still stuck on a subsequent tick (use a simple per-tick guard, e.g. only one nudge action per workflow per tick, and only escalate if still stuck since last nudge).
   - Tier 2 exhausted (nudge_count ≥ 2) and STILL stuck → DO NOT keep nudging. Leave a clear TODO/hook `// A6: Tier 3 Sonnet brain here` and for now mark the workflow so it's not re-nudged (e.g. keep tier=2; stop). (A6 will add Tier-3 escalation.)
   - **NEVER call sendCommand on any child_sessions entry.** Coordinator only.
   - When the classifier transitions a workflow back to `working` (busy markers / hash change / mtime advance), RESET nudge_count=0, tier=0 (so a fresh stall starts the ladder over). Ensure this reset happens.
2. Notifications (R8): add a best-effort `notify(text)` path the watcher can call (decoupled — e.g. OvermindWatcher constructor takes an optional `notify?: (text)=>Promise<void>` injected from index.ts wired to the bot's sendMessage to AUTHORIZED_USER_ID). Push ONLY:
   - DONE: when a workflow's status becomes `completed` (transition detection — push once). Verdict-led: e.g. "🎉 DONE · overmind · <label>\n✅ <label> completed."
   - BLOCKED: reserved for escalation (A6 will use it more). For A5, wire the notify plumbing + the DONE push. (A BLOCKED helper can exist, used minimally.)
   - Best-effort: wrap in try/catch, log on failure, NEVER crash the loop (the live bot has chronic polling errors — sendMessage may fail).
   - NO progress/interim pushes. Only DONE/BLOCKED.
3. `npx tsc` clean.

Likely files:
- src/services/overmind-watcher.ts (nudge ladder + notify hook + reset-on-working)
- src/index.ts (inject notify wired to bot.sendMessage / AUTHORIZED_USER_ID) — minimal
- src/bot/telegram-bot.ts ONLY if needed to expose a sendMessage helper
- tests/overmind-nudge.test.ts (NEW)

Scope:
- Nudge ladder + DONE/BLOCKED notify ONLY. NO Sonnet/LLM (A6). NO UI (A7). NO decision-answering (A6/R15).
- Coordinator-only nudges — assert this in tests.
- Surgical.

Tests (targeted, unit — but projcore WILL also live-smoke):
- tests/overmind-nudge.test.ts: with a mocked tmuxService (spy on sendCommand) + mocked classifier outputs:
  - stuck → Tier1 nudge sent to coordinator, nudge_count=1, tier=1.
  - still stuck next tick → Tier2, nudge_count=2.
  - nudge_count≥2 still stuck → NO further sendCommand.
  - child_sessions NEVER receive sendCommand (assert the spy was only called with coordinator_session).
  - transition to working → nudge_count/tier reset to 0.
  - status→completed → notify called once with a DONE message.
  Run `npx vitest run tests/overmind-nudge.test.ts` + `npx tsc`.

Plan handshake (MANDATORY): read brief + handoff + overmind-watcher.ts + tmux-service.ts sendCommand + index.ts (bot/sendMessage + AUTHORIZED_USER_ID). Reply STATUS: PROPOSED with: where the nudge step lives, the per-tick backoff guard, the reset-on-working mechanism, the notify injection, and the Tier-3 hook location. WAIT for APPROVED-PLAN.

After APPROVED-PLAN: implement on feat/overmind, commit, gate. Artifacts batch-A5/changes.md + test-report.md + independent-validation.md + decisions/ if any.

Completion: callback FIRST `[projcore callback] A5 <STATE> <note>`, THEN reply ending STATUS: <verb> -- reason.
