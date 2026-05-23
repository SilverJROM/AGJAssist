# AGJAssist Modularization Refactor — entrypoint

Raised by JROM on 2026-05-23 in the same conversation that fixed the duplicate-`run_dir` register bug. Decisions locked at intake:

- **Scope:** AGJAssist repo only.
- **Driver:** `/projcore` + codex-in-tmux.
- **Safety:** strict zero-behavior-change.

## Documents in this folder

| File | Purpose |
|---|---|
| `og-requirements.md` | The contract. R1–R6 with verbatim JROM ask. |
| `implementation-plan.md` | B0 audit + B1–B9 atomic refactor batches. |
| `audit/CODEX-AUDIT.md` | (produced during B0) Codex's read-only static analysis. |
| `projcore-run-2026-05-23/` | (created when `/projcore` runs) the standard projcore execution folder. |

## How to start

JROM kicks it off in a new conversation:

```
/projcore
```

…and points it at this folder. projcore's intake-checks step (§1.4) finds `og-requirements.md` + `implementation-plan.md` already present, frontloads the 5-question interview (probably zero questions — everything is locked), spins up codex-in-tmux, and **self-registers to overmind** per R6 — the workflow will appear on the dashboard as `AGJAssist · modularization refactor`.

## Self-register payload (R6.1)

projcore will POST `/api/overmind/register` with roughly:

```json
{
  "token": "<from .env OVERMIND_TOKEN>",
  "label": "AGJAssist · modularization refactor",
  "session": "<projcore-tmux-session-name>",
  "child_sessions": ["agj-modular-impl", "agj-modular-review"],
  "child_roles": ["codex-impl", "codex-review"],
  "run_dir": "/home/agjrom/TGBOTS/AGJAssist/plan/WK_0519/agjassist-modularization-2026-05-23/projcore-run-2026-05-23",
  "current_task": "B0 codex audit",
  "tasks": [
    { "id": "B0", "label": "Codex audit (read-only)", "state": "processing" },
    { "id": "B1", "label": "Quarantine flaky personal-tasks date test", "state": "pending" },
    { "id": "B2", "label": "Extract pane-utils.ts", "state": "pending" },
    { "id": "B3", "label": "Extract subagent-detection.ts", "state": "pending" },
    { "id": "B4", "label": "Extract classifier.ts", "state": "pending" },
    { "id": "B5", "label": "Extract completeness.ts", "state": "pending" },
    { "id": "B6", "label": "Extract decision-match.ts", "state": "pending" },
    { "id": "B7", "label": "Reorganize overmind-service.ts", "state": "pending" },
    { "id": "B8", "label": "Split database.ts", "state": "pending" },
    { "id": "B9", "label": "Drop legacy barrel re-exports", "state": "pending" }
  ]
}
```

Note: the new register-side guard (the same-day bug fix) will reject a duplicate registration if any other active workflow already owns this run_dir under a different coordinator_session — projcore needs to use a stable session name and `/api/overmind/complete` on prior runs first.

## Why /projcore over /lead

This is a multi-batch, requirements-driven refactor with a strict tests-green contract per batch. That's exactly the shape projcore was built for (verifier ≠ fixer, atomic <30min slices, requirements coverage matrix). `/lead` would have been fine for a 1-shot single-PR refactor, but at 9 batches with hard test-count contract it earns the heavier supervisor.
