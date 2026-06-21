# batch-B4: API register/discovery resolves base→live before the parent-status check

## Root Cause
In src/api/routes/overmind-routes.ts register handler (~922), `isAgentPane(match.project.parent_session)` (and parentWarningFor) was called on the *raw stored value* from the project.

If the stored `parent_session` was a bare base name ("agj"), there is typically no tmux session literally named "agj" — only a live "agj-4" (or group match). This caused:
- `isAgentPane` → "no-session"
- normalize → "no-session"
- parentWarningFor → {code: "parent-session-no-session", message naming the raw 'agj'}
Even though a live coordinator was up. Same for bare-bash cases.

This was exactly R5: the API register/discovery path did not use the B1 resolver (unlike the runtime nudge path in B3).

Only one call site for status computation; liveDiscovery lists raw only (left untouched per brief).

## Fix (additive, post-live)
Before calling isAgentPane for parent status:
- resolve stored → liveParent using `resolveParentSession(stored)`
- fallback: any throw from resolve → liveParent = raw stored (additive safety)
- `parentStatus = normalize...(await isAgentPane(liveParent))`
- parentWarningFor always passed the *stored* value (so messages name the configured parent_session; only fired when resolved target also absent)
- response: `parent_session` remains the stored value; when differs, add additive `resolved_session: liveParent`
- default spy in tests makes resolve return session==stored (zero behavior change for existing)

Full live names continue to hit exact match and report identically.

## Per-file WHY + changes
- **EDIT src/api/routes/overmind-routes.ts**:
  - Added import for resolveParentSession (`.js` per project convention).
  - In POST /api/overmind/register (after finding project + registerAttached):
    - Compute liveParent with try { resolution = await resolve...; live = resolution.session ?? stored } catch { live=stored }
    - Use liveParent only for isAgentPane.
    - Warning uses stored (unchanged).
    - Response spreads resolved_session only on difference (additive).
  - normalizeRegisterParentStatus and parentWarningFor untouched.
  - SESSION_NAME_RE untouched (already accepts bases).
- **EDIT tests/acceptance/overmind-projects-api.acceptance.test.ts**:
  - Added import * as parentResolver.
  - In beforeEach: added spy that defaults resolveParentSession to {session: stored, ...} (ensures all prior T12.x unchanged; full names behave exactly).
  - Added 2 focused tests:
    - T12.9: base "agj" resolves to "agj-4" → parent_status from live ("ok"), resolved_session present, no warning, isAgentPane called with live value.
    - T12.10: full live name "agj-99" → resolved==stored (no extra field), status from it, backward exact.
  - Tests use existing harness (project create + registerRun + matchObject + mock checks).

No other files touched (per scope: only routes + test; B1 resolver frozen; no DB, no guard, no app.js).

## How additive-safety is guaranteed (HARD requirement per brief)
- resolve call fully try/catch → raw stored on any failure (listTmux, etc.).
- When resolve returns same session (full names, or no better match) → no `resolved_session` field; response + warnings + status identical to pre-B4.
- When base resolves to live different → status/warning logic uses live for *correctness*, but stored name preserved in public API surface where specified.
- Existing acceptance tests (and their mocks) continue to pass without modification because default spy is identity.
- New fields only appear when actually different (additive, clients ignoring extra keys unaffected).
- No behavior change for "no live found" case (still "no-session", warning names stored).

This satisfies R5 + NS2 (post-live additive).

## Verification
- npx tsc --noEmit: clean
- New R5 tests (T12.9 + T12.10) green
- Full acceptance: tests/acceptance/overmind-projects-api.acceptance.test.ts : 12/12 passed (incl. all prior + new)
- Backward: full live names unchanged; base now correct when live exists.
