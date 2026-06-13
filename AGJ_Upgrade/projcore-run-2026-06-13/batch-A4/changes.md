# Batch A4 Changes

## Branch: `feat/agj-upgrade-A4-grok-adapter`  (cut from `feat/agj-upgrade-A3c-events-ws` @ `e1dba70`)

## User Report (verbatim from brief)
R22 — grok onboarded into the workflow (no fork): grok takes an atomic task dispatched by the app, implements to the dev discipline, completion gated through the app's uniform status interface.

R5 — the app's composed prompt is THE source at run time (bare runtime fed the app prompt).

R10 — effort: per-agent default + (v1) launch-time effort.

## Root Cause (mechanism-level)
`AgentEventIngest.tick()` only consumed callback lines plus universal git/pane signals, so grok's interim strict-JSON status-file had no app-side normalizer. The A2 grok TUI launch template also exposed `effort_flag` separately but did not include launch-time `--effort` in `launch_cmd`, and there was no app service that combined resolver output, tmux session creation, composed-prompt feed, and provider-scoped grok contract checks.

## Code Changes
- `src/services/agent-event-ingest.ts` — added optional `statusFilePath`, `parseGrokStatusFile()`, and `ingestGrokStatusFile()` to emit callback-sourced status events through the existing terminal correlation id.
- `src/config/providers.ts` — included grok launch-time `--effort <effort>` in the TUI resolver template.
- `src/services/provider-dispatch-service.ts` — added focused app-side provider dispatch helper that resolves launch spec, creates/reuses tmux session, launches grok, feeds caller-supplied composed prompt, marker-verifies capture, and applies grok-only contract checks.
- `tests/unit/agent-event-ingest.spec.ts` — added grok status-file normalization and status-file + git reconciliation outcome tests.
- `tests/unit/provider-dispatch-service.spec.ts` — added grok launch/feed outcome test asserting `--agent`, `--effort`, tmux launch, composed prompt feed, and marker verification.
- `tests/unit/provider-resolver-service.spec.ts` — updated expected grok launch command to include launch-time effort.

## Commits
- `48641be` `[batch-A4] grok status normalizer + app provider-dispatch helper | scenarios: A4`

## Standing Rules (if discovered)
- Provider-scoped grok dispatch checks belong in `ProviderDispatchService`; global `projcore-dispatch.sh` remains untouched for A4.
- Mid-run grok effort change is a relaunch-at-boundary operation in v1, not a live in-TUI mutation.

## Verification
- Build PASS: `npm run build`
- Type-check PASS: `tsc -p tsconfig.json` via build
- Targeted tests PASS: `npx vitest run tests/unit/agent-event-ingest.spec.ts tests/unit/provider-dispatch-service.spec.ts tests/unit/provider-resolver-service.spec.ts`
- Full suite PASS: `npx vitest run` — 47 files, 599 passed, 1 skipped
- DEV URL: localhost only; no server changes required
- Smoke walk: unit-level app dispatch path verified with mocked `TmuxService`

## Bug Reproductions (if bug fix)
Not a bug fix; A4 adds the grok adapter and dispatch mechanism.

## Caveats
- [PRE-LIVE] Live grok end-to-end proof is explicitly the projcore gate step after this adapter commit.
