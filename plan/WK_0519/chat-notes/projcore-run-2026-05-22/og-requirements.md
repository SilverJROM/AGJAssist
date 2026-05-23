# og-requirements.md — Chat decommission + Notes iPhone-parity redesign

Project: AGJAssist · Run: 2026-05-22 · Coordinator: projcore (Opus) · Implementer + consultation: Sonnet (Pattern 1, JROM override of codex-only)

## Part A — Decommission all non-OVM chat (keep ONLY OVM)

- **R1** — Telegram has NO non-OVM conversational chat. The plain-message LLM fallback and the `/op`, `/om`, `/llm`, `/ommodel`, `/claude`, `/sonnet`, `/opus`, `/haiku`, `/codex` chat prefixes are removed. Only `/ovm_start` / `/ovm_end` provide conversational chat. All overmind/tmux/task/utility slash commands remain. `setMyCommands` menu reflects the removal.
- **R2** — The web `💬 Chat` bottom-nav tab (`/conversations`) opens the **OVM console** (the Sonnet operator chat). The old multi-provider Conversations chat UI (provider/model pickers, conversation list) is gone. OVM is the only chat surface.
- **R3** — No chat/conversation HTTP endpoints remain: `/api/chat/*`, `/api/conversations/*`, `/api/local-llm/*`, `/api/chat-settings/*` are removed and unregistered. The app boots cleanly without them. (OVM endpoints `/api/overmind/ovm/*` stay.)
- **R4** — The Ollama, OpenRouter, and Local-relay LLM providers + ToolAgent/tool-registry (if orphaned) + conversation-service + chat-settings-service (if orphaned) + `config.llm` keys + their `index.ts`/`server.ts` wiring are removed. Build is green and the **full vitest suite passes** (the chronically-failing Ollama `conversation-memory` test is removed). DB tables (`conversations`, `chat_settings`) are left **dormant** (no destructive DROP).

## Part B — Notes redesigned to iPhone Notes parity (80–90% look/feel/functionality), PURE parity

- **R5** — Notes are organized in **folders** (iPhone-style): create / rename / delete folders; a folder list screen; notes belong to a folder; move a note between folders.
- **R6** — The notes **list** mimics iPhone Notes: each row shows a preview (first-line title + snippet + relative date), instant **search**, **swipe-to-delete**, a **new-note** affordance, and **auto-save** on type. iOS look & feel.
- **R7** — The note **editor** is **rich text**: bold / italic / headings, bulleted lists, and tappable **checklists**. The **first line is the title** (no separate title field). contenteditable-based.
- **R8** — **Pinning**: a note can be pinned to the top of its list (pinned section like iPhone).
- **R9** — Pure iPhone parity: the AGJAssist-specific note features are **removed** — `status` (open/promoted/archived), `tags`, project linkage (`project_id`, the ProjectDetail Notes tab, `/api/projects/:id/notes`), and promote-to-plan / add-to-plan.

## Injected issues

- **R10** (injected 2026-05-22, re-scoped per NS-9) — The OVM web chat is a **true request/response chat room** (NOT a terminal view): JROM sends a message → "OVM is thinking…" → OVM's **reply only** appears as a chat bubble, like chatting with a person; OVM's background terminal activity (chrome, spinner, ANSI) is hidden. Reuse the Telegram `relayOvmMessage` send-and-wait model, spinner-aware turn completion (`hasActiveTurn`) so long background work isn't cut off, and `cleanTerminalOutput` to extract only the reply. No live terminal stream, no line picker. Keep open/restart/close controls. (Groundwork from D2: `cleanTerminalOutput` + flood removal. The overmind brain is NOT involved — 45s tick, rare LLM.)

## Non-goals / constraints
- No destructive DB drops (tables dormant). Migrations additive/guarded.
- Surgical: do not touch overmind/OVM internals beyond promoting OVM to the Chat tab.
- Each batch: build green + targeted tests; full suite at Phase 2.
- Deploy: build + `pm2 restart agjassist` after each validated batch (JROM authorized).
