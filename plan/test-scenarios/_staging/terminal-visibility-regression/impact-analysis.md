# Impact Analysis

## Change Request
- Terminal raw and friendly views in the Telegram Mini App are not reliably showing the current pane data.
- Friendly mode can surface stale transcript state instead of the live tmux pane.
- Raw mode should remain visible and usable without distracting blink.

## Affected Sections
- Terminal route UI
- Friendly terminal transcript bootstrap and persistence
- Raw terminal visual behavior

## Scenarios Requiring Updates
- none, because there was no maintained terminal scenario library in this repo yet

## New Scenarios Needed
- `terminal-visibility-regression.md`

## Unaffected Scenarios Explicitly Confirmed
- Notes, plans, reminders, chat providers, and local LLM routes are unaffected by this terminal visibility fix
- tmux command-sending safety rules are unaffected
- authentication flow is unaffected

## CRUD Operations Touched
- TV-READ-001
- TV-READ-002
- TV-CREATE-003

## Regression Notes
- This is a demo-visible defect
- Friendly mode must not show stale internal text when the live tmux pane has different content
- Raw mode remains advanced fallback and must continue to show current pane output
