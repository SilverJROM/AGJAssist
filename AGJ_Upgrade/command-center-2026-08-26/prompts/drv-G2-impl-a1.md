# [projcore DIRECTION for this retry — apply this first]
Verified: 'npm run build' genuinely fails on current HEAD (28d4605, before G2 touches anything) with 3 pre-existing TS18046 errors -- request.params is of type 'unknown' at agent-reminder-routes.ts:83,124 and agent-wakeup-routes.ts:75. Root cause in all three: the handler callback is annotated 'async (request: FastifyRequest, reply: FastifyReply) => {...}' with a BARE FastifyRequest type, discarding the generic route-params type Fastify already infers from the route registration (e.g. app.delete<{ Params: { id: string } }>(...)). Fix: drop the explicit ': FastifyRequest' annotation on request in those three handlers (or type it explicitly as FastifyRequest<{ Params: { id: string } }>) so request.params.id resolves to a string instead of unknown. This is a small, mechanical type-safety fix pre-existing from the reminder/wakeup route work, not something G2 introduced and not a design change -- fix in place, do not touch route behavior, then continue with G2's own release-script scope.

# tiller implementer — standing contract
(This section is identical in every implementer brief. Your specific work is in THE SLICE below.)
- **STANDING (north 2026-08-07):** the path in the slice `tests` column (below) is the test file THAT THIS SLICE MUST AUTHOR, then run green. It is an OUTPUT of the slice, not a precondition. A missing spec file is NEVER a reason to block — write the spec, make it pass, only then report DONE.
- test cmd: **use the `tests` command from YOUR slice row BELOW, exactly as written** — it is the authority. Do NOT substitute a build/test command the project does not have: if the row's command is a plain `node -e ...` one-liner, run that and nothing else. Only run `npm run build` / `npm ci` if the row asks for it or the repo demonstrably has that script. A missing script you were never asked to run is NOT a blocker.
- **YOUR TEST MUST NOT COMPUTE ITS EXPECTED VALUE FROM THE MECHANISM UNDER TEST** (north D-082). The expected value comes from a LITERAL, a FIXTURE, or a SECOND PATH that does not share the code under test. An assertion that asks the thing it is testing what to expect passes whatever that thing does, including wrong, and proves nothing.
  **Concretely: supply an input the mechanism would NOT choose on its own, then assert the output honours it** — a routing selection that is deliberately not the health-ranked winner; a value read back through the public path rather than raw SQL; a host deliberately different from the default. **If you cannot say what would make your test FAIL, it is not a test yet** — say so in your callback rather than reporting DONE on it.
- IF (and only if) your row's command is vitest: `npx vitest run <the focused spec> --minWorkers=1 --maxWorkers=4` — the pool-agnostic worker cap is MANDATORY on EVERY vitest run (incl. any full-suite check); uncapped Vitest thrashes/OOMs this box and kills every tmux session including live runs.
- E2E/UI/browser commands (Playwright etc.): ALWAYS wrap them as `timeout --signal=TERM --kill-after=15s 180s <command>` — a webServer/browser teardown can hang forever and freeze this seat; TERM alone may not kill an unresponsive child, so --kill-after SIGKILLs it. ANY nonzero exit (124 timeout, 137 killed, OR a real test failure) is a **FAIL, never a PASS** — fail closed; never infer a pass from partial output. If you pipe through `tee`, set `-o pipefail` (or read `${PIPESTATUS[0]}`) so the pipe cannot mask the failure.

You are the IMPLEMENTER. You write product code and tests, then commit.

---

# THE SLICE — G2 (run command-center-2026-08-26)

## Scope (do ONLY this)
RELEASE-ATOMIC: add `scripts/release-command-center.mjs`. Default `--dry-run` requires green B8,C6,D7,E5,F7 markers, builds, migrates a `DB_PATH` copy, prints backup path plus rollback `git reset --hard <pre-release-sha>` and DB-restore. `--execute` is human-gated by MECHANISM: refuse unless stdin is a TTY AND the operator types the confirmation phrase AND none of `TILLER_SLICE`/`TILLER_RUN_DIR`/`TILLER_ATTEMPT`/`TILLER_SEAT` are set; any tiller/agent marker ⇒ hard refuse (non-zero, zero live DB writes, zero pm2). `tests/unit/release-command-center.spec.ts` MUST prove a tiller-env `--execute` is refused (exit non-zero, `data/agjassist.db` untouched, no `pm2` spawn). Tiller runs only dry-run + the refuse test, never `--execute`.

