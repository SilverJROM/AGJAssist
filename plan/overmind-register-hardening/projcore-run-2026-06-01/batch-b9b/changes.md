# Batch B9b Changes

## Branch: `feat/ovm-register-hardening`

Cut from `32c6ab0` @ `32c6ab0`.

## User Report (verbatim from brief)

"Harden what agents submit to OVM"

## Root Cause (mechanism-level)

The API accepted task rows whose IDs were client-parser fallbacks (`row-N`) and `/api/overmind/tasks` trusted incoming task shape more than `/register`; the bash client produced those fallback IDs for unparseable queue lines and child management ignored explicit run directories.

## Code Changes

- `src/services/overmind/sanitize.ts` — Added shared submitted-task validation for real IDs, non-trash labels, and the persisted task-state enum.
- `src/api/routes/overmind-routes.ts` — Rejected invalid task lists on attach `/register`, legacy `/register`, and `/tasks` with `ok:false`, `code:invalid-task-list`, `hint`, and `invalid_tasks`.
- `src/api/routes/overmind-routes.ts` — Reused the tmux-safe session regex for project `parent_session`, legacy child sessions, and `/children` updates with corrective hints.
- `tests/overmind-routes.test.ts` — Covered garbage task rejection, attach task rejection, valid task submission, malformed parent sessions, and malformed `/children` child sessions.
- `tests/overmind-sanitize.test.ts` — Covered the shared task validation helper directly.
- `/home/agjrom/.claude/agents/lib/overmind.sh` — Skipped unparseable task lines instead of emitting `row-N`, mapped non-persisted queue states to `pending`, and parsed `--run-dir` for `child-add` and `child-rm`.

## Commits

- `HEAD` feat(overmind): submission integrity — reject garbage tasks, validate sessions, child-add --run-dir (B9b, R10) | scenarios: R10.1, R10.2, R11/R14 child-add

## Standing Rules (if discovered)

- Future Overmind submission endpoints must reject invalid task payloads at API ingress instead of relying on service-layer sanitation.
- Future bash task parsers must skip unparseable rows; they must not synthesize task IDs that can be mistaken for real work.

## Verification

- Type-check: PASS (`npx tsc --noEmit`)
- Targeted overmind suite: PASS (`npx vitest run tests/overmind-sanitize.test.ts tests/overmind-routes.test.ts tests/overmind-service.test.ts tests/overmind-nudge.test.ts tests/overmind-parent-nudge-guard.test.ts`) — 129 passed.
- Bash syntax: PASS (`bash -n ~/.claude/agents/lib/overmind.sh`)
- Parser manual: PASS (`build_tasks_json` skipped an unparseable `queue.md` line and emitted only `B9b`).
- CLI manual: PASS (`child-add child_ok tester --run-dir <tmp>` and `child-rm child_ok --run-dir <tmp>` from `/tmp` updated the intended `<tmp>/.overmind-state.json`).

## Bug Reproductions

- `row-N` task acceptance: reproduced by existing route sanitation test expectation that `row-3` survived; after fix, `/register` and `/tasks` return 422 with `invalid-task-list`.
- Client fallback parser: reproduced by code inspection of `build_tasks_json` fallback branch assigning `tid=f'row-{len(tasks)+1}'`; after fix, the same unparseable line is skipped.
- `child-add --run-dir` footgun: reproduced by code inspection of `cmd_child_add`/`cmd_child_rm` using only `${OVERMIND_RUN_DIR:-$PWD}`; after fix, temp-state manual check from `/tmp` mutates the requested run dir.

## Caveats

- [PRE-EXISTING] Extra broad glob `npx vitest run tests/overmind*.test.ts tests/acceptance/overmind*.acceptance.test.ts` still fails in `tests/overmind-stream.test.ts` stale stream mocks/expectations and `tests/acceptance/overmind-projects-api.acceptance.test.ts` stale attach-envelope expectations. The required B9b route/service/sanitize/nudge suite is green.
