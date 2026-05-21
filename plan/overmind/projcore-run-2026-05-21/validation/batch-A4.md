# Validation — Batch A4 (R9, R14-tg, completes R4) — VERDICT: PASS (after iter 1)

Independent verification by projcore.

## Iter 0 → FAIL (caught by live smoke, not unit tests)
Registered a workflow at live session `ovm-build`; after a watcher tick `last_pane_hash` = SHA-256 of empty string. Root cause: `tmuxService.capturePane()` threw "Invalid tmux target" for bare session names (overmind registers bare sessions); `capturePaneSafe` swallowed it → empty panes → meaningless classification. Sent correction (corrections/batch-A4-iter1.md).

## Iter 1 → PASS
| Gate | Result |
|------|--------|
| 1. Artifacts | PASS — batch-A4 changes/test-report/independent-validation present |
| 2. Diff review | PASS — assistant-core (+commands), telegram-bot (setMyCommands), index.ts (watcher start), tmux-service (ensureValidTarget widened to accept bare session OR session:window.pane, injection-safe). Tight |
| 3. Build | PASS — `npx tsc` exit 0 |
| 4. Targeted tests | PASS — overmind-commands 3/3; tmux-service tests green; full suite 189/190 (1 unrelated pre-existing Ollama/network failure in conversation-memory.spec) |
| 5. Evidence (5Q) | PASS — **live re-verified**: smoke workflow on real session `ovm-build` → last_pane_hash `056819ba…` (real, not empty SHA), status `working`, last_activity_at advancing across ticks |
| 6. Req coverage | R4 VERIFIED (loop runs live, reads real panes, classifies), R9 VERIFIED (command formatters unit-tested; read same DB the loop writes), R14-tg VERIFIED (display via /overmind+/om_tasks unit-tested) — R14 row still IN-PROGRESS pending UI (A7) |
| 7. Decisions | PASS — ensureValidTarget widening logged in changes; lesson: live smoke is mandatory for tmux-dependent work |

**Boot smoke:** pm2 restart → "Overmind watcher started (45s)" + API listening. Smoke row cleaned.
**Lesson captured:** unit tests with synthetic panes cannot catch tmux-target/integration faults — live smoke against a real session is required for every tmux-touching batch (applies to A5 nudge + A7).