## Acceptance criteria — the TEXT is the contract, the id is only its name
- **A4** — Migration drops `overmind_projects`, `overmind_workflows`, `overmind_task_history` (+ any overmind-only columns), with a timestamped DB backup taken first; a **fresh** DB and an **upgraded** DB converge to the same schema; `SCHEMA_VERSION` bumped.
- **A5** — After teardown the app boots, the terminal/chat + notes/plans/tasks/reminders surfaces work, and the full unit + e2e suites are green (no dangling overmind imports/types).

**If a criterion above does not describe the work in Scope, SAY SO rather than implementing toward it.** That is a PLAN_DEFECT and reporting it is worth more than an attempt spent satisfying the wrong thing — one such criterion rode six slices and failed five attempts across three model tiers before a human noticed.
**And if a criterion states an OUTCOME but not a MECHANISM, say which mechanism you are choosing, in your callback.** "Tests must fail when the clause is violated" is an outcome; HOW a test discriminates is the mechanism, and three slices in one run burned attempts because the criterion resolved perfectly and still did not say what to build. Naming your choice costs one line and makes a wrong choice visible at the gate instead of at attempt 3.

## Focused tests
`node scripts/cc-run-isolated.mjs --slice G2 -- npx vitest run tests/unit/release-command-center.spec.ts --minWorkers=1 --maxWorkers=4 && npm run build`

## Emit ONE metric line (non-gating, ignored by every gate)
After you have read this brief and the sources/tests you need, and BEFORE your first edit, echo exactly:
```
[TILLER-METRIC-V1] run=command-center-2026-08-26 batch=G2 attempt=1 role=implementer
  marker=DRV-G2-21 event=context_ready ts_ns=$(date +%s%N) head=$(git rev-parse HEAD)
```
Run it as shell so the timestamp and HEAD are real. If you forget it, nothing breaks and nothing fails — it is measurement, not a gate.

## ⚠ RELEASE SAFETY (MANDATORY)
This is a RELEASE-ATOMIC cutover slice. BUILD the cutover SCRIPT and UNIT/DRY-RUN test its preflight + rollback logic ONLY. **NEVER execute a real cutover, never kill/stop/relaunch any live watcher/run/session, never touch live client manifests or prod state.** Firing the cutover is a human-only go-live. Any real destructive action = immediate FAIL.
**The park rollback is GIT-ONLY — it cannot undo a database.** So the danger here is not just running the cutover on purpose; it is migrating the LIVE database BY ACCIDENT. Running the app or its test suite against the live DB applies pending migrations as a SIDE EFFECT. If this slice is then parked, git reverts your code and the schema stays migrated — leaving the DB AHEAD of the code, which is a desync a human has to reconcile by hand (Helm B2, 2026-08-04: live schema_version 114 vs code 113).
So: point tests at a TEMP COPY of the DB (`cp` it, or an env override like `*_DB_PATH=/tmp/<slice>-$$.db`), never the live file. If you cannot avoid touching the live DB, say so in your callback so the park is not silently lossy.

## Emit protocol (MANDATORY)
Build it, run the focused tests, then commit atomically **with the slice id in the commit SUBJECT as a delimited token** — `feat(G2): <summary>` or `[G2] <summary>`. Tiller binds your commit to this slice ONLY via that tag; an untagged subject is rejected as a foreign commit and the slice PARKS. ONLY after the commit lands, append ONE line to /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md:
`[projcore callback] implementer G2 STATUS: DONE — commit <sha> <one line: what changed, max 100 chars>`
**Emit it in the SAME command as the commit**, so the callback cannot be lost if your turn ends at the commit — the `&&` keeps the ordering guarantee (nothing is appended unless the commit succeeded):
```sh
git commit -m '[G2] <summary>' \
  && printf '%s\n' '[projcore callback] implementer G2 STATUS: DONE — commit '"$(git rev-parse --short HEAD)"' <what changed>' >> /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md
```
Use BLOCKED only if you genuinely could NOT commit (never after a successful commit): `[projcore callback] implementer G2 STATUS: BLOCKED — <reason>`. Do not widen scope.
