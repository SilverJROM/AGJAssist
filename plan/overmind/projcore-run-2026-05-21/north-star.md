# Overmind — North-Star (locked 2026-05-21)

JROM pre-supplied and locked the spec; this is the agreed reference. Append-only.

- **NS-1 — Host & pattern.** Overmind lives inside AGJAssist (new `OvermindService` in the existing Node process). No separate daemon. Implementer = codex-in-tmux.
- **NS-2 — Watch scope.** Overmind WATCHES all sessions of a workflow: the projcore **coordinator** AND its **child codex session(s)**. *(Injected 2026-05-21: child sessions are watched for classification enrichment.)*
- **NS-3 — Talk scope.** Overmind only ever SENDS keystrokes to the **main coordinator session** — NEVER a child codex pane. Codex is projcore's responsibility; if codex needs info / is done and projcore hasn't noticed, overmind nudges the coordinator to go check it.
- **NS-4 — Brain.** Sonnet via `ClaudeCliProvider("sonnet")` (JROM's Claude subscription bucket). NO outside API (no OpenRouter/Ollama for the brain). Used only on the rare ambiguous-stuck case, with tiny context.
- **NS-5 — Lifecycle.** projcore actively reports to overmind: `register` on work-start, `complete` on acknowledged-done. Localhost endpoints guarded by `OVERMIND_TOKEN` in `.env` (NOT JWT — projcore hits them via curl). Browser reads use normal auth.
- **NS-6 — Build/smoke gate.** `npx tsc` clean + targeted vitest where touched + `pm2 restart agjassist`. pm2 restart briefly drops the live bot+dashboard each gate — acceptable. (Default-and-log; ALWAYS-OK per trust-defaults — it's JROM's own dev tool, no DEV/QA/PROD split.)
- **NS-7 — Stage C live-touch autonomy.** RESOLVED 2026-05-21: **STOP & CONFIRM.** Build A1-A7+B autonomously; at Stage C, projcore pauses and shows JROM exactly what it will send into each live coordinator (or curl on its behalf) BEFORE firing any keystroke into `hris-d-22`/`lkcamp-12`/`lkvc-38`.
- **NS-8 — Token efficiency is the contract.** Watcher loop 100% deterministic (zero tokens); status reads pure DB; Sonnet only on rare ambiguity. Burning tokens to *analyze* a genuine stuck case is fine; burning them to *detect* is not.
- **NS-9 — Coord untouched.** Stage B wires `projcore.md` only. `coord.md` is explicitly out of scope (JROM dropped the coord remap — it's a fast cycle, JROM is present).

- **NS-10 — Tasklist visibility.** *(Injected 2026-05-21.)* projcore submits its tasklist (done/processing/pending + current task) to overmind; overmind surfaces "which workflow is working + its current task + task counts" on Telegram and the full done/processing/pending list on the UI panel. Source-of-truth is projcore's submission, refreshed at batch boundaries.
- **NS-11 — Decision interception (Sonnet).** *(Injected 2026-05-21.)* When projcore raises a mid-implementation decision that should have been frontloaded (numbered-option menu in the coordinator pane), overmind's Sonnet brain reads that workflow's `run_dir/north-star.md` + `trust-defaults.md` and either ANSWERS it back to the coordinator (when clearly covered AND not ALWAYS-ESCALATE class) or ESCALATES to JROM. **Guardrail:** never auto-answer the ALWAYS-ESCALATE class (irreversible / merge-to-master / QA/PROD deploy / auth / money / hardened / scope-creep) — escalate those to JROM. Auto-answers go to the coordinator only (NS-3).
- **NS-12 — Frontload enforcement.** *(Injected 2026-05-21.)* Overmind corrects projcore when it raises a should-have-been-frontloaded decision — logs it and reminds the coordinator that such decisions belong in the §1.4a frontloaded interview / north-star at intake, not mid-build. This is overmind externally enforcing what projcore.md §1.4a already mandates.

## Live workflow map (confirmed via `tmux ls` 2026-05-21)
| Workflow | Coordinator (nudge-able) | Child codex (watched, never nudged) |
|----------|--------------------------|-------------------------------------|
| hris-d | `hris-d-22` | `hrcdx-33` |
| lkcamp | `lkcamp-12` | `lkcdx-may20` |
| lkvc | `lkvc-38` | `lkcdx-meet-v7` |
