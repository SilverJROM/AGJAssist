# Batch D2 — OVM chat: terminal-style rolling view + 25/50/100 picker, strip ANSI/chrome

## User report (verbatim)

> "why is the OVM chat full of these notices, are we pushing something to the brain every 10secs?
> i dont like this it should be a rare instance when the brain is consulted not every 10secs"
> "also on the OVM chat, copy the format on how the terminal is working with a 25, 50, 100 ...
> on the chat to make it more UX friendly"

## Root cause (mechanism)

`OvmConsole` in `app.js` called `appendEntry('terminal','OVM', appended)` inside the WS `onmessage`
handler for every `snapshot`/`output` message (fired every ~10s by tmux-stream-manager).
The OVM pane is a Claude-Code TUI that redraws its status bar/spinner constantly, so every
pane-change produced a new chat bubble. This is a pure display relay issue — the overmind brain
(separate 45s tick) was NOT consulted each time.

`normalizeTerminalOutput` only did `\r\n→\n` + trim; it did NOT strip ANSI codes (showing raw
`[39m` etc.) and did NOT filter Claude-Code TUI chrome lines (status bar, spinner, ❯ composer,
horizontal rules, model/cwd footers).

## Files changed

### `src/web/public/terminal-chat-state.js`

**WHAT:** Added exported `cleanTerminalOutput(text)` helper.

**WHY:** Centralises ANSI stripping and TUI chrome filtering so OvmConsole (and any future
consumer) gets clean text without duplicating logic.

Implementation:
- Strips CSI sequences (`\x1b[…final]`), OSC sequences (`\x1b]…ST`), remaining lone ESC + char,
  and non-printable control chars (except newline/tab).
- Filters lines matching Claude-Code TUI chrome patterns ported from
  `overmind-watcher.ts::isPaneChromeLine`: ❯/› composer prompts, `─`/`=` horizontal rules,
  spinner glyphs, status-bar keywords (`bypass permissions`, `shift+tab`, `to cycle`, `for agents`,
  `focus-events`, `to manage`, `/ps to view`, `ctrl+t`, `/model`, `/stop`), spinner/timer lines
  (`esc to interrupt`, `Working (`, `Waiting for`, `Compacting`, `Thinking`), model footer
  (`sonnet`/`opus`/`haiku`/`gpt-5`), cwd footer (`·~/…`), `~/.tmux.conf` noise.

### `src/web/public/app.js`

**WHAT:** Refactored `OvmConsole` — rolling single snapshot view + 25/50/100 line-limit picker.

**WHY:** Eliminates the bubble-per-diff flood. OVM output is now a single card that REPLACES on
each snapshot (mirroring `FriendlyTerminalView`). User's own typed messages remain as user bubbles.

Changes:
- Added `cleanTerminalOutput` to the `terminal-chat-state.js` import line.
- Added `lineLimit` state (default 25, initialised from `sessionStorage['agj_ovm_line_limit']`,
  validated against `[25,50,100,150,200]`).
- Added `snapshotUpdatedAt` state to track last snapshot time for display.
- Added `useEffect` to persist `lineLimit` to `sessionStorage` on change.
- WS `onmessage` handler: for `snapshot`/`output` messages, now only updates `snapshot` state and
  `snapshotUpdatedAt` — no longer calls `appendEntry`. Safety-block, closed, and error messages
  still append entries as before.
- Scroll effect depends on `snapshotUpdatedAt` (instead of `snapshot`) to auto-scroll on updates.
- Render: replaced the old entries-or-single-card with the new layout:
  - `terminal-chat-controls` block: Lines `<select>` (25/50/100/150/200) identical to
    `FriendlyTerminalView`.
  - `terminal-chat-details` block: stream-status badge, target pill, "Showing N lines" pill,
    "Updated HH:MM:SS" pill.
  - Single `terminal-chat-single-output ovm-output-card` rendered via
    `formatFriendlyTerminalOutput(cleanTerminalOutput(snapshot), lineLimit)`.
  - User-message entries still rendered below as `terminal-chat-entry-user` bubbles;
    system/error entries also rendered (via `cleanTerminalOutput`).

### `tests/unit/terminal-chat-state.spec.ts`

**WHAT:** Added 7 new `describe("cleanTerminalOutput")` unit tests.

**WHY:** Required by brief; proves ANSI stripping and chrome-line filtering work correctly.

Test cases: ANSI strip, chrome-line drop (bypass permissions), ❯ composer drop, `───` rule drop,
spinner/timer drop (`Working (`/`esc to interrupt`), OSC strip, null/empty guard.

## Verification

```
npx tsc          → no errors (exit 0)
npx vitest run tests/unit/terminal-chat-state.spec.ts → 14 tests passed (7 new + 7 existing)
```

Sample cleanTerminalOutput input → output:
```
Input:  "\x1b[39mActual claude output line\x1b[0m\nbypass permissions · shift+tab\n❯ typed\n────\nWorking (5s)\nesc to interrupt"
Output: "Actual claude output line"
```

## Caveats

- `~/.tmux.conf` lines filtered by `_tmuxConfRe` pattern. Any real output containing that literal
  string would also be filtered; judged negligible for an operator console.
- The old empty-state guard (`entries.length === 0`) is removed; the rolling snapshot card is
  always shown when OVM is open, even before the first WS message arrives (shows placeholder text).

## Autonomous decisions

None. All changes implement the brief's explicit acceptance criteria verbatim.
