# Batch B14 Changes

- Added shared Terminal view font-size controls (`A-`, `Reset`, `A+`) for active panes.
- Persisted terminal font size in `localStorage` with 8-28px bounds.
- Updated the raw xterm instance live via `term.options.fontSize`, `fitAddon.fit()`, and `term.refresh(...)`.
- Changed the terminal command textarea from one row to two rows by default.
- Made the command textarea vertically resizable while preserving Enter submit and Shift+Enter newline behavior.

Screenshot proof:

- `screenshots/terminal-controls-and-input.png`
