# Batch B3 Review

- Scope stayed inside the daemon detection core and B3 artifacts.
- `CRASHED` takes precedence for dead sessions or dead/absent watcher PID.
- `HEALTHY` requires watcher alive and forward progress evidence.
- `IDLE-CLEAN` requires `Worked for`, no active busy marker, no fresh progress, and no stale-progress condition.
- `AMBIGUOUS` handles frozen busy panes, stale frozen panes, fresh-progress-but-frozen panes, and default unclear states.
- State cache schema is per-run under `runs[run_key]` with `last_pane_hashes`, `last_callbacks_line_count`, `last_head`, `unchanged_ticks`, `last_classification`, and `last_tick`.
- Atomic cache writes use same-directory `mktemp` plus `mv`.
- Source/test guard is opt-in only and does not change normal daemon invocation.
