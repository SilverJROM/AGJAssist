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

# og-requirements — xmachines (AGJAssist)

_Authored by `[north]` 2026-09-25. Seeds the validator's Q0 + the req-matrix. Acceptance criteria are phrased to be **UI-provable on the running app** (agjasst.silverjrom.app / :3101), not API-only._

Inherits: `AGJAssist/north-star.md` (project) + `./north-star.md` (effort).

---

## Verbatim problem statement (JROM's words)

> "i want do add an additional section on the app xmachines, where i can see remotely on/off the machines 182, 174, 179, 169, (w/ a limit that if the gpu's are busy i cant turn it off), see the cpu, gpu temps, also the machine temps, machine wattage, gpu wattage/busy, etc and give me suggestions of what else i can add. basically have a main window where i can see the temps power, etc and drill down inside and see more details and turn it on/off from the app."

Clarifications given in interview (2026-09-25):
- "if we cant reliably pull the wattage best estimate is fine"
- "i also want the detail on how long the machine is turned on"
- "can we have this as self detect rather than hardcoded? so that i can add new gpus and would still work"
- "if we can have a detection on the fans as well connected to the board and their speed show it on the app as well"
- "lets do an update of every 30mins if the window on the app is not active … but every 30 secs if the app on that window itself is active"

## Non-negotiable scope constraint — ONE app (JROM 2026-09-25)
xmachines is a **new section INSIDE the existing AGJAssist app**, NOT a standalone app. It reuses the same Fastify server (:3101), the same no-build Preact app (`src/web/public/app.js` + `style.css`), the same pm2 process (`agjassist`), the same `npm run build` + `pm2 restart` deploy, the same owner JWT auth, and the same Telegram mini-app shell. **No new app, port, tunnel, deploy target, or process is created.** Provable: after deploy, `#/xmachines` is a route within agjasst.silverjrom.app; nothing new is listening or deployed elsewhere.

## The four machines (registry = ground truth, live-verified 2026-09-25)

| xmac name | ip | hostname | GPUs (live) |
|---|---|---|---|
| `gpu`   | 174 | jromhost | 1× RTX PRO 4500 (32GB) + 2× RTX PRO 4000 (24GB) |
| `gpu2`  | 179 | jromnet  | 2× RTX PRO 4000 (24GB) |
| `media` | 182 | dbtrain  | 1× RTX 3090 (24GB) — the fleet's only 3090 |
| `hdd`   | 169 | datasvr  | none (~47TB data server) |

## Foundational decision — build ON TOP of `xmac.sh`, do not reimplement power control
Power on = WoL, power off = guarded ssh poweroff, both already deterministic + logged in `~/.config/agent-protocols/lib/xmac.sh`. The app's backend service **shells to that gateway**; it never calls `wakeonlan`/`ssh poweroff` itself. This preserves the invariant that xmac is the only thing that powers a box off, and reuses xmac's three power-off guards (lease · machine-busy · not-woken-by-xmac).

---

## Acceptance criteria (numbered, UI-provable)

### A — Section & navigation
- **A1** A new top-level section **xmachines** is reachable from the desktop nav (`Header`) and the Telegram mini-app; it appears as **a tile on the mini-app home grid** alongside the existing Tasks / Notes / Terminals / Projects / Reminders / Settings tiles (e.g. "xMachines · 4 machines"), and a fresh load of `#/xmachines` renders the section (added to `KNOWN_EXACT`), not the landing page. Same `@AGJ_AIBOT` app shell.
- **A2** The section is **owner-only**: a non-owner session cannot see the nav entry nor load the route; every backend route is `preHandler: [authMiddleware, requireOwner]`. Provable: a request without an owner JWT returns 401/403.

### B — Main window (fleet overview)
- **B1** The main window lists all four machines with, per machine: power state (UP/DOWN), and when UP — aggregate GPU temp(s), aggregate/estimated power draw, and uptime. Down machines render as "offline" without error.
- **B2** State encodes at a glance (pill/chip/severity stripe), e.g. a GPU over a thermal threshold reads as warning/critical without reading the number.
- **B3** Values that are **measured** vs **estimated** are visually distinguished (e.g. `200 W` vs `~140 W`), so no number looks more precise than it is.

### C — Drill-down (per machine)
- **C1** Selecting a machine opens a detail view showing **per-GPU** rows: name, utilisation %, VRAM used/total, temperature, power draw (W), fan %. (Multi-GPU boxes show every card.)
- **C2** CPU temperature (via `lm-sensors`/`k10temp`) and any board/chassis **fan RPMs the box exposes** are shown; where a box's Super-I/O fan chip is not readable, fans are absent gracefully (no error, no fabricated value).
- **C3** Uptime is shown two ways: **OS uptime** (since boot) and **power-session** (how long since xmac last woke it, from `xmac.log`), plus **total on-hours** feeding a cost estimate.
- **C4** The detail view shows **what is keeping the box busy** (the xmac `busy_check` output + any held agent lease), so a disabled power-off is self-explanatory.

