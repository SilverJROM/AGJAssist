# D-2026-09-25 — Topology contract + criticality (xmachines)

_Logged by `[north]`. High-fidelity per north's decisions discipline._

## planning_criticality = HIGH
Remote power-off is irreversible (a wrong shutdown kills a running job; recovery may be a physical walk to the box) and is exposed over a public tunnel. Therefore:
- **requirements_reviewers ENGAGED** (not skipped): `grok` + `sol`, before the docs go to planning. (north-planning.md: high criticality ⇒ pull them in.)
- **red-team** on architecturally-significant batches (power-control paths, auth, the sampler).
- Planning-stage deliberation panel is gated behind explicit JROM approval (HIGH, not CRITICAL) — projcore surfaces a one-line offer and proceeds with the 2 co-planners otherwise.

## Topology = JROM's custom roster (interview 2026-09-25)
Verified live-runnable 2026-09-25 (all local seats UP): glimmer-pipe :8427, signal .174:8110, glimmer router .140:48731.

| Role | L1 | L2 | L3 |
|---|---|---|---|
| Implementer | glimmer (`muse-glimmer-30b`, local/unmetered, via meter_shim :8427→.179) | grok47 (`grok-4.7`) | sonnet5 (`claude-sonnet-5`) |
| Validator | signal (`signal-27b-4500`, local/unmetered, .174:8110) | codex55 (`gpt-5.5`) | opus5 (`claude-opus-5`) |

- **co_planners** = opus5 + sol (the "planner = sol + opus" from the interview).
- **coordinator / escalation brain** = grok47 (`grok-4.7`). NOTE: this overrides the standing "coordinator = Opus" default — JROM's explicit choice; logged.
- **integration** = sonnet5 for implement, opus5 to validate complex ones. (There is no schema "integration" role; integration/fence rows implement at L3 and validate at L3. `opus` never IMPLEMENTS — so integration lands on sonnet5, opus validates. This resolves the interview's "integration = sonnet5/opus by complexity.")

### Deviations from the standing default roster — logged (required by the contract)
1. **Implementer L1 = glimmer** (not template's `spark`). Matches north's current glimmer-first regime.
2. **Implementer L2 = grok-4.7** (not `grok-4.5`).
3. **Validator L1 = signal (local 27B)** (not `codex55`). ⚠️ See O3 below — the contract explicitly bans weak validators (measured: haiku PASSed an impossible slice; a false-green). Stamped per JROM's explicit choice; flagged for confirmation.
4. **sol dropped from the validator ladder, replaced at L2 by gpt5.5** (JROM: "drop sol and replace with gpt5.5"). sol is now planner-only — which also cleanly removes sol's self-grading path (it never validates).
5. **No L4 validator** (sol was the only L4; L4 is optional/additive — omitted).
6. **Local seats are UNMETERED** — glimmer/signal don't draw a provider bucket. `agent-usage.sh` governs only the metered seats (grok47/sonnet5/opus5/codex55/sol). Operational dependency: the local seats need their GPU boxes UP — **this effort controls machine power, so never power off .179 (glimmer) or .174 (signal) while the run is live.**

## RESOLUTIONS (JROM 2026-09-25)
- **Deploy → BRANCH + OWNER-GATED.** Work on `feat/xmachines`; verify on a LOCAL instance (build + Playwright); NO prod `pm2 restart agjassist` until JROM approves at the end (og-requirements K1/K2). Rationale: the live app is JROM's active command center + hosts north's own escalate wire — a mid-run restart risks both.
- **Scope → EVERYTHING (A–J + all extras I1–I5).** Alerts, hdd SMART/disk panel, UPS (NUT), cost estimate, WoL-safe indicator all IN this build. Larger effort; plan will batch accordingly.
- **Mandate → autonomous to completion.** JROM: "continue this to completion." north runs requirements review → handoff → plan gate → drives to done; only TRUE BLOCKERS reach JROM on the wire; north reports at completion + for deploy approval.
- **O1 → STANDING.** Red-team is the independent gate; co-planners may double as validators (conflict-accepted, 2026-07-30). No stricter validator≠planner guard for this effort.
- **O2 → OFF.** `supervision.yaml` stamped `enabled: false`.
- **O3 → KEEP signal at validator-L1.** `default_validator_tier` remains L2=codex55, so signal gates only explicitly-routine batches. **JROM refinement: "the false green should be captured on integration tests."** So the correctness guarantee is not signal's per-slice green — it is the INTEGRATION/fence e2e over grouped siblings (og-requirements J1). This makes a light per-slice validator acceptable *provided the fences assert real outcomes* (not empty-green). north enforces meaningful fence groupings + real assertions at the plan-approval gate (north.md fence-grouping duty; `--expect-red`/empty-manifest trap).
- **Scope → ONE app.** xmachines is a section inside AGJAssist; no new app/port/tunnel/deploy target.

---

## O1 — Self-grading policy (RESOLVED → STANDING, see above)
The standing contract (team-topology-contract.md, JROM 2026-07-30) states, verbatim intent: co-planners deliberately double as validators (opus5 co-plans AND gates L3; sol co-plans AND gates L4), **"CONFLICT ACCEPTED, DO NOT RE-RAISE PER RUN,"** mitigated because the **red-team seats are the only ones that did not co-plan** — so red-team is the genuinely-independent gate.

In THIS conversation JROM ok'd a stricter guard: **a batch's validator ≠ its planner** (opus never validates/integrates a batch it planned). Since opus co-plans every batch here, that guard effectively removes opus-L3 on planned work and leans on codex55 + red-team.

They largely converge (both rely on red-team as the independent gate). north's recommendation: **adopt the standing approach** (conflict-accepted + red-team on significant batches) — it is tested and already JROM-ruled — UNLESS JROM wants the stricter guard for this security-sensitive effort. **Pending JROM.**

## O2 — Guardian supervision (OPEN)
Default OFF (silent no-op). Ask once. For an attended, foreground effort OFF is fine; recommend ON only if this will run overnight/unattended.

## O3 — validator-L1 = signal capability (OPEN)
Confirm signal-27b is a real gate, not a rubber-stamp, given the contract's measured false-green rule. If it's too light, validator-L1 reverts to codex55 (with signal usable as a cheap first-pass advisory only).
