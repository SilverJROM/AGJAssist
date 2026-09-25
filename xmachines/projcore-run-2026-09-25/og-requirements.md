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
- Changing **xmac.sh internals** (its power semantics / the three guards themselves). **NARROWED (review R9):** the app-side **fail-closed busy preflight** (L1) and setting **`XMAC_CALLER`** ARE in scope — they are app behavior, not xmac changes. A structured-error/idempotency change to xmac.sh stays out-of-scope unless separately reviewed (escalate to `[north]`).

---

## AMENDMENTS FROM REQUIREMENTS REVIEW (BINDING — north 2026-09-25)
_grok-4.7 + gpt-5.6-sol adversarial review. Full dispositions + rationale: `review/RECONCILIATION.md`. These SUPERSEDE/EXTEND the criteria above and are binding on planning. This is a HIGH-criticality effort; the originals under-specified SAFETY._

### L — Safety & security (the review's core findings)
- **L1 Fail-closed busy preflight.** Before ANY power-off the app runs the box's busy check itself with a hard timeout; empty-due-to-error, timeout, or unreachable ssh ⇒ treat as **BUSY ⇒ refuse**. (xmac guard-2 is fail-OPEN on ssh error — the app must not rely on it.) Provable: a hung/uncontactable box's OFF is refused with a "cannot confirm idle" reason.
- **L2 Owner-off skips ONLY guard-3.** The normal Off maps to a power-off that bypasses only *not-woken-by-xmac* (guard-3); **lease + fail-closed busy still block it** with the reason shown. (Without this, Off is dead on every box xmac didn't wake — today all but `gpu` — forcing a naive impl onto `--force`.) NEVER rewrite a guard-3 refusal into blanket `--force`.
- **L3 `--force` is a separate, stepped-up action.** Full force (overrides lease + busy) requires a **Telegram number-match step-up challenge** (single-use, ≤60s, bound to session+machine+action); the confirm text is the LIVE probe output (pids/process/lease-holder). Refused entirely for protected boxes (L4).
- **L4 Protected-role denylist (DYNAMIC).** Refuse off/force for a box hosting a protected role: **.174 (signal)** + **.179 (glimmer)** while a run is live; **.169 (hdd)** during the `transcript-archive` lease/window (crontab `17 * * * *`; local tar+scp, invisible to hdd's busy_check). Detail view NAMES the protected role. **This effort's own live tests HARD-REFUSE .174/.179.** Post-run, all 4 are controllable.
- **L5 One read-only collector.** Exactly ONE reader module does all remote telemetry I/O; it may ssh/ping but **MUST NOT** call `xmac up/run/claim/release` or `wakeonlan`. Every path (foreground poll, 30m sampler, detail, SMART, UPS, alerts) routes through it; failure ⇒ records **stale**, never wakes. Provable: a gateway-spy shows ZERO wake / zero app-`XMAC_CALLER` WAKE lines across a full cycle on a DOWN box, and the DOWN box stays down.
- **L6 Auth hardening.** Power routes POST-only; strict external Host/Origin allowlist (canonical public host; do NOT reuse the agent-route loopback-peer trust — app binds 0.0.0.0 behind the tunnel); per-route + per-owner rate limits; short/revocable sessions + **revoke-all-web-sessions**; off/force behind L3. Set `XMAC_CALLER` = owner+session so `audit_log` and `xmac.log` agree.
- **L7 Audit (append-only, complete).** Record request, authz result, pre-action state, per-guard results, force reason, exact allowlisted target/action, gateway exit status, **observed final state**, actor/session/request id, source, timestamps — **including denied / replayed / rate-limited attempts**. The power-audit view is `requireOwner` and renders `details`.

### M — Correctness, identity, observability
- **L8 Power state machine + oracle.** `DOWN | STARTING | UP | DEGRADED | STOPPING | UNREACHABLE | ERROR`, with timeouts; a timeout is an explicit **ERROR**, never silently `DOWN`. "Success" of a power action = gateway outcome **plus** repeated independent reachability observations over a defined interval.
- **L9 Two fence classes (false-green backstop, fixed).** (i) UI/logic fences use a **fake fleet** + synthetic telemetry, asserting rendered numbers + refusal strings + measured/estimated marks + zero-wake — a "mock spawned with argv `down`" assertion is a specified **FAIL**. (ii) **ONE live power fence** on a designated box **≠ .174/.179** (default `media`/.182, or `hdd`/.169 outside its archive window with a lease held), asserting stable ping-loss + an `xmac.log DOWN-OK` line carrying the app's `XMAC_CALLER`, then a successful cold wake. **D/F/I slices validate at tier L2 (codex55)**, not local signal-L1.
- **L10 Actuation isolation.** Local/test mode DEFAULTS to a **non-actuating fake gateway** + synthetic telemetry; real control is impossible without an explicit server-side `--arm`. K1's local Playwright can never actuate the real fleet.
- **L11 Self-detect robustness.** GPUs keyed by **stable UUID** (one `nvidia-smi --query-gpu=uuid,…` per poll, hard 8s timeout); history attaches to UUID; add/remove/reorder reconciled atomically; removed devices retained as retired. `[N/A]` renders **"unavailable"**, never `0`. On-screen states: no-NVIDIA · driver/timeout (last-good + error chip) · non-NVIDIA-by-name · stale.
- **L12 Machine list is self-detected too.** Overview lists `xmac.sh status` names (a 5th machine added to `machines.conf` appears with no code change); registry text is a hint under the live GPU name.
- **L13 Telemetry freshness.** Every live value shows sample **age + provenance**; stale/expired live readings grayed or cleared (never shown as healthy); last-good survives only in history. Aggregates explicit: **max** GPU temp; **sum of MEASURED** GPU watts.
- **L14 xmac contract probe (Batch 0).** Before any control code, probe + record per host into `capability-matrix.md`: service-user permissions, exact argv/subcommands, exit codes, stdout/stderr shapes, guard ordering, log format, concurrent-call behavior, force semantics — each VERIFIED / ABSENT / UNKNOWN with cmd + timestamp + raw. **No UNKNOWN capability may become a green acceptance.**
- **L15 Concurrency / no-block.** Server-side per-machine mutex + idempotency key on every power POST; child process **detached** (never block the single Fastify process on a 180s `xmac up`); coalesce duplicate/overlapping requests; POST returns "in progress" immediately; per-machine cooldown. Fence: double-click, two tabs, timeout-retry, ON-during-OFF.

### Concrete numbers (config, JROM-tunable) — R8
GPU warn ≥ 80°C / crit ≥ 90°C (hysteresis 3°C, persist 2 samples) · CPU warn ≥ 85 / crit ≥ 95 · won't-wake = no UP within 180s of a WAKE · fan-fail = an expected-spinning fan at 0 RPM for 2 samples while GPU > 60°C · dedupe/re-notify window 30 min · cost currency **PHP** + `$/kWh` config (default a flagged placeholder), kWh integrated from 30m samples with an explicit "bursts < 30m are missing" caveat, kept OFF the overview · PSU efficiency 0.9 · per-box baseline in config.

### Refinements to earlier criteria
- **C3 (uptime) — R13:** power-session is **known/unknown with provenance**; never assert "since xmac wake" without a matching WAKE→UP and current boot identity; sampled on-hours labelled **estimated**.
- **I5 (WoL-safe) — R-accepted:** shows the timestamp of the last WAKE followed by UP, or "never verified"; a stale/never-verified badge makes OFF use the L3 challenge and the confirm warns the box may stay off.

### Planning directives (to the co-planners)
- **P1** Atomic-split EVERY bundled criterion into IDs with ONE observable each (e.g. D2 → D2a off-succeeds · D2b lease-refusal · D2c busy-refusal · D2d guard-3 handling · D2e reason-rendered; F1 → F1a "updated Ns ago" advances ~30s when visible · F1b frozen when hidden/route-changed; A1 → Header link · desktop Dashboard card · TG grid tile (seed the mini-app flag) · KNOWN_EXACT · route).
- **P2** Every acceptance row names its **EVIDENCE CLASS** (UI screenshot · HTTP auth/Origin matrix · gateway-spy · live-oracle · CLI-to-UI compare · DB/schema check · Telegram receipt · git/pm2/socket evidence · mutation report). A UI screenshot is NOT valid evidence for auth, power, passivity, persistence, or delivery.
- **P3** Batch 0 = xmac contract probe + capability-matrix (L14) BEFORE any control code. The safety rulings L1–L5 are their own early batches, **red-teamed** (architecturally-significant → red-team `standard`/`elite`).
