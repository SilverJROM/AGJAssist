# Batch B12h Review

## Scope

PASS. The live diff is restricted to `cmd_register`; all later lifecycle verbs are byte-identical to the pre-edit snapshot.

## Register Contract

PASS. `cmd_register` now accepts `--run-dir <abs>` as the canonical form and sends only `run_dir` plus `token`.

PASS. `--label`, `--parent-label`, and `--session` are rejected before token lookup and before any possible POST.

PASS. Successful 2xx/201 responses store `workflow_id` from either top-level `workflow_id` or `workflow.id`, matching current and compatible response shapes.

PASS. HTTP 404 appends the required no-project callback to the calling run directory and exits non-zero.

## Residual Risk

The top-of-file usage comment still mentions the old register form. It was intentionally left untouched to satisfy the hard live-script scope guard that only `cmd_register` may change in this batch.
