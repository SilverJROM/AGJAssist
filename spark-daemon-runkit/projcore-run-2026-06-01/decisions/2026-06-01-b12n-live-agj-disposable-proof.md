# Decision — B12n Live AGJ Disposable Proof

Use live `:3101` for B12n because read-only probing proved `/api/overmind/projects` is present on the running server (`401` unauthenticated, `200` with loopback token).

Create or verify the persistent live `AGJ` project, then prove T12.10 with a separate disposable workflow under `/home/agjrom/TGBOTS/AGJAssist/tmp/`. Delete only the disposable workflow after evidence capture.

Literal re-registration of `wf=4` is deferred by design. `wf=4` is the active supervisor run and re-registering a live-monitored workflow risks duplicate/orphan state. The disposable-run attach is the safe T12.10 equivalent because it exercises the same live server, AGJ project, app-path match, and attach-by-run-dir path without mutating `wf=4`. The real `wf=4` attach should happen naturally on its next clean registration after the R12 deployment path is settled.

Outcome: AGJ project `id=4` created; disposable workflow `13` attached then deleted; AGJ remains; `wf=4` remains unmodified.
