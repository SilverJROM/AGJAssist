# Batch B4 Independent Validation

Implemented and self-validated by Codex implementer before handoff.

- R2.1/R9.1: PASS. Register success path spawns daemon if isolated pid/global process is absent; 404 rejection path does not include spawn.
- R6.1/R6.2: PASS. HARD writes `[projcore SPARK-DAEMON-HARD]`, calls stall-alert, and sends a notification-protocol payload. MEDIUM writes `[projcore SPARK-DAEMON-MEDIUM]` only.
- R9.2: PASS. `cmd_complete` remains unchanged and contains no daemon kill.
- R9.3/R9.4: PASS. Watcher exact callback regex ignores `[projcore SPARK-DAEMON-HARD]`; fixture watcher exited 5, not 0.
- Scope guard: PASS. `overmind.sh` outside `cmd_register` is byte-identical to the pre-edit backup.
