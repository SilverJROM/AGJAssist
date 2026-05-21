# Validation Triage

Status: open

## Active Findings

1. Friendly terminal could render stale saved transcript content before confirming the current live tmux pane snapshot.
   - Requirement refs: 5, 6, 7, 8
   - Evidence: Telegram screenshot showed stale internal/debug-style content in friendly mode while raw mode was connected to the current pane.
   - Resolution status: fixed in code, pending live Mini App confirmation

2. Raw terminal fallback remained connected to the current tmux pane but had unnecessary cursor blink noise.
   - Requirement refs: 1, 9
   - Evidence: raw terminal screenshot showed current pane data; issue was UX noise, not wrong pane content
   - Resolution status: fixed in code, pending live Mini App confirmation

## Triage Rules

1. Record failures with exact requirement reference when possible.
2. Separate implementation defects from environment/setup blockers.
3. If a blocker prevents progress on later batches, mark it in `progress.md`.
4. Keep this file concise and current.
