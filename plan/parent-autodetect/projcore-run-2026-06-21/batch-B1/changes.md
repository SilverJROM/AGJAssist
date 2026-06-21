# batch-B1: Pure parent-session resolver + unit tests

## Root Cause / Mechanism
AGJAssist stored exact tmux session names (e.g. "agj-4") in overmind_projects.parent_session. When tmux restarts the numeric suffix changes (agj-51 → agj-4), nudges broke because there was zero resolution logic. `resolveParentSession` (internal to guard) and `isAgentPane` were passed the raw stored string directly. No base-name handling, no use of `session_group`, no exclusion of child agent sessions (lkvc-grok etc. which carry the base in their name but have empty group and must never be chosen as parent).

This batch delivers the **pure** deterministic resolver only (no wiring to guard/watcher/DB — B3+). Uses verified live signal: real parent/coordinator sessions have `session_group == base`; child sessions have empty group + child-role name suffixes.

Algorithm (exact per brief):
1. `base = deriveBaseName(stored)`
2. EXACT fast path: live name === stored AND not child-role → return it.
3. GROUP: sessions with group===base, exclude child-role names. Rank attached desc, then activity desc. Take top.
4. (fallback) PREFIX: name===base or matches /^base-\d+$/ (digit suffix only), exclude child names. Same rank.
5. none otherwise.
6. `ambiguous = true` iff >=2 candidates (in the set) are attached.

`listTmuxSessions` is thin exec + parse (never throws, [] on error). `resolveParentSession` composes it.

All functions pure where required; outcomes asserted.

## Per-file WHY
- **src/services/overmind/parent-session-resolver.ts** (new): The complete home for R1/R2/R3. Exports exact interfaces + 4 functions. Child-role logic uses one documented regex (CHILD_ROLE_RE) + derive helper. select implements the ordered algorithm + rank + ambiguous exactly. listTmuxSessions mirrors the execFile style from agent-pane.ts for consistency and robustness. No deps on guard or other overmind code. Zero side effects in core logic.

- **tests/overmind-parent-session-resolver.test.ts** (new): Fixture-driven (zero real tmux). Covers every required case + supporting rank/ambiguous/child-skip. Asserts the full returned object (session/method/ambiguous/candidates/base) per "assert OUTCOMES" rule. Directly proves R1/R2/R3.

Scope strictly limited: no edits outside src/services/overmind/ + tests/. No TODOs, no shims, no follow-ups. Post-live quality.

## Evidence of green
- `npx tsc --noEmit` clean
- `npx vitest run tests/overmind-parent-session-resolver.test.ts` → 10 tests passed
- All cases from brief acceptance criteria exercised with exact expected results.
