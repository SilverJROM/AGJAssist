# 02 - System Architecture

## Architecture Decision
- `ARCH-001`: Implement AGJAssist as modular TypeScript Node app.
- `ARCH-002`: Provider abstraction via `LlmProvider` interface.
- `ARCH-003`: Tool-enabled OpenRouter agent loop using explicit `<ACTION>{...}</ACTION>` contracts.
- `ARCH-004`: Tmux operations behind dedicated `TmuxService` to isolate command details.

## Component Boundaries
- `src/config/config.ts`: env parsing and runtime limits.
- `src/llm/*`: provider clients (`ollama`, `openrouter`).
- `src/tmux/tmux-service.ts`: tmux list/peek read operations.
- `src/tools/tool-registry.ts`: tool execution boundary and policy enforcement.
- `src/orchestration/tool-agent.ts`: iterative LLM + tool loop.
- `src/bot/*`: command parsing and Telegram adapter.

## Data / Control Flow
1. Telegram message received.
2. Auth check against `AUTHORIZED_USER_ID`.
3. Route by input type:
   - slash command -> manual handler
   - `op/OP` prefix -> OpenRouter `ToolAgent`
   - default -> local Ollama chat
4. ToolAgent executes tools and feeds results back until final answer.

## Security Controls
- `ARCH-SEC-001`: single-user authorization gate.
- `ARCH-SEC-002`: workspace-root path restriction for file reads/command cwd.
- `ARCH-SEC-003`: command prefix allowlist + shell control-char block.

## Risks and Mitigations
- `RISK-001`: tmux not installed/running -> return explicit error text.
- `RISK-002`: LLM malformed action JSON -> parser falls back to plain response.
- `RISK-003`: tool loop overuse -> max iteration cap.
