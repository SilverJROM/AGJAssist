# B12g Changes

## User Report

> register parent WARN-check, R12.7: after a successful attach run is_agent_pane(parent_session) from B12b -> bare-bash/no-session -> WARN not reject, still 201, surface dashboard warn state. Reuse B12b helper.

## Root Cause

B12f introduced the run_dir-only attach registration flow but did not inspect the matched project's JROM-owned `parent_session`. That meant attach registration could succeed with a parent tmux session that was a bare shell or missing entirely, leaving Overmind with no dashboard-readable warning state.

## What Changed

- `src/api/routes/overmind-routes.ts`
  - Added an attach-path-only, post-`registerAttached` parent check using the B12b `isAgentPane()` helper.
  - Normalizes `claude`/`codex` to `parent_status='ok'`.
  - Persists `bare-bash`, `no-session`, and `unknown` into existing `overmind_workflows.parent_status`.
  - Returns `parent_warning` only for `bare-bash` and `no-session`.
  - Catches detector failures and defaults to `unknown` with no warning so a successful attach still returns 201.

- `src/services/overmind/types.ts`
  - Widened `OvermindParentStatus` to include register-time values: `ok`, `bare-bash`, `no-session`, and `unknown`.

- `src/services/overmind/agent-pane.ts`
  - Treats missing `tmux` executable as `unknown` instead of `no-session`, matching the non-fatal B12g rule.

- `tests/overmind-routes.test.ts`
  - Added focused attach-path coverage for ok, bare-bash warning, no-session warning, and detector-throws fallback.

## Caveats

- `parent_status` can later be overwritten by ongoing watcher state; B12i owns mid-run parent-orphan handling.
- No client/dashboard rendering changes were made in this batch.

