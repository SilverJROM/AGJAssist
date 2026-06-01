# Batch B4 Scenarios

- R2.1/R9.1: successful `overmind.sh register` starts the daemon when the isolated daemon pid is absent.
- R6.1/R6.2: Tier-1 `CRASHED` produces a HARD daemon callback, invokes `overmind.sh stall-alert`, and sends the TG URGENT payload through the notification protocol transport. Test uses mocks for TG and stall-alert.
- R6.1: `ALERT-MEDIUM` produces a MEDIUM daemon callback and does not invoke TG or stall-alert.
- R9.2: `overmind.sh complete` has no daemon kill path.
- R9.3/R9.4: daemon alert callbacks coexist with `projcore-watcher.sh`; `[projcore SPARK-DAEMON-*]` does not match the watcher's exact `[projcore callback] <batch-id>` regex.
