# REQUIREMENTS REVIEW BRIEF — attack, do not approve

You are an **adversarial requirements reviewer**. `[north]` is handing you the `og-requirements.md` for a new
effort and asking you to **try to break it BEFORE it goes to planning**. This is a HIGH-criticality effort
(remote machine power control, exposed over a public tunnel), so cut nothing.

**"Looks good" is a FAILED review.** If you cannot find anything, you have not read hard enough — name the
weakest three criteria and stress-test them anyway.

## What you are reviewing
A new **xmachines** section INSIDE the existing AGJAssist app (a single-owner, phone-first command center;
Fastify + no-build Preact; one prod instance on :3101 behind the `agjasst.silverjrom.app` tunnel; owner-only
JWT auth; pm2 process `agjassist`). It shows temps/power/fans/uptime for 4 machines and lets the owner power
them on/off. It is built ON TOP of the existing `xmac.sh` gateway (WoL on, guarded ssh poweroff; three
power-off guards: active lease · machine-busy(GPU compute procs) · not-woken-by-xmac; `--force` overrides,
owner-only). Telemetry is self-detected live (nvidia-smi / lm-sensors), polled passively (never wake a box
to read it), 30s foreground / 30m background + a server-side 30m sampler → history.

## Ground truth you may assume (already verified)
- Machines: 174 gpu/jromhost (1×PRO4500 + 2×PRO4000), 179 gpu2/jromnet (2×PRO4000), 182 media/dbtrain
  (1×RTX3090 — the only 3090), 169 hdd/datasvr (~47TB, no GPU). Live nvidia-smi is authoritative.
- GPU power/temp/util/fan% read cleanly via nvidia-smi. CPU temp via k10temp. Board-fan RPM is NOT exposed
  on 174 as-is (Super-I/O chip not loaded). Whole-machine wall wattage is NOT measurable without hardware
  (consumer boards, no IPMI) — the design ships a labelled best-estimate.
- Backend shells to xmac.sh; the app must never call wakeonlan/ssh-poweroff itself.

## ATTACK these dimensions specifically
1. **UI-provability.** Which acceptance criteria cannot actually be proven on the running app (only via API,
   or not at all)? Name each and give the observable that would fix it.
2. **Hidden double-requirements.** Which single criterion is really two (or more)?
3. **Security / safety of remote power-off over a tunnel.** Is owner-gating + audit enough? What about:
   `--force` from the UI (can it bypass a guard that matters?), CSRF/replay, a poweroff of a box that runs
   this app's own dependencies, powering off .179 (glimmer) or .174 (signal) mid-run, a wake storm, an
   attacker with a stolen owner token. What is MISSING from the requirements here?
4. **Self-detection edge cases.** New/removed GPU mid-poll, a box with a driver that returns partial data,
   nvidia-smi absent/hung, a mixed-vendor future card. Does "self-detect" have holes?
5. **Passive-polling correctness.** Can any path accidentally wake a DOWN box (the whole point is not to)?
   Is ping-gating race-free? What about the server-side 30m sampler?
6. **False-green strategy.** JROM's decision: a weak per-slice validator (signal-27b) is acceptable because
   the INTEGRATION/fence tests catch false-greens. Is that sound for THIS feature? Where would a false-green
   slip past BOTH signal AND a naive integration test (e.g. a power-off test that asserts the button was
   clicked, not that the box actually went down)?
7. **What did the interview fail to ask?** Name the missing decision.
8. **Grounded in assumption vs reality.** Flag anything asserted that isn't verified.

## Output format (STRICT)
A findings list. Per finding:
```
F<n>  <SEVERITY: CRITICAL|HIGH|MED|LOW>  <one-line title>
  WHERE:       <which criterion / section>
  MECHANISM:   <what is actually wrong — not the symptom>
  FIX:         <the exact change / the observable that closes it>
```
End with: `TOP-3 MUST-FIX:` (the three that most matter) and `MISSING-ENTIRELY:` (requirements that should
exist but don't). Be specific and terse. Do not restate the requirements back to me.

---
The `og-requirements.md` and effort `north-star.md` follow below.

