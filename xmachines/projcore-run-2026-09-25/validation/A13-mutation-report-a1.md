# A13 mutation report

Gateway under test: `~/.config/agent-protocols/lib/xmac.sh`
git `acacd22e64fdab0fa3a7cdba7868ee053d177e75` (repo `agent-protocols`)
sha256 `006eaffd3f4f084a3c3e174b2b0ada95b26bb1795b2a3b86abfa3170f278a304`

Spy: `bash tests/xmachines/xmac-owner-off-gateway-spy.sh`
Fixtures only: `XMAC_CONF` and `XMAC_STATE` under `mktemp`, host `192.0.2.169`. No live host.

## Expected flips

Chosen before the mutation was applied, as literals (not taken from the mutated run):

- already-leased
- L2c

## Mutation

One edit, on a copy of `lib/xmac.sh` invoked as `XMAC_SH=/tmp/a13-xmac-mutated.sh`. The live file was not edited.

The owner-off body (lease read, fail-closed busy, lease re-read, guard-3 skip, poweroff) was replaced with blanket force, then execution falls through to the default `down` path:

```bash
  if [ -n "$owner_off" ]; then
    force=1
  fi
```

A `force=1` written only on the guard-3 skip line cannot flip `already-leased` or `L2c`: both die earlier in that same branch. Blanket force is the rewrite that reaches those two cases, which is what L2d forbids.

## Unmutated spy

Command: `bash tests/xmachines/xmac-owner-off-gateway-spy.sh`
Exit: 0

```
PASS L1b injected_rc=124 exit=1 poweroff=0 force_argv=0
PASS L1c injected_rc=1 exit=1 poweroff=0 force_argv=0
PASS L1d injected_rc=255 exit=1 poweroff=0 force_argv=0
PASS L1-control injected_rc=0 exit=0 poweroff=1 owner-off-logged
PASS L2b-late-lease exit=1 poweroff=0 force_argv=0
PASS already-leased exit=1 poweroff=0 force_argv=0
PASS L2b-negative exit=0 poweroff=1 owner-off-logged
PASS L2a exit=0 poweroff=1 owner-off-logged
PASS L2a-default-down exit=1 poweroff=0 guard-3-refused
PASS L2c exit=1 poweroff=0 force_argv=0
RESULT fails=0
```

`XMAC_SH=/nonexistent/xmac.sh` exits 1: `FAIL: gateway not found at /nonexistent/xmac.sh`.

## Mutated spy

Command: `XMAC_SH=/tmp/a13-xmac-mutated.sh bash tests/xmachines/xmac-owner-off-gateway-spy.sh`
Exit: 1 (`RESULT fails=34`)

Observed flips against the literal set above:

| case | unmutated | mutated |
| --- | --- | --- |
| already-leased | exit 1, poweroff 0, stderr names `xmac-claim-hdd-17-transcript-archive` | exit 0, poweroff 1, `xmac.log` contains `force=1` |
| L2c | exit 1, poweroff 0, stderr contains `rsync -a /vault /backup` | exit 0, poweroff 1, busy literal absent, `force=1` |

Both flipped from refuse to poweroff. The same run also sent L1b, L1c, L1d, and L2b-late-lease to poweroff. `L2a-default-down` (plain `down`, no `--owner-off`) stayed a guard-3 refusal with poweroff 0.

## Revert

Live `lib/xmac.sh` sha256 after the mutated run equals the sha256 above. The copy was discarded. The unmutated spy was re-run on the reverted gateway and exited 0 (output in the unmutated section).

## Discrimination

- L1: injected busy-probe rcs are the literals 124, 1, and 255, each with empty stdout. All three refuse with poweroff count 0. The same empty stdout with literal rc 0 (`L1-control`) reaches poweroff. A blanket empty-output refusal would fail the control. An rc-blind check would fail the three refusals.
- L2b: the ssh spy creates `xmac-claim-hdd-17-transcript-archive` only while handling the busy probe. That run refuses, names the lease file, says `after busy check`, and has poweroff 0. The identical run with `LEASE_ON_BUSY=0` (`L2b-negative`) reaches poweroff. The already-leased run refuses at guard 1 (no busy probe, no re-read text).
- L2a: `woke-by-xmac/hdd` absent, owner-off reaches poweroff and the log says `owner-off`. Plain `down` in that state refuses with `was not started by xmac` and `Pass --force`, poweroff 0.
- L2d: every owner-off case has `--force` argv count 0, no `pass --force` hint on stderr, and no `force=1` in `xmac.log`. The mutation above is what makes `already-leased` and `L2c` power off.

## Assumptions

- `XMAC_DOWN_TIMEOUT=6` and the ping spy reports down after a poweroff argv, so the product wait loop can finish. The poweroff count is the spy log, not the wait.
- `XMAC_CALLER=a13-gateway-spy` so identity does not call tmux.
- The force-hint check is case-insensitive `pass --force`, because the default path emits `Pass --force`.
