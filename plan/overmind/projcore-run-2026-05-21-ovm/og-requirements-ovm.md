# Overmind OVM Operator Chat — Requirements (locked 2026-05-21)

Add an interactive "OVM" operator console to the AGJAssist workflow dashboard: a chat with a persistent Sonnet ("overmind brain") that knows the whole app + can inspect/adjust workflows. AGJAssist, branch feat/overmind. Reuse existing infra (tmux lifecycle, WS pane streaming + input, ConversationService, terminal-chat-state.js).

**OU1 — Operator-control HTTP endpoints (localhost + OVERMIND_TOKEN).** So the OVM brain can ADJUST workflows via curl (it has bash). Add token-guarded localhost endpoints mirroring the Telegram controls: POST /api/overmind/workflows/:id/pause, /resume, DELETE (drop) — and confirm tasks/rename/register already exist. (rename = JWT W3; these new control ones use the same OVERMIND_TOKEN localhost guard as register/tasks.) Read = existing GET /api/overmind/workflows.
*Acceptance:* curl with token can pause/resume/drop a workflow; bad/no token → 401; reflected in the dashboard.

**OU2 — OVM session manager (open-reuse / restart / close) + operator primer.**
- Operator primer doc (in repo, e.g. plan/overmind/OVM_OPERATOR_PRIMER.md): full AGJAssist+overmind feature set, the known quirks/lessons, schema, workflow lifecycle, and the EXACT inspect (GET workflows) + adjust (the OU1 endpoints + rename/tasks) commands incl the token, and the rule: destructive/irreversible actions (drop, end, anything touching real coordinator sessions) → PROPOSE and wait for JROM's confirmation in chat; manage only via overmind's own controls (do NOT send keystrokes into real coordinator tmux sessions).
- Endpoints (JWT auth, browser-driven): POST /api/overmind/ovm/open (create tmux session "OVM" with cwd=AGJAssist dir, launch `claude --dangerously-skip-permissions --model sonnet`, then send a kickoff message: "Read <primer path> and operate as the Overmind operator per it. OVERMIND_TOKEN=<token>. Confirm when ready." — REUSE if session already exists, do not relaunch), POST /api/overmind/ovm/restart (terminate + open fresh), POST /api/overmind/ovm/close (terminate), GET /api/overmind/ovm/status (open? since when?).
- Use tmuxService.sessionExists("OVM") for reuse detection; createSession/terminateSession; the 3-call send for the launch + kickoff.
*Acceptance:* open creates+launches+primes OVM (or reconnects if already open); restart relaunches fresh; close kills it; status reflects reality.

**OU3 — OVM tab UI.** A 4th tab "OVM" beside Active/Completed/History. Renders a live chat/terminal view of the OVM session (reuse the tmux WS stream /ws/tmux/OVM... + input box → send-keys), with Open / Restart / Close buttons + a status dot. Input sends to the OVM pane; output streams live. Chat-styled (use terminal-chat-state friendly formatting).
*Acceptance:* OVM tab shows the live session; typing sends to OVM and the reply streams back; buttons open(reuse)/restart/close work.

**Constraints:** reuse existing tmux/WS/conversation infra; localhost+token for control endpoints; the claude session is --dangerously-skip-permissions (full bash) so scope is enforced by the PRIMER (instruction), not a sandbox — primer must be explicit about overmind-controls-only + confirm-destructive. Preact/HTM no-build; deploy npm run build; commit per batch; live-smoke.

## Injected 2026-05-21

**OU4 — Telegram OVM chat (/ovm_start, /ovm_end) + menu.** Converse with the OVM brain directly in the Telegram chat.
- `/ovm_start` — enter OVM chat mode for this TG user: reuse-or-open the OVM session (same manager as OU2), then route the user's subsequent PLAIN messages to the OVM session and relay the brain's replies back via bot.sendMessage. Confirm entry ("OVM chat on — talk to me; /ovm_end to stop").
- `/ovm_end` — exit OVM chat mode (plain messages go back to normal handling). The OVM session PERSISTS (reuse later); it is NOT killed by /ovm_end (close via the tab or a future explicit kill). 
- Per-user "ovm chat mode" flag in assistant-core so plain messages route to OVM while active (and other commands still work).
- Update telegram-bot.ts setMyCommands to include /ovm_start + /ovm_end (and ensure existing /overmind /om_tasks /om_pause /om_resume /om_drop are listed).
*Acceptance:* /ovm_start → messages reach OVM + replies come back in TG; /ovm_end → normal mode; commands appear in the bot menu.
