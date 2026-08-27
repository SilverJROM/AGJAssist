# Decision — A0 acs no longer A5; FENCE_STUB not yet in-process

Date: 2026-08-27 · `[projcore]` · north CHANGES-REQUESTED after A0 stall (rev2 approval VOID).

1. **acs:** A0 `acs` was `A5`. Validator gated on product A5 and failed identically at three seats. Changed to `HARNESS-SMOKE`. Product A5 remains B4/B8/G1/G2. Tests cell is `--harness-smoke`.

2. **FENCE_STUB on recovered HEAD (3439337):** NOT in-process. `scripts/cc-run-isolated.mjs` still `startStubProxy` (HTTP proxy :3210→:3211, B2 handler only). That is INTERCEPTION_GAP. A0 remaining work after re-approval: replace the proxy with Fastify in-process preload. Coordinator did not implement it (HOLD tiller; no product edits beyond plan artifacts).

3. Tiller stays stopped (SIGTERM rc=143 was the HOLD). No resume until `plan-approval.md` is `APPROVED-BY-NORTH` again.
