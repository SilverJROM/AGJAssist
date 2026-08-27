# grok46 — agent-window v2 rationale

Build contract for the per-agent chat window. Tokens, header, bubbles, key row, composer, search, ME-nav, font pill, and gear sheet match `src/web/public/{style.css,app.js}` (FriendlyTerminalView / TerminalTab). v2 **adds**; it does not replace those controls.

## Decisions

**1. One new chrome row, not a redesigned header.**
The live header is already full at 390px (back, name, sibling tabs, A−/A+, ME, gear). Reminders / wakeup / summaries need a *persistent* status (next fire, pending 08:00, count), so they live on a thin command-center rail under the header — same chip language as the existing tabs. Gear stays the overflow for settings (including Summary LLM).

**2. Tab strip is the full group, with collapse + a discrete scrubber.**
Prod tabs today are *siblings only* (active name lives on the left). v2 paints **all** agents in the group and marks the current one `.sel`, so the scrubber has a complete ordinal. At 390px the pills do not fit on the name row with A−/A+ / ME / gear, so **expanded tabs sit on a second header row** (collapse + pills + scrubber). Collapse (`‹` / `›`) drops that row and tucks toggle + scrubber into row 1 — name stays fully readable. Drag maps pointer X → agent index (not overflow-scroll), so agents that do not fit are still reachable. Six agents (`hris-4430` … `coord-1104`) so “more than fit” is real at 390px; at 720px all six pills fit. Pointer-down does not re-render (would drop capture); commit is on pointer-up.

**3. Reminders are folder-scoped; per-agent is include/skip only.**
One reminder on `projcore` applies to every agent in it. Cadence (15/30/45/60/90 + custom minutes) and repeat (unlimited **or** stop-after-N) live on the folder. Each agent has an include/skip flag. Active view is a two-segment sheet: **This agent** (how folder reminders apply here, with the skip switch) and **Folder** (cadence, next-fire, remaining, agent counts, edit). No per-agent-only reminder object in v1.

**4. Wakeup is one-time, per-agent, and the rail chip *is* the pending indicator.**
Manual date + time + action textarea. The amber `⏰ 08:00` chip is the pending badge; it clears when the wakeup fires (or is cancelled). “Fire now” is **mock-only** so the clear can be demonstrated without waiting. Action is sent as a command (same path as the composer’s default mode).

**5. Summaries are a dropdown, not another sheet.**
The brief asked for a dropdown on the agent window. `Σ N` opens a scrollable, timestamped list for *this* agent. Footer shows the default LLM and links to config.

**6. Summary LLM is a small named-endpoint surface.**
Name + base URL + model, OpenAI-compatible. Seeded default is labelled **140** (`http://192.168.254.140:8080/v1`, `qwen2.5-32b-instruct`). Reachable from Gear → Summary LLM → Manage, and from the summaries footer. No API-key field in v1 (lokalAI default does not need one; add later if OpenRouter is in play).

**7. Draft-kept is a pip + one line.**
Composer state is a per-agent map. Switching away with unsent text stores it; switching back restores it. Tab pip (warning dot) + `draft kept · <agent>` above the composer. Send clears both.

**8. Theme-adaptive, light-first.**
`.terminal-shell` light tokens are the production defaults; dark is the Telegram/OS-dark override. The mockup **defaults to light** (the brief forbids dark-only) and has an explicit Light/Dark toggle plus 390/720. No Google Fonts — system stack, matching the live app.

## Tradeoffs

| Choice | Cost |
|---|---|
| Action rail instead of stuffing chips in the header | +~32px vertical chrome; header stays usable |
| Expanded tabs on a second header row at 390px | +~30px when expanded; collapsed returns that space. One-row tabs crushed the agent name |
| Tabs include the active agent | Small prod change vs today’s sibling-only strip |
| Top-expanding sheet (existing `terminal-menu-sheet`) for reminder/wakeup/LLM | Matches current settings; not a bottom sheet. Thumb-reach is slightly worse; one sheet component for builders |
| Scrubber is an index slider, not a scrollbar | Does not pan the tab overflow; it *selects*. Tab strip still overflow-scrolls on its own |
| Custom cadence = integer minutes | Not cron, not “weekdays only” |
| Mock “Fire now” | Must not ship; builders wire the real scheduler |

## Flags for the owner / builders

1. **Confirm tab-strip includes the current agent.** If you want to keep prod’s sibling-only tabs, the scrubber still needs a full-group ordinal (handle + flyover would then disagree with the visible pills).
2. **Folder === existing terminal group?** This mock maps `projcore` onto the group that already owns the header tabs. If “folder” is a new object, say so before schema.
3. **Reminder solicits in the transcript:** shown as a system pill (`Reminder · projcore · “give me a status update”`), not as a YOU bubble. Easy to flip.
4. **Skipped agents** still *see* the folder reminder on This-agent (with the switch off) so they can opt back in without opening Folder.
5. **Wakeup timezone** = device local. No TZ picker in v1.
6. **No API key** on the LLM endpoint form. Flag if OpenRouter needs one in v1.
7. **Default solicit** = `give me a status update`. Change in one string.
8. **Two extra agents** (`north-8821`, `coord-1104`) exist only so the scrubber has overflow. Drop them if the real group is four.
9. **data-testid**s to keep: `tabs-collapse`, `tab-scrubber`, `reminder-chip`, `reminder-agent-flag`, `wakeup-chip`, `summaries-toggle`, `summaries-dropdown`, `draft-kept`, plus the existing terminal-* ids.

Existing functions left in place: key row (Enter/Esc/^C/⇧⇥/↑/↓), send-as-command / send-raw-keys / large-input, A−/A+ (12–26px), ME ▲/▼, image attach pill, chat search, gear (text size, reply length, raw chrome) — plus the new Summary LLM row.
