## Accepted: A1, A2, A3, A4 — all PASS (A4 needed iter1: tmux bare-session fix)
Branch: feat/overmind (no master merge until JROM review).
Implemented:
- A1 schema+CRUD; A2 endpoints (token-guarded register/complete/tasks + JWT GET workflows); A3 watcher classifier (pure); A4 Telegram commands (/overmind,/om_tasks,/om_pause,/om_resume,/om_drop) + watcher started live in index.ts.
- A4 iter1: `tmuxService.ensureValidTarget` now accepts BARE session names (e.g. hris-d-22) in addition to session:window.pane. Verified live: watcher reads real pane content + classifies.
Req#s VERIFIED: R1,R2,R3,R4,R5,R9. IN-PROGRESS: R14 (UI display pending). R15 (decision-detect built; answering=A6). Open: R6,R7,R8,R10,R11,R12,R13,R16.

## Next: Batch-A5 — Nudge ladder Tier 1-2 (coordinator-ONLY) + DONE/BLOCKED Telegram push
Key facts:
- NS-3 HARD RULE: nudges go ONLY to the coordinator_session, NEVER a child session. The watcher already separates coordinator vs child_sessions.
- Nudge mechanism: `tmuxService.sendCommand(coordinator_session, "<msg>", true, true)` — pressEnter=true, skipSafetyCheck=true (canned overmind nudge). sendCommand now accepts bare session names (A4 fix). It does send-keys -l + C-m.
- Tier ladder on status==='stuck': use the existing `nudge_count`/`tier` columns. Tier 1 → first canned nudge (e.g. "Overmind: you appear idle — check your implementer pane / callbacks.md and route the current batch, or report STATUS."); increment nudge_count; record on the row. Tier 2 → repeat (max ~2 canned nudges) with backoff across ticks. Busy markers / hash change reset nudge_count+tier+stuck (handled in classifier path — ensure a working transition clears them). Do NOT escalate to Sonnet yet (that's A6 Tier 3) — but leave a clear hook where Tier 3 will plug in.
- DONE/BLOCKED Telegram push (R8): when a workflow becomes 'completed' (set by /complete endpoint) → push a DONE message; when it hits a real BLOCKED/escalation condition → push BLOCKED. Use the bot's sendMessage. Per NOTIFICATION_PROTOCOL: ONLY DONE/BLOCKED, verdict-led, no progress chatter. The bot instance / chat id: see how telegram-bot.ts sends (AUTHORIZED_USER_ID from .env is the chat id). Thread a notifier into the watcher (a callback or the bot's sendMessage) — keep it decoupled (e.g. OvermindWatcher takes an optional `notify(text)` fn).
- NOTE the live environment: the TG bot has chronic polling EFATAL (network) — sendMessage may also fail intermittently; make the push best-effort (try/catch, log on failure), do not crash the loop.
- LIVE SMOKE REQUIRED (per decision 2026-05-21-...-live-smoke): after impl, projcore will register a throwaway at a real IDLE session, force/await stuck, and confirm exactly ONE nudge per tier lands in the COORDINATOR pane (and NEVER in a child). So make tiers observable (nudge_count/tier on the row).
- Constants: define NUDGE thresholds/max tier as named consts.
