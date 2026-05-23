# Batch O8 Test Report

Timestamp: 2026-05-21T13:20:06Z

## Commands

- `npx vitest run tests/overmind-classifier.test.ts`
  - PASS: 1 file, 25 tests.
- `npx vitest run tests/overmind-classifier.test.ts tests/overmind-stream.test.ts tests/overmind-nudge.test.ts tests/overmind-brain.test.ts tests/overmind-decision.test.ts`
  - PASS: 5 files, 59 tests.
- `npx tsc`
  - PASS.
- `npm run build`
  - PASS.
- `npx vitest run --exclude tests/unit/conversation-memory.spec.ts`
  - PASS: 24 files, 264 tests.
- `npm test`
  - FAIL due to environment-only live Ollama dependency: `tests/unit/conversation-memory.spec.ts` could not find local model `qwek32k:latest`.
  - The initial run also surfaced an O8 expectation change in `tests/overmind-stream.test.ts`; that was fixed and covered by the focused and non-live suite reruns.

## Required Regression Coverage

- Chrome/timer-only drift with frozen body and no `esc to interrupt`:
  - Covered by `does not treat child timer-only chrome drift as working past the stuck threshold`.
- Active turn:
  - Covered by `detects active turns independently from body changes`.
  - Covered by `classifies an active-turn pane as working even when the body hash is unchanged`.
- New body output:
  - Covered by `keeps substantive pane body content distinct after stripping chrome`.
  - Covered by `still treats substantive child pane output as working`.

## Notes

The live Ollama memory failure is outside O8's touched scope and is reproducible as a missing local model error, not an activity-detector regression.
