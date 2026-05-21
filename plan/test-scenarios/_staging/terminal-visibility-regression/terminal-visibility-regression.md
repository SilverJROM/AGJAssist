# Terminal Visibility Regression

## Metadata
- Section: terminal
- Type: regression
- Origin: Telegram Mini App raw/friendly terminal visibility defect
- CRUD Refs: TV-READ-001, TV-READ-002, TV-CREATE-003
- Must-not-break: true
- Last updated: 2026-04-06

## Preconditions
- User is authenticated in the AGJAssist Mini App
- At least one tmux pane exists and has visible shell output
- Terminal route is reachable

## Auth Role
- owner/authenticated user

## Data Setup
- Existing tmux pane target with current shell output
- Optional previously saved friendly transcript state for the same pane

## Steps
1. Open the terminal route in the Mini App.
2. Select a tmux pane target with known current output.
3. Switch to raw mode.
4. Confirm the visible pane output reflects the current tmux pane content.
5. Switch to friendly mode for the same pane.
6. Confirm the first visible transcript content reflects the live tmux pane and not stale saved transcript text.
7. Enter a command in the friendly composer and send it.
8. Confirm the command is sent to the real tmux pane and resulting output becomes visible in the friendly transcript.
9. Return to raw mode and confirm the same pane still shows current terminal output.

## Expected Results
- Raw mode shows current pane output for the selected target
- Friendly mode shows readable transcript content based on the current pane, not stale saved transcript history
- Friendly composer sends commands to the actual tmux pane
- Resulting output becomes visible without high-frequency blinking
- Switching between friendly and raw modes keeps the selected pane consistent

## Regression Notes
- Persisted friendly transcript state may only be reused when it still matches the live pane snapshot
- If saved transcript state conflicts with the live pane snapshot, the live pane wins
