# Validation Plan

## Source of Truth
- `plan/plan06/og-requirements.md`

## Validation Strategy

1. Validate each implementation batch against the OG requirements it touches.
2. Use digest-first artifact review when agent-written artifacts exist.
3. Prefer durable validation through `tester` for command/result UI behavior and regression-sensitive routes.
4. Use `jromhead` for visual and product-journey review of the Telegram Mini App experience.
5. Reserve final signoff for requirement-by-requirement OG validation after all implementation batches are complete.

## Batch Validation Mapping

### Batch 1: Friendly terminal-chat foundation
- OG requirements: 1, 2, 3, 4, 5, 6, 7, 8
- Must validate:
  - transcript scroll behavior
  - composer input and send
  - tmux-backed processing
  - readable command/result grouping

### Batch 2: Full-screen Telegram mode
- OG requirements: 10, 11, 12, 13
- Must validate:
  - full-screen entry
  - previous-screen restoration
  - in-app back control
  - Telegram back integration if available

### Batch 3: Raw/friendly strategy and mobile polish
- OG requirements: 8, 9, 14
- Must validate:
  - friendly mode is primary in Telegram
  - raw mode remains reachable
  - no severe regression in existing terminal path

### Cross-cutting validation
- OG requirements: 15, 16
- Must validate:
  - milestone/completion updates are emitted through the existing Telegram path if available
  - artifacts and progress state remain current under `plan/plan06`

## Evidence Expectations

- changed files
- commands run
- screenshots or UI evidence when relevant
- pass/fail notes for each batch
- final `og-validation-report.md`
