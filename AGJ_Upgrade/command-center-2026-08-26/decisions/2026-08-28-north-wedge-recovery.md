# 2026-08-28 north RUN WEDGED recovery — not wedged; no kill/resume

North snapshot was behind the live drain. Checked 2026-08-28T05:12Z.

## North claimed vs observed
| claim | observed |
|---|---|
| HEAD b1d8258, log frozen 147 lines, no new seat | HEAD **2459e93** `[D0] Reduce E1 poll budget…`; driver.log **150** lines ending D0 a1 role_done + validator spawn; val `x-tlre7cd71a78feb_validator_codex55` **working** |
| driver 1679354 STALLED 180s, not consuming DIRECTION | 1679354 **alive** (child of monitor 1679333); inside D0 a1 validate. DIRECTION apply is top-of-loop — unapplied SKIP/RETRY files wait until D0 yields. DIRECTION-D0-a4 already **applied/unparked 04:56:36Z** |
| tiller.pid 2805424 STALLED/done:5 | pidfile **1679333**, STATUS **NOMINAL 32/41** |
| three concurrent impl_glimmer orphans of this run | **this run:** `x-tlre7cd71a78feb_*` only. `x-tlre093e95f7fd0` cwd **lkAsst**. `x-tlrfa6c37db1133` cwd **lokalAI-v2**. Not ours. |

## Actions taken
- **Did not** tmux kill-session foreign glimmer/validator (would starve those runs, not free our lease).
- **Did not** kill this run's working validator or idle impl (D0 gate in flight).
- **Did not** `tiller resume` — live driver already owns the tree; resume refused / would start a second writer.
- Monitor not restarted — already tracking 1679333.

Forward motion confirmed: commit 2459e93 + validator pane "Working".
