# Decision — B12n Live AGJ Disposable Proof

## Decision

Use the live `:3101` server for B12n because read-only probing proved `/api/overmind/projects` is present on the running server:

- unauthenticated GET returned `401`
- loopback-token GET returned `200`

Create or verify the real `AGJ` project on live, then prove T12.10 with a separate disposable run under `/home/agjrom/TGBOTS/AGJAssist/tmp/`. Delete only the disposable workflow after evidence capture.

## Why not literally re-register `wf=4`

Literal re-registration of `wf=4` is deferred by design. `wf=4` is the live supervisor run for this projcore execution and is actively monitored by the running overmind instance. Re-registering that live-monitored run during B12n risks duplicate workflow rows, orphaned identity, or watcher confusion.

The disposable-run attach is the safe T12.10 equivalent because it exercises the same real server, real AGJ project, real app path matching, and real attach-by-run-dir code path without mutating the supervisor workflow. The real `wf=4` attach should happen naturally on its next clean registration after the R12 deployment path is fully settled.

## Outcome

- AGJ project created on live as project `id=4`.
- Disposable workflow `13` registered and attached to AGJ.
- GET showed AGJ `active_runs_count=1` during proof.
- Disposable workflow `13` was deleted.
- AGJ project remains.
- `wf=4` remains unmodified.
