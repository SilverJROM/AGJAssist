# Batch B1 Scenarios

## Coverage

- R1.1: daemon script exists at `~/.claude/agents/lib/overmind-spark-daemon.sh`, is executable, and is `bash -n` clean.
- R1.2: daemon uses non-blocking `flock` on `~/.claude/agents/telemetry/overmind-spark-daemon.pid`; a second live instance exits `0` silently within 100ms.
- R1.3: PID file contains the running daemon PID and `last_tick` timestamp.
- R1.4: `--once` runs one tick and exits `0`; default mode loops until signaled.
- R1.5: `--help` prints the option table.
- R2.5: default mode does not stop itself; SIGTERM exits cleanly.

## Executed Scenarios

### T1: Syntax and Help

1. Run `bash -n ~/.claude/agents/lib/overmind-spark-daemon.sh`.
2. Run `~/.claude/agents/lib/overmind-spark-daemon.sh --help`.
3. Confirm help includes `--once`, `--help`, `SPARK_DAEMON_TICK_BASE`, and default mode.

Expected: syntax passes and help prints the required table.

### T2: Singleton

1. Start default daemon in background.
2. Wait until PID file contains the background daemon PID.
3. Start a second default daemon.
4. Confirm second process exits `0`, emits no output, and completes within 100ms.
5. Confirm first process remains alive.
6. Send SIGTERM to first process.

Expected: only the original daemon remains active after the second invocation.

### T10: Once Mode

1. Run `~/.claude/agents/lib/overmind-spark-daemon.sh --once`.
2. Count tick lines.
3. Confirm process exits `0`.

Expected: exactly one tick line is emitted.
