## Accepted: Batch-A2 — STATUS: PASS (prev: A1 PASS)
Branch: feat/overmind (all batches commit here; NO master merge until JROM reviews).
Implemented so far:
- A1: schema v11 `overmind_workflows` + `OvermindService` CRUD (register/upsert, list, get, getBySession, update, setStatus, setTasks, delete). Types OvermindWorkflow, OvermindTask{id,label,state}, OvermindWorkflowStatus (active|working|waiting_human|awaiting_decision|stuck|paused|completed|failed).
- A2: HTTP — POST /api/overmind/register, /complete, /tasks (localhost + OVERMIND_TOKEN guard via config.overmind.token), GET /api/overmind/workflows (JWT auth). OvermindService instantiated in index.ts (~line 35 area / services block) and threaded into createApiServer → registerOvermindRoutes(app, config, authService, overmindService). Route module: src/api/routes/overmind-routes.ts. Verified live (201/401/200/404).
Req#s closed: R1, R2, R3 VERIFIED. R14 IN-PROGRESS (endpoint done; display pending A4/A7).
Open: R4,R5,R6,R7,R8,R9,R10,R11,R12,R13,R15,R16.

## Next: Batch-A3 — watcher loop + classifier (detection only, NO nudge/LLM)
Key facts for A3:
- tmuxService exists: `capturePane(target, lines)` (src/tmux/tmux-service.ts) — use to read coordinator + child panes. Do NOT use sendCommand in A3 (no nudging until A5).
- Busy markers (port from ~/.claude/agents/watchers/projcore-watcher.sh): "esc to interrupt", "Working (", "Waiting for", "Compacting", "Thinking".
- Decision-prompt markers (from a real coordinator AskUserQuestion menu): numbered options ("1.", "2." ...), "Enter to select", "Tab/Arrow keys to navigate", "Type something". → status `awaiting_decision`, capture the prompt text into pending_decision.
- run_dir files to stat for mtime advance: callbacks.md, progress.md, queue.md.
- Authoritative `completed` is set by projcore's POST /complete (A2) — the deterministic classifier does NOT need to infer completed; it classifies the action-relevant live states: working / stuck / waiting_human / awaiting_decision. (Scoping decision — keeps A3 atomic, avoids fragile queue-drained heuristics.)
- The classifier should be a PURE function (testable without tmux): classify(inputs, prevRow) → {status, current_task?, pending_decision?, last_pane_hash, stuck_since?, last_activity_at}. tick() wires capturePane + mtimes → classify → overmindService.update. start()/stop() manage the interval but A3 does NOT start it (A4 starts it in index.ts).
- NO LLM, NO Telegram, NO sendCommand in A3.
