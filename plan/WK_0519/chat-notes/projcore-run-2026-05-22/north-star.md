# north-star.md — JROM frontloaded answers (append-only)

Run: 2026-05-22 · Locked at intake.

## NS-1 — Chat decommission scope (2026-05-22)
**Q:** How much chat to remove?
**JROM:** "All non-OVM chat." Remove Ollama + OpenRouter + Local-LLM relay + the Claude/Codex CLI chat prefixes + the Conversations tab + `/api/chat/*` + `/api/conversations/*` + conversation-service + chat-settings. Only OVM chat remains.

## NS-2 — Web Chat tab fate (2026-05-22, projcore default, unobjected)
**Default applied:** the `💬 Chat` tab (`/conversations`) becomes the OVM console (OVM promoted to the top-level Chat surface). Telegram keeps only `/ovm_start`/`/ovm_end` for chat. `conversations`/`chat_settings` tables left dormant (no DROP). JROM did not object.

## NS-3 — Notes plan/project integration (2026-05-22)
**Q:** Keep promote-to-plan + project linkage, or pure iPhone?
**JROM:** "Pure iPhone parity." Drop status/tags/project-link/promote-to-plan/add-to-plan and the ProjectDetail Notes tab.

## NS-4 — Notes feature set (2026-05-22)
**Q:** Which iPhone features in the 80–90%?
**JROM (all four):** Folders · Rich text + checklists · Pinning · List polish (search, swipe-delete, auto-save, previews). First line = title.

## NS-5 — Branch + deploy (2026-05-22)
**Q:** Working branch + deploy handling?
**JROM:** "Commit, new branch, I deploy each batch." → committed session work (`88c363c` on `feat/overmind`), branched `feat/chat-decommission-notes-ios`; after each validated batch run `npx tsc` + copy static + `pm2 restart agjassist` (the live app on this machine).

## NS-6 — Implementer + consultation model (2026-05-22)
**JROM:** "Give the work to sonnet as the implementer and not codex and your consultation partner as well." → Pattern 1 (in-process Agent dispatch), `/lead` on **Sonnet**; planning consultation on Sonnet. (Explicit override of projcore's codex-in-tmux default.)

## NS-8 — OVM chat rendering (injected 2026-05-22)
**Q (JROM, two messages):** "why is the OVM chat full of these notices, are we pushing something to the brain every 10secs? ... it should be a rare instance when the brain is consulted not every 10secs" + "on the OVM chat, copy the format on how the terminal is working with a 25, 50, 100 ... on the chat to make it more UX friendly."
**Diagnosis:** NOT brain traffic. The OVM pane WS relay (100ms snapshot-on-change) + the console appending each diff as an "OVM" bubble + `normalizeTerminalOutput` not stripping ANSI/chrome → flood of TUI status-bar redraws with raw ANSI.
**Decision:** Rework OVM chat to mirror the Terminal view (TerminalChatView, app.js ~1281/1479/1794): a single rolling tailed output with a **25/50/100 line picker** (replace, not append-per-diff), + **ANSI strip + Claude-TUI chrome filter** so only clean conversational text shows. Keep JROM's typed messages as user bubbles. The brain (overmind watcher) is untouched — it already runs 45s + rare-LLM. → batch D2 (R10), ahead of the OVM→Chat-tab promotion.

## NS-9 — OVM chat is a TRUE CHAT, not a terminal (clarified 2026-05-22)
**JROM:** "when i open the OVM chat it should be like a normal chat room where i send a message and OVM replies back like a person chatting with me and he does what he does on the background and he only sends me the replies to my queries. not a terminal view that we have right now."
**Decision (supersedes the NS-8 terminal-style render):** OVM web chat = request/response chat. Reuse the Telegram `relayOvmMessage` model (assistant-core.ts:403): send the user's message to the OVM tmux session, wait for OVM's turn to finish (spinner-aware via `hasActiveTurn`, then stabilize), extract + `cleanTerminalOutput` ONLY the assistant's reply, show it as a chat bubble. NO terminal view, NO live pane stream, NO line picker, NO chrome. UI: user bubble + "OVM is thinking…" + reply bubble. Must handle long background work (don't hard-cut at 12s — poll until the turn completes). D2's cleanTerminalOutput + flood-removal kept as groundwork; D2's terminal rolling-view UI is replaced by the chat model. Keep open/restart/close session controls.

## NS-7 — Overmind notice (2026-05-22)
**JROM:** "give notice to ovm as well." → register this run with overmind (coordinator_session = `AGJ-51`, child_sessions = [] since Pattern 1 has no codex). Visible on the dashboard with tasklist. If overmind interrupts the interactive session, JROM can `/om_pause`.
