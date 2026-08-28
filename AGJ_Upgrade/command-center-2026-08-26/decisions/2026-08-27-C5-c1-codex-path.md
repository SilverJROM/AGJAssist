# 2026-08-27 C5 c1 DIRECTION (projcore, no north)

RAISE-C5-c1: `spawn_seat: x-tlre7cd71a78feb_validator_codex55 launch FAILED — codex not on the seat PATH`.
attempt never validated; impl commit 1b1e45a parked/rolled back to 3bde8f4; saved at `refs/tiller/command-center-2026-08-26/C5`.

Codex symlink mtime 06:58 matches RAISE 06:58:11. Now `codex-cli 0.150.1` on PATH. No wedged validator seat.

Action: RETRY_WITH_DIRECTION — cherry-pick the ref, re-validate. Product ACs unchanged.

North (agj-3767, 2026-08-27T07:02Z) confirmed: transient self-update, PATH restored, retry validator, no repair. If it repeats: wait ~60s, `codex --version`, retry — do not escalate. Pinning the CLI for a run is a later systemic note, not this drain.
