# batch-B3: Wire base→live resolution (+ brain on ambiguity) into the runtime nudge path

## Root Cause
In src/services/overmind/parent-nudge-guard.ts:sendGuardedParentNudge, the local `resolveParentSession` (which calls overmindService.getParentSessionForWorkflow or falls back to coordinator_session) always returned the *raw stored DB value* (a base name like "agj" per B4 intent, or a stale full name like "hris-23" after tmux session cycled).

This raw value was passed directly to:
- `isAgentPane(parentSession)`
- all `send(target, message)`
- consecutive dead counting, orphaned marking, and result returns.

When the stored value had no live tmux match (or was a bare base), isAgentPane returned "no-session" or "bare-bash", suppressing the nudge (or orphaning after H7 threshold). This was the R1/R3 runtime manifestation of the parent auto-detect bug.

The choke point is *only* in the live nudge path (reconcile, idle, artifact failsafe, completion ladder, decision interception, etc.).

## Fix (additive, post-live)
Introduced `makeLiveParentResolver` (new module) that at *nudge time* does:
- `sessions = await listTmuxSessions()`
- `res = selectParentCandidate(stored, sessions)`
- if no session → return stored (let existing no-session/orphan logic run)
- if ambiguous + capture available → consult brain on candidates (capturePane tail); return first "good"
- else return res.session (the live full name chosen by B1 logic)
- **Entire body wrapped in try/catch → return stored on any failure**

Wired via optional `liveResolver?: (stored) => Promise<string>` added to GuardedParentNudgeDeps.

In sendGuardedParentNudge (after local resolve + !failed):
```ts
if (deps.liveResolver && !resolverFailed) {
  try { parentSession = await deps.liveResolver(parentSession); } catch { /* keep */ }
}
```
Everything downstream now uses the (resolved or original) value.

## Per-file WHY + changes
- **NEW src/services/overmind/resolve-live-parent.ts**: Pure composition of B1 (list/select) + B2 (FallbackParentBrain + defaults). Implements makeLiveParentResolver exactly per brief. Defaults brain lazily; capture undefined → deterministic (no brain on hot path = NS6). Full try/catch safety.
- **EDIT src/services/overmind/parent-nudge-guard.ts**:
  - Added `liveResolver?` to interface.
  - After local resolve, perform the await + rebind before any isAgentPane/send. (Minimal, no other logic change.)
- **EDIT src/services/overmind-watcher.ts**:
  - Import + `private readonly liveParentResolver = makeLiveParentResolver({ capturePane: (t) => this.tmuxService.capturePane(t, 30) });`
  - Pass `liveResolver: this.liveParentResolver` to *every* Guarded/derived deps (reconcile, idle-nudge, artifact, decision/ladder, completeness, handleAllTasksDone for completion-detector). One shared instance.
- **EDIT src/services/overmind/nudge-ladder.ts**: Added `liveResolver?` to NudgeLadderDeps (forwarded via `deps` to its internal sendGuarded calls).
- **EDIT src/services/overmind/idle-detector.ts**: Added `liveResolver?` to ArtifactFailsafeDeps (forwarded as-is to sendGuarded).
- **EDIT src/services/overmind/completion-detector.ts**: Added to CompletionDetectorDeps + forwarded explicitly in the two inline send objects (exhaustion + main ladder).
- **NEW tests/overmind-parent-live-resolve.test.ts**: Guard-wiring focused (per brief). Stubs liveResolver + send. Asserts resolved value reaches send + live called. BC test for absent resolver. Error fallback test. (3 tests)

No changes to index.ts, B1/B2 modules, DB, routes, or app (per scope).

## How additive-safety is guaranteed (HARD requirement)
- `liveResolver` is optional in all Deps. When absent (existing tests, any pre-B3 call sites), the if is skipped; `parentSession` value + all downstream calls (isAgentPane, send, returns, orphan logic) are *identical* to today.
- When present: only remaps the local var for this call; never mutates stored DB value.
- Resolver contract (enforced in impl + tests):
  - res.session === null → stored
  - no capture (or ambig=false) → res.session or stored
  - brain consult *only* on res.ambiguous + capture
  - ANY error (list, select, capture, judge, etc.) → stored
- Existing guard suite (6 tests) exercises paths with/without the optional prop → must stay byte-identical.
- No new required ctor args; no behavior change when resolution finds nothing.
- pm2/prod safety: nudge path can never be broken by resolution hiccup.

This satisfies NS2 (post-live additive) + NS6 (brain off hot path).

## Verification
- npx tsc --noEmit: clean
- New test: 3/3 green (R1/R3 + safety)
- Backward-compat: `npx vitest run tests/overmind-parent-nudge-guard.test.ts` = 6/6 green (zero change)
- Brain only fires on ambiguous (code + default capture logic)
- Full try/catch in resolver body
