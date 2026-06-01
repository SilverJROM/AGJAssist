# Batch B12b Scenarios

## Requirements

- R11.1: `is_agent_pane <session>` exists as a sourceable Bash helper in `~/.claude/agents/lib/overmind.sh`.
- R11.1: AGJAssist server code exposes an equivalent TypeScript helper.
- R11.1: both implementations return exactly `claude`, `codex`, `bare-bash`, `unknown`, or `no-session`.
- R11.1: both implementations run `tmux has-session` for missing sessions and `tmux capture-pane -J -p -t <session> -S -50` for existing sessions.
- R11.1: claude/codex agent patterns win before the bare-bash PS1 pattern.

## Test Scenarios

- B12b-T1 Bash syntax: `bash -n ~/.claude/agents/lib/overmind.sh` passes.
- B12b-T2 Bash sourceability: `source ~/.claude/agents/lib/overmind.sh; is_agent_pane <missing>` prints `no-session` without running the CLI dispatcher.
- B12b-T3 TypeScript text classifier: all R11.1 pattern fixtures classify to the expected enum.
- B12b-T4 Parity fixtures: Bash and TypeScript return the same enum for the same seeded tmux pane content for claude, codex, bare-bash, unknown, and no-session.
- B12b-T5 Live panes: Bash and TypeScript agree on live claude, codex, bare-bash, and unknown panes where available.
