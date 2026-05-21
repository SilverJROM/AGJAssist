# Correction — Batch A4, iter 1

**Verdict:** FAIL on gate-2 (functional) + gate-5 (evidence Q5: requirement not observably closed). A4's code is otherwise correct and is PRESERVED — this is a targeted fix, not a redo.

## The gap (mechanism-level)
The watcher loop runs live, but `tmuxService.capturePane(coordinator_session)` **throws** for a bare session name and `OvermindWatcher.capturePaneSafe` swallows it → every pane reads as `""`. Proven: I registered a workflow with `coordinator_session='ovm-build'` (a live codex session) and after a tick `last_pane_hash` = `e3b0c44298...b855` = SHA-256 of the **empty string**.

Direct repro against built code:
```
capturePane('ovm-build') → THROWS: "Invalid tmux target. Use format session:window.pane"
```
`src/tmux/tmux-service.ts` `ensureValidTarget()` only accepts `session:window.pane`. But overmind registers coordinators (and children) by **bare session name** (`hris-d-22`, `lkcamp-12`, `lkvc-38`, `ovm-build`) — which is a legitimate tmux target (`tmux capture-pane -t <session>` captures that session's active pane). So overmind can never read any pane → classification is meaningless and (later) nudging would mis-fire.

## The fix (exactly this, nothing more)
1. **Allow bare session names as tmux targets.** In `src/tmux/tmux-service.ts`, extend `ensureValidTarget()` to ALSO accept a bare session name (e.g. `^[A-Za-z0-9_.-]+$`) IN ADDITION to the existing `session:window.pane` form. Keep it injection-safe (execFile array args already are; this is format validation only). Do NOT remove or weaken the existing accepted format — only widen.
2. Confirm `capturePane(bareSession)` then returns real content (tmux resolves a bare session to its active pane).
3. Keep `capturePaneSafe`'s catch (defensive), but it should no longer be hit for valid live sessions.

## Tests to add/extend
- Extend the tmux-service test (or add one): `ensureValidTarget` ACCEPTS `"ovm-build"`, `"hris-d-22"`, AND still accepts `"sess:0.1"`, and still REJECTS obviously bad input (empty, spaces, shell metacharacters).
- Run the EXISTING tmux-service tests too — they must stay green (this is shared infrastructure used by /peek, /tmux_send).
- `npx tsc` clean.

## Preserved (do NOT redo)
- All A4 Telegram commands, the watcher start() wiring, index.ts changes, overmind-commands tests. Untouched.

## Re-verification projcore will run after your DONE
pm2 restart, then read the `smoke-A4` row (coordinator_session=`ovm-build`): `last_pane_hash` must be a REAL hash (not the empty-string SHA) and status must reflect actual pane state. So make sure the live capture works end-to-end.

## Completion
- Append callback FIRST: `[projcore callback] A4 DONE <note>` (after fix), THEN reply.
- End with STATUS: DONE -- <reason>. This is correction iter 1.