### D — Power control + guards
- **D1** From the app the owner can **power a machine ON** (WoL via xmac). Provable: a DOWN box transitions to UP after the action.
- **D2** The owner can **power a machine OFF**, and the action is **refused with a shown reason** when any xmac guard fires (active lease · machine reports busy — including GPU compute processes · not woken by xmac). Provable: a box running a GPU compute process shows power-off disabled/blocked with the busy reason.
- **D3** A **force override** exists but is owner-only, requires an explicit confirm, and is audited. (`--force` authority is JROM's alone per the xmac contract.)
- **D4** Every power action (on/off/force) writes an **audit_log** entry (owner-attributed) and is visible in the existing audit trail.

### E — Self-detection (no hardcoded inventory)
- **E1** GPU inventory is discovered live per box via `nvidia-smi` at poll time — adding/removing/swapping a card changes the UI with **no code or config change**. Provable: the UI matches live `nvidia-smi -L` on each box, not the registry's text description.
- **E2** CPU sensors and fans are likewise discovered via `lm-sensors`; the UI shows whatever the box exposes.

### F — Cadence, passivity & history
- **F1** When the xmachines window is **active + visible**, live values refresh every **30s**; when the section is backgrounded (other route or tab hidden), the frontend drops to **30m**.
- **F2** A **server-side sampler** collects metrics on a **30m** cadence independent of any browser, persisting to a history store, so sparklines/trends keep filling with the app closed.
- **F3** **Passive polling — never wake a box to read it.** The collector reads only boxes already UP (ping/status-gated); it must not use any auto-waking path (`xmac run` on a DOWN box). Provable: a DOWN box left untouched stays DOWN across polling cycles.
- **F4** Per-metric history is viewable as a sparkline (temp/power/util over time).

### G — Power/wattage (best-estimate, labelled)
- **G1** GPU power draw is the **measured** `nvidia-smi power.draw`. CPU/rest is **estimated** (CPU package where available + a per-box baseline + PSU-efficiency factor for wall draw) and labelled as estimated per B3.
- **G2** Where no reliable wall-power source exists, the best-estimate is shown (not omitted); if a smart-plug/UPS metering source is later added, the measured reading replaces the estimate without a UI change.

### H — Security & data safety (project bedrock)
- **H1** All control paths owner-gated + localhost-origin-aware + audited (project north-star bedrock #4).
- **H2** Any new DB table is **additive-only** (bedrock #5).

### I — Additional features (IN SCOPE this build — JROM 2026-09-25: "Everything")
- **I1** Thermal / fan-fail / won't-wake **alerts** routed through the existing owner notify path (Telegram), de-duped.
- **I2** `hdd` disk panel: SMART health, per-disk temp, free space across the ~47TB.
- **I3** UPS panel (NUT): battery %, runtime, load — where a UPS data source exists.
- **I4** kWh + cost estimate from power over time.
- **I5** WoL-safe indicator per box (cold-wake verified?) so the owner knows a power-off is recoverable before clicking.

### J — Test integrity (false-green backstop) (JROM 2026-09-25)
- **J1** The **INTEGRATION / fence tests** over grouped slices are the correctness backstop for the local per-slice validator (signal). Each fence asserts a **real observable outcome** — state reached, value actually rendered in the UI, a power action reflected in xmac/`nvidia-smi` — never an empty manifest, an attempt-only assertion, or a test that is green because it covers nothing. Provable: a deliberately broken slice makes its owning fence go RED. Rationale: a false-green that slips past signal at slice level must be caught at integration, so the fence groupings must track real capabilities (north reviews this at the plan gate).

### K — Delivery: feature branch + owner-gated deploy (JROM 2026-09-25)
- **K1** All work lands on a **feature branch (`feat/xmachines`)**; **nothing deploys to the live app until JROM approves.** projcore/tiller verify on a **local instance** (build + local smoke + Playwright against a local :3101/static instance), not by restarting prod.
- **K2** The prod deploy (`npm run build` + `pm2 restart agjassist`) happens **only on JROM's explicit deploy approval** at the end — never mid-run. Provable: `pm2` uptime for `agjassist` is unchanged until JROM says deploy.

---

## PROMOTION CLEANUP (mandatory — north-planning.md)
Any slice that stands up local scratch (temp collectors, fixtures, a local sampler harness, screenshots/evidence dirs) **tears it down at its promotion boundary**, by the slice that created it — an allowlist of names the run created, never an age-based `/tmp` sweep. Reclaimed space reported in the completion artifact. No `node_modules`/`.git` archived into evidence dirs.

## Out of scope (this effort)
- Physically installing smart-plugs / metered PDUs (G2 ships the estimate; hardware is a later effort).
- Enabling motherboard Super-I/O fan chips on boxes where they need a kernel-module/BIOS change (C2 shows what's exposed; per-box `sensors-detect` enablement is optional follow-up).
- Any change to xmac's power semantics or its three guards.
# Effort north-star — xmachines

_Authored by `[north]` 2026-09-25. Scoped to ONE effort. **APPEND-ONLY** (dated entries; never retcon). Inherits + cites the project constitution `AGJAssist/north-star.md` — does not copy it._

## The one line
A new **xmachines** section in AGJAssist: a phone-first remote view of JROM's GPU/data fleet (174/179/182/169) — temps, power, fans, uptime, per-GPU drill-down — and safe on/off control, built on top of the existing `xmac` power gateway so the "can't power off a busy GPU" guard comes for free.

## Why it belongs (inheritance)
- Project north-star: *command-center-first*, *owner-only*, *mobile/tablet-first*, *security-first for anything remote/spawning*, *additive-only migrations*. Remote power control is precisely a "remote/spawning" action → all bedrock applies.
- It extends the command center from "drive my agents" to "drive the machines my agents run on" — and those are the same GPU boxes the local model seats (glimmer/signal) live on.

## Scope
**In:** the xmachines section (overview + drill-down), live telemetry (self-detected GPUs/sensors/fans), best-estimate power, uptime (OS + power-session + on-hours), owner-only power on/off via xmac (guards surfaced), server-side 30m sampler + 30s foreground refresh + history, passive polling.
**Out (this effort):** smart-plug/PDU hardware; per-box Super-I/O fan enablement; any change to xmac's guards.

---

## Frontloaded decisions (2026-09-25)

- **D1 · Build on xmac, don't reimplement.** Backend shells to `~/.config/agent-protocols/lib/xmac.sh` for status/up/down/leases/busy. Invariant preserved: xmac is the only thing that powers a box off.
- **D2 · Passive polling is a hard rule.** The collector reads only UP boxes (ping/status-gated); it must never use an auto-waking path. Rationale: a monitor that wakes boxes defeats the power-saving purpose.
- **D3 · Self-detect everything.** GPUs/sensors/fans discovered live; registry text is a display hint, never the source of truth. (This effort was triggered by exactly this drift: the registry claimed a 3090 on 174 that live `nvidia-smi` disproved.)
- **D4 · Wattage = best-estimate, labelled.** GPU measured; CPU/rest estimated + PSU factor; measured-vs-estimated visually distinct. Later hardware metering replaces estimates transparently.
- **D5 · Cadence.** 30s foreground / 30m background + independent server-side 30m sampler for history.
- **D6 · planning_criticality = HIGH.** Remote power-off is an irreversible, security-sensitive action exposed over a public tunnel → requirements review before planning (grok + sol), and red-team on architecturally-significant batches.
- **D7 · Topology = JROM's custom roster (2026-09-25).** Stamped in `topology.yaml`; rationale + deviations in `decisions/D-2026-09-25-topology-and-criticality.md`.

## Registry correction landed (2026-09-25)
`machines.conf` was corrected to the live-verified inventory (174 = PRO 4500 + 2× PRO 4000; 3090 moved 174→182; one 3090 in the fleet). Backup at `machines.conf.bak-20260925`.

## Decisions settled by JROM 2026-09-25
- **O1 · Self-grading policy → STANDING** (conflict-accepted; red-team is the independent gate — the only seats that didn't co-plan). No stricter per-batch guard.
- **O2 · Guardian supervision → OFF** (attended/foreground; `supervision.yaml` stamped `enabled: false`).
- **O3 · validator-L1 = signal → KEPT** (local 27B). Bounded risk: `default_validator_tier` is L2=codex55, so signal only gates explicitly-routine batches.
- **Scope constraint (JROM) → ONE app.** xmachines is a section INSIDE AGJAssist; no new app/port/tunnel/deploy target (og-requirements "Non-negotiable scope constraint").

## Promotion (while projcore runs)
Candidate promotions to the PROJECT north-star to propose later: "the fleet's machines are a first-class managed resource" (currently only agents+projects are named in bedrock #2). Propose only after JROM sees it working.
