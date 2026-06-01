# B12o Changes

User report:

> New batch - read+execute IN FULL (real handshake): `batch-b12o.md` consolidated acceptance T12.1-T12.5.

Root cause mechanism:

The prior B12 project/register behaviors were covered by per-batch route and script tests, but there was no single durable acceptance spec that re-ran T12.1-T12.5 together against an integrated app.inject harness with a temp DB.

Changes:

- Added `tests/acceptance/overmind-projects-api.acceptance.test.ts`.
- Added B12o batch artifacts under `spark-daemon-runkit/projcore-run-2026-06-01/batch-b12o/`.

Caveats:

- The client callback assertion executes the checked-in B12h `overmind.sh` snapshot against a local stub server returning 404. It does not require live `:3101`.
