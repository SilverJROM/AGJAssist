# Batch B3 Scenarios

- R3.1: A real tmux session is classified alive; a missing tmux session drives CRASHED.
- R3.2: Pane hash is collected with `tmux capture-pane -J -p | sha256sum` and compared to cached hash.
- R3.3: Busy-marker detection covers active busy markers and tracks `Worked for` separately for IDLE-CLEAN.
- R3.4: Watcher PID is read from `<run-dir>/dispatch/.watcher.pid` and checked with `kill -0`.
- R3.5: `progress.md` mtime is converted to age, fresh, and stale flags.
- R3.6: `callbacks.md` line-count deltas are detected against the state cache.
- R3.7: Git HEAD deltas are detected against the state cache.
- R4: HEALTHY, IDLE-CLEAN, CRASHED, and AMBIGUOUS classifier outcomes are covered by fixtures.
- Cache: `spark-daemon-state.json` stores prior run values and is written via tmp file then rename.
