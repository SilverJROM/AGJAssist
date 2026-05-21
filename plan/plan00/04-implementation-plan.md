# 04 - Implementation Plan

## Pipeline Summary
- Invoked domains:
  - Business logic: needed (`REQ-001..REQ-005`, `BR-001..BR-005`)
  - Architecture: needed (`ARCH-001..ARCH-004`, security controls)
- Skipped:
  - UI/UX deep design (backend-first scope)

## Milestones
- `MS-001`: Project scaffold and runtime config.
- `MS-002`: LLM providers (Ollama + OpenRouter).
- `MS-003`: Tmux manual commands (`/jobs`, `/tmux`, `/peek`).
- `MS-004`: OpenRouter tool-enabled orchestration on `op/OP` prefix.
- `MS-005`: E2E tests for orchestration + manual command path.

## Task Contracts
- `TASK-001` Owner: Backend
  - Input: env values and tokens
  - Output: typed config module
  - AC: fail fast on missing required vars
- `TASK-002` Owner: Backend
  - Input: provider credentials
  - Output: OpenRouter/Ollama clients
  - AC: unified chat interface
- `TASK-003` Owner: Backend
  - Input: tmux runtime
  - Output: list + peek APIs
  - AC: command-level error handling
- `TASK-004` Owner: Backend
  - Input: user prompt with `op` prefix
  - Output: assessed response with tool usage
  - AC: iteration cap and action parsing
- `TASK-005` Owner: QA
  - Input: in-process core services
  - Output: passing e2e tests
  - AC: OP route and manual command validated

## Test / Validation Gates
- Build gate: TypeScript compilation.
- Functional gate: vitest e2e test suite.
- Runtime gate: `/help`, `/jobs`, `/peek` and `op` path tested with real token in staging.

## Execution Loop Contract
- Implementation loop: max 2 attempts per failing task before escalation.
- Testing loop: max 3 reruns per failing test before escalation.

## Escalation Protocol
1. Fix local implementation issues.
2. If unresolved, isolate failing module with minimal repro.
3. Escalate to user with exact error and required decision.

## Notification Contract
- Milestone updates should be emitted after each completed milestone.
- Completion update includes scope delivered and tests passed.
