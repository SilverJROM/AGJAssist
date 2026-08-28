# [driver] AUTHOR A REPAIR TEST — unit E3, fence E5 (run command-center-2026-08-26)

The integration checkpoint for fence **E5** FAILED, and you identified **E3** as a
contributor that does not compose. Your job now is NOT to fix it. Your job is to write the test
that defines what 'fixed' means, so the implementer cannot write one that fits its own bug.

## The failure you are pinning down
- Seam fingerprint: `fp1:4c534f69e7dd8f2fd157`
- Acceptance ids failing at the checkpoint: D1, D2
- Unit scope: API layer: owner-only `registerAgentWakeupRoutes` for schedule, pending read, and cancel; non-owner, invalid/past times, empty actions, and cross-pane access fail-closed.
- Unit ACs: D1,D2

## Write ONE unit test
1. It targets **E3 only** — not the whole journey. The checkpoint already covers the journey.
2. It must FAIL ON CURRENT HEAD, and fail by a NAMED ASSERTION — not by an import error, a missing
   fixture, a wrong path or a missing env var. The driver checks this and will REJECT a test that is
   merely un-runnable: red for the wrong reason proves nothing, and lets an implementer 'fix' the
   test setup while the product stays broken.
3. Assert the OUTCOME the checkpoint needs from this unit, not that a call was attempted.
4. Do NOT weaken the checkpoint, and do NOT edit any file under the fence's integration test.
5. Commit it. It will be HASH-LOCKED: if the implementer alters or deletes it, the unit cannot pass.

## Emit (MANDATORY — first tool call in your reply, before any prose streams)
Append to /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md:
`[projcore callback] validator E3 STATUS: DONE — repair test authored`
then a plain line:
`[REPAIR-TEST-V1] fence=E5 unit=E3 path=<repo-relative path> cmd=<command that runs JUST this test and writes fence-report-v1.json>`

The command must emit `fence-report-v1.json` in the same shape the checkpoint uses (`FENCE_ID=E5 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs` is the checkpoint's own).
