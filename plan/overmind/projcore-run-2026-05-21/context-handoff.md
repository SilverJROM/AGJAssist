## Accepted: A1, A2, A3 — all PASS
Branch: feat/overmind (no master merge until JROM review).
Implemented:
- A1: schema v11 + OvermindService CRUD.
- A2: HTTP endpoints (register/complete/tasks token-guarded, GET workflows JWT) + service threaded in index.ts/server.ts. Live-verified.
- A3: src/services/overmind-watcher.ts — pure `classifyWorkflow(input)` (working|stuck|waiting_human|awaiting_decision) + `OvermindWatcher` class with `tick()` (capturePane coordinator+children → classify → overmindService.update) and `start()/stop()` (POLL_MS=45000). NOT started yet. Consts: STUCK_THRESHOLD_MS=90000.
Req#s: R1,R2,R3,R5 VERIFIED. R14 IN-PROGRESS (endpoint done). R4,R15 IN-PROGRESS (loop+decision built, not live).
Open: R6,R7,R8,R9,R10,R11,R12,R13,R16.

## Next: Batch-A4 — Telegram commands + START the watcher loop
Key facts for A4:
- OvermindWatcher exists (src/services/overmind-watcher.ts) with start()/stop(). A4 instantiates it in index.ts (needs OvermindService + TmuxService — both already constructed in index.ts; check how tmuxService is built there) and calls start() so the 45s loop runs live. This makes R4 observable.
- Telegram: src/bot/telegram-bot.ts `setMyCommands([...])` array; src/bot/assistant-core.ts `handleCommand(input)` switch. Add commands:
  - /overmind → pure DB read: one line per workflow: `<label> <statusIcon> <status> · "<current_task>" · <doneCount>/<totalCount>`. (doneCount = tasks where state=done.)
  - /om_tasks <id> → full tasklist: each task `[x] done / [~] processing / [ ] pending`.
  - /om_pause <id> → setStatus(id,'paused'); /om_resume <id> → setStatus(id,'active'); /om_drop <id> → delete(id).
  - assistant-core needs access to OvermindService — see how it gets other services (constructor/setters). Thread OvermindService in like the chat services (`setChatServices` pattern) or constructor.
- NO nudging, NO LLM, NO UI panel in A4. (Nudge=A5, brain=A6, UI=A7.)
- The watcher's start() must be safe even with zero registered workflows (loop over empty list = no-op). And paused/completed workflows are skipped.
- After A4, projcore will live-smoke: register a throwaway workflow pointing at a REAL tmux session (e.g. ovm-build itself) and confirm the loop classifies it (status flips to working while codex runs) + /overmind shows it.
