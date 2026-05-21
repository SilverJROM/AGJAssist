# 01 - Business Requirements

## Scope
- Mode: `greenfield`
- System: AGJAssist Telegram orchestration bot
- Purpose: allow owner to inspect tmux jobs/logs and orchestrate actions through LLM using local Ollama + OpenRouter

## Goals
- `REQ-001`: Provide owner-only Telegram control surface for job inspection and orchestration.
- `REQ-002`: Support dual LLM setup: local Ollama and paid/free OpenRouter model.
- `REQ-003`: Prefix `op`/`OP` forces OpenRouter tool-enabled orchestration.
- `REQ-004`: Manual tmux commands must exist for direct operator control.
- `REQ-005`: Provide automated assessment summaries from tmux/log data.

## Business Rules
- `BR-001`: Only `AUTHORIZED_USER_ID` can invoke bot actions.
- `BR-002`: `op`/`OP` messages run through tool-enabled OpenRouter orchestration flow.
- `BR-003`: Non-prefixed text defaults to local LLM conversational path.
- `BR-004`: Tool actions can read tmux state and logs; command execution is allowlisted.
- `BR-005`: Manual command path must support tmux listing and pane inspection.

## Acceptance Criteria
- `AC-001`: `/jobs` and `/tmux` return live tmux targets and process details.
- `AC-002`: `/peek <session:window.pane> [lines]` returns pane output.
- `AC-003`: `op check tmux jobs` triggers OpenRouter tool loop and returns assessment.
- `AC-004`: Unauthorized users receive rejection.
- `AC-005`: End-to-end automated test verifies OP flow + manual tmux command.

## Non-Functional Requirements
- `NFR-001` Performance: command response under 5s for tmux reads (local host).
- `NFR-002` Reliability: LLM tool loop capped by max iteration to avoid runaway loops.
- `NFR-003` Security: command allowlist + workspace path boundary enforced.
- `NFR-004` Operability: clear command help text for manual operations.
- `NFR-005` Maintainability: modular code split by config/llm/tmux/tools/bot.
