Batch-D2: OVM chat cleanup — render like the Terminal view (no flood, ANSI/chrome stripped, 25/50/100 picker)

Batch ID: D2 (injected, urgent)
Branch: feat/chat-decommission-notes-ios (work DIRECTLY on it; no sub-branch)
Requirements assigned: R10
North-star anchors: NS-8

This is ONE atomic frontend slice (§1.4c).

User report (verbatim, JROM):
"why is the OVM chat full of these notices, are we pushing something to the brain every 10secs? i dont like this it should be a rare instance when the brain is consulted not every 10secs"
"also on the OVM chat, copy the format on how the terminal is working with a 25, 50, 100 ... on the chat to make it more UX friendly"

Root cause (mechanism — already diagnosed, do NOT re-investigate the brain):
- src/web/public/app.js OvmConsole (~511-742): the WS onmessage handler (~622-643) appends a NEW "OVM" bubble per pane snapshot diff (`appendEntry('terminal','OVM', appended)` at ~631). The OVM tmux pane is a Claude-Code TUI that redraws its status bar/spinner many times/sec, so the pane "changes" constantly → a bubble per redraw = flood.
- src/web/public/terminal-chat-state.js `normalizeTerminalOutput` (line 1-3) only does \r\n→\n + trim. It does NOT strip ANSI escape codes (so `[39m` etc. show raw) and does NOT filter Claude-TUI chrome lines.
- This is PURE display relay — NOT brain consultation. The overmind watcher brain is separate (45s tick, rare LLM) and must NOT be touched.

Reference to MIRROR (JROM: "copy how the terminal is working"):
- TerminalChatView in app.js: `lineLimit` state default 25, options [25,50,100,150,200] (~1479), persisted in sessionStorage (~1524-1535), a `<select>` (~1794) + "Showing N lines" pill (~1811), `friendlyMode` toggle (~1281), renders via `formatFriendlyTerminalOutput`.

Expected (acceptance criteria):
1. The OVM chat NO LONGER appends a bubble per pane redraw. OVM's side renders as a SINGLE rolling, tailed view that REPLACES on each snapshot (like the Terminal's friendly snapshot panel). JROM's own typed messages STAY as user bubbles.
2. A line-limit picker with options 25 / 50 / 100 (you may keep 150/200 too) controls how many lines of OVM output show; default 25; persisted (sessionStorage), with a "Showing N lines" indicator — mirroring TerminalChatView.
3. OVM output is CLEAN: ANSI escape sequences stripped (e.g. /\x1b\[[0-9;]*[A-Za-z]/g and related CSI/OSC), and Claude-Code TUI chrome lines filtered out — status bar ("bypass permissions", "shift+tab", "to cycle", "for agents", "mon", "high", "/effort", "focus-events", "to manage", "/ps to view"), composer lines starting with ❯/›/❯, horizontal rules (───/===), spinner/timer lines ("esc to interrupt", "Working (", "Waiting for", "Compacting", "Thinking"), model/cwd footers, and `~/.tmux.conf` noise. (The overmind-watcher's extractBody / isPaneChromeLine logic in src/services/overmind-watcher.ts is the proven reference — port the equivalent line-filter to a frontend helper.)
4. Implement the ANSI-strip + chrome-filter as a reusable helper in terminal-chat-state.js (e.g. `cleanTerminalOutput(text)`), used by the OVM friendly render. (Applying it to the Terminal view too is fine but optional — do not break the Terminal.)
5. Build green (`npx tsc`); no console errors; OVM open/restart/close + send still work.

Likely files:
- src/web/public/app.js (OvmConsole ~511-742; reference TerminalChatView for the picker)
- src/web/public/terminal-chat-state.js (add cleanTerminalOutput; keep existing exports working)
- tests/* if any cover terminal-chat-state (update/add a small unit test for cleanTerminalOutput stripping ANSI + filtering a chrome line)

Scope / DON'T:
- DO NOT touch the overmind watcher, the brain, the WS server push cadence (tmux-stream-manager), or the OVM session manager. This is a CLIENT-SIDE render fix only.
- DO NOT touch Notes, the chat backend, or providers.
- Surgical only.

Required artifacts:
- plan/WK_0519/chat-notes/projcore-run-2026-05-22/batch-D2/changes.md (Codex template: verbatim user report + Root Cause mechanism + per-file WHAT+WHY + Verification: tsc PASS + a note on how you verified clean rendering (e.g. unit test for cleanTerminalOutput, or a sample input→output) + Caveats).
- decisions/ entry if any non-trivial autonomous call, else "Autonomous decisions: none."

Completion protocol:
- `npx tsc` clean. Add/adjust a unit test proving cleanTerminalOutput strips ANSI + drops a chrome line.
- Commit: `[D2] OVM chat: terminal-style rolling view + 25/50/100 picker, strip ANSI/chrome (no flood)`.
- End with STATUS: DONE / BLOCKED / NEEDS CLARIFICATION.
