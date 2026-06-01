# Batch B12b Changes

## Branch

`feat/spark-daemon-b12b-agentpane`, from `feat/spark-daemon` lineage at `32a19e2`.

## User Report

"You are the IMPLEMENTER (codex). Claude /projcore supervises from AGJ-51. New batch — read and execute in full: /home/agjrom/TGBOTS/AGJAssist/spark-daemon-runkit/projcore-run-2026-06-01/prompts/batch-b12b.md (is_agent_pane shared classifier, R11.1 — read og-requirements R11.1 for the exact patterns). Handshake first: STATUS: PROPOSED then WAIT for APPROVED-PLAN. Callback FIRST to callbacks.md on each state change. DISPATCH-MARKER: AGJ-B12B"

"APPROVED-PLAN for B12b. Plan matches R11.1 and is well-scoped (classifier only, bash+TS parity, agent-patterns-before-PS1, unknown-as-default). One reinforcement: make the bash and TS pattern sets identical and include a fixture that asserts BOTH return the same enum for the same seeded pane content (parity is the contract). Proceed. Callback FIRST on DONE, then STATUS: DONE."

## Root Cause

R11.1 needs a shared parent-pane classifier before later register warning and pre-nudge recheck batches can safely identify claude, codex, bare-bash, unknown, and missing tmux sessions.

## Code Changes

- `/home/agjrom/.claude/agents/lib/overmind.sh` - Added sourceable `is_agent_pane <session>` using `tmux has-session`, `tmux capture-pane -J -p -t <session> -S -50`, R11.1 claude/codex patterns, PS1 bare-bash fallback, and `unknown` default.
- `/home/agjrom/.claude/agents/lib/overmind.sh` - Wrapped the existing dispatcher in a `BASH_SOURCE` execution guard so sourcing the file exposes functions without running a subcommand.
- `src/services/overmind/agent-pane.ts` - Added server-side `isAgentPane(session)` and `classifyAgentPaneText(pane)` with the same enum and pattern order as the Bash helper.
- `tests/overmind-agent-pane.test.ts` - Added tmux-backed parity coverage that checks Bash and TypeScript against the same seeded pane content.
- `spark-daemon-runkit/batch-b12b/artifacts/overmind.sh` - Added tracked reference snapshot of the deployed runtime Bash script.
- `spark-daemon-runkit/projcore-run-2026-06-01/batch-b12b/*` - Added scenarios, verification, review, and handoff artifacts.

## Commits

- Commit created for this batch: `feat(overmind): is_agent_pane shared pane classifier (B12b, R11.1)`; final hash reported in the completion status.

## Standing Rules

- Future consumers must call the shared helper instead of copying the pane heuristics so Bash and TypeScript stay in parity.
- Future register warning logic must treat `unknown` as warn-only because R11.1 defines it as the defensive default.

## Verification

- Build: PASS (`npm run build`)
- Type-check: PASS (`tsc -p tsconfig.json`, via build)
- DEV deploy: not applicable, classifier only and no server restart requested
- Smoke verify:
  - Bash source: `is_agent_pane agj-b12b-definitely-missing` returned `no-session`.
  - Live tmux: `AGJ-51=claude`, `AGJ-codex=codex`, `rsp-rrc=bare-bash`, `spark-agj-watch-driver=unknown` in both implementations.
  - Targeted tests: `npx vitest run tests/overmind-agent-pane.test.ts` passed.

## Bug Reproductions

Not a bug-fix batch.

## Caveats

- PRE-EXISTING: worktree contains unrelated ambient churn under `.overmind-state.json`, `plan/overmind/audit/*`, `src/services/overmind/classifier.ts`, `src/services/overmind/pane-utils.ts`, and `tests/overmind-classifier.test.ts`. These files were not staged for B12b.
