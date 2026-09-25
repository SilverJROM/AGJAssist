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
