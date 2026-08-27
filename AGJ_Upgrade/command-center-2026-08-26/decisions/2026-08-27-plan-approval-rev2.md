# Decision — apply plan-approval CHANGES-REQUESTED (rev 2)

Date: 2026-08-27 · `[projcore]` · exact-gap apply, no co-planner respawn, no tiller start.

Source: `plan-approval.md` STATUS: CHANGES-REQUESTED (codex55 + north). All 6 findings addressed in `plan.md` / `queue.md` / `fence-contract.json`.

| # | severity | what changed |
|---|----------|----------------|
| 1 | HIGH | INTEGRATION `tests` cells are `--gate` (positive PASS **and** negative red). `gate_cmd` recorded in fence-contract. |
| 2 | HIGH | Each fence has `expected_negative_fail_ids` + `expected_negative_kind=assert`. A0 `--harness-smoke` proves named-assert red, not import/not_found. |
| 3 | HIGH | G2 `--execute` is a code guard (TTY + confirmation phrase + refuse if `TILLER_SLICE`/`TILLER_RUN_DIR`/`TILLER_ATTEMPT`/`TILLER_SEAT` set). `tests/unit/release-command-center.spec.ts` must prove tiller-env `--execute` exits non-zero with live DB and pm2 untouched. |
| 4 | MED | `scripts/cc-run-isolated.mjs` (A0) wraps temp-DB vitest rows, tears down, prints `reclaimed_bytes`. Fence `--gate` and Playwright `cc` webServer likewise. G1 is dead-OVM/mockup scratch only. |
| 5 | MED | A0 `tests` is `--harness-smoke`, not `--list`. |
| 6 | MED | D7 `deps` include C6. Fixture contract: arrive via closed C6 solicit/reply on a temp pane; no INSERT/`agent_summaries` fake, no faked reply body. |

Named negative ids: B8/B2→A2, C6/C3→C5, D7/D3→E1, E5/E2→D3, F7/F1→G3.
