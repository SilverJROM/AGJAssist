# B0 — Codex audit prompt (read-only)

You are the implementer for the AGJAssist modularization refactor. THIS BATCH IS READ-ONLY — you must not modify any file under `src/` or `tests/`. The only file you create is `plan/WK_0519/agjassist-modularization-2026-05-23/projcore-run-2026-05-23/audit/CODEX-AUDIT.md`.

## Contract (from og-requirements.md R1)

Produce CODEX-AUDIT.md with these sections:

1. **Per-directory + per-file LOC table** — `find src -name "*.ts" | xargs wc -l`. Tag any file >500 LOC.
2. **Cross-directory import edge list** — for each `src/*` directory, list which other `src/*` directories it imports from and the count of unique import statements.
3. **Cycle detection** — grep + a small in-prompt graph walk. No new deps; do not `npm install madge`. If you cannot prove zero cycles, list the suspect edges and stop there.
4. **Dead-export list** — for each `export` in `src/`, check whether any other file under `src/` or `tests/` imports that symbol. Report exports with zero importers.
5. **Module boundary proposal** — your version of og-requirements.md §R2. Must reconcile with R2; differences become entries in `decisions/`.
6. **Risk-ranked batch list** — your refactor batches, smallest+lowest-risk first. Reconcile with the implementation-plan.md B2–B9.

## Tools you may use

- `rg` (ripgrep), `find`, `wc`, `awk`, `sort`, `uniq`, `xargs`.
- Read any file under `src/`, `tests/`, `plan/`.

## Tools you may NOT use

- `Edit`, `Write`, `str_replace` against anything outside `audit/CODEX-AUDIT.md`.
- `npm install`.
- Network calls.

## Stop conditions

- Audit complete → write the file → emit `STATUS: DONE` as your last line.
- If you find a structural surprise (an import cycle, a service with hidden global state, a route doing schema mutation) that materially changes the refactor plan → write what you have + emit `STATUS: NEEDS-DECISION` and describe the surprise.

End with the STATUS marker.
