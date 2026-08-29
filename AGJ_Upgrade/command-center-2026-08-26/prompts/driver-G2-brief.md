# [driver] Slice G2 — deterministic brief (run command-center-2026-08-26)

## Scope (verbatim from hardened plan row — do ONLY this)
RELEASE-ATOMIC: add `scripts/release-command-center.mjs`. Default `--dry-run` requires green B8,C6,D7,E5,F7 markers, builds, migrates a `DB_PATH` copy, prints backup path plus rollback `git reset --hard <pre-release-sha>` and DB-restore. `--execute` is human-gated by MECHANISM: refuse unless stdin is a TTY AND the operator types the confirmation phrase AND none of `TILLER_SLICE`/`TILLER_RUN_DIR`/`TILLER_ATTEMPT`/`TILLER_SEAT` are set; any tiller/agent marker ⇒ hard refuse (non-zero, zero live DB writes, zero pm2). `tests/unit/release-command-center.spec.ts` MUST prove a tiller-env `--execute` is refused (exit non-zero, `data/agjassist.db` untouched, no `pm2` spawn). Tiller runs only dry-run + the refuse test, never `--execute`.

## Acceptance criteria (ACs)
A4,A5

## Focused tests (the row's acceptance)
`node scripts/cc-run-isolated.mjs --slice G2 -- npx vitest run tests/unit/release-command-center.spec.ts --minWorkers=1 --maxWorkers=4 && npm run build`

## Contract
- estimate: 30min · deps: G1 · impl_tier=L4 · val_tier=L4 · budget=5
- Verifier ≠ fixer. Do NOT widen scope beyond the row (any widen = re-plan/EDGE).
- End your terminal DONE callback with the VERDICT-V1 line (see design/VERDICT-V1.md).
