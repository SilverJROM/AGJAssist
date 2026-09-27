# xmachines UI — PORT SPEC / CONTRACT (JROM-approved 2026-09-27)

**Status: LOCKED CONTRACT.** JROM approved the mockup as the binding UI spec on 2026-09-27
("make this a contract and i expect this on the app"). The rebuild's UI must match this.

- **Visual source of truth:** `xmachines/mockup/index.html` (this repo). Open it and match it screen-for-screen.
- **Applies to:** the xmachines section *inside* AGJAsst (not a standalone app). Phone-first webview, scales to desktop.
- **Backend:** reuse the already-built A/B/C services on `feat/xmachines`; this contract re-does the **D-series (UI)**
  and adds the few backend capabilities the UI now requires (below). Delivery stays branch-gated (og-req K1/K2).

---

## Screen 1 — Machine list ("Machines", the initial window)
- Page title "Machines" + subline. A horizontally-scrollable **summary strip**: Online / Off / Fleet draw ≈ (W) /
  GPUs busy / Hot-alert count.
- One **card per machine** (fleet is self-detected: 174/179/182/169 today, but count is dynamic):
  - Left **severity stripe** (green normal / amber warning / red hot / grey off).
  - **Display name** (renamable, see §Interactions) + `host · IP` in mono + `busy` pill when busy + severity pill.
  - Stat grid: **Power** (On/Off) · **Hottest** °C (thermal-colored) · **Draw** W · **GPUs** n (n busy) *or* **Storage** % · **Uptime**.
  - Whole card is a button → Screen 2. Keyboard-focusable.

## Screen 2 — Machine detail
Header: back to Fleet · **display name + ✎ rename** · `host · IP` · severity/busy pills · freshness chip
("updated Ns ago", live-ticking; or "last seen …" when off/stale).

Sections, in order:
1. **Power & control**
   - **Discreet** On/Off status pill + uptime; current **draw** as the prominent number with `measured` / `≈ est` / `off` badge.
   - Controls by state:
     - **Off** → `Turn on (Wake-on-LAN)` + cold-wake note.
     - **On + busy** → `Turn off` **disabled** with a fail-closed reason; `Force off…` → **confirm dialog** (Cancel default + red "Force power-off"). Force is the only thing that clears the busy guard; it maps to the xmac `--force` step-up.
     - **On + idle** → `Turn off` **enabled**, and it also opens a **confirm dialog** first (accidental-click guard).
2. **Thermals** — CPU · hottest · ambient≈ (thermal-colored); hot banner ≥ 80 °C (fancurve note).
3. **GPUs** — self-detected count badge; per-GPU: model · VRAM · temp · power (W) · util % · memory · busy/idle + running process.
4. **Fans** — `fancurve kit` vs `lm-sensors` badge; per-fan: label · duty% bar · rpm · mode; "no board sensor" degrades gracefully; fancurve-active note.
5. **Storage & SMART** (storage machines) — array used bar, per-disk temp + SMART health + used bar, UPS line. (Replaces GPUs section.)
6. **History** — see §Charts.
7. **Data & freshness** — source · cadence (30 s open · 30 min background) · started-by-xmac · machine ID.
- **Offline machine** shows a "powered off" panel (last-known GPU, cold wake) instead of live thermals/GPU/fans/history.

## Charts (History section) — REQUIRED shape
- Two line charts: **Power draw (Y = watts)** and **Hottest temp (Y = °C)**, both **X = time**.
- Labeled axes: Y tick labels + unit; X time ticks; light gridlines; area fill; emphasized "now" endpoint; "now =" value in the caption.
- **Range selector (segmented control): `1H` · `6H` · `24H`** (default 1H). Switching re-scales both charts and their X-axis time ticks
  (−60m/−40m/−20m/now · −6h/−4h/−2h/now · −24h/−16h/−8h/now) and the "Energy · last <range>" figure.

## Global
- **Theme:** full light + dark, top-bar toggle; system default respected. Semantic colors (ok/warn/hot/off) kept separate from the teal accent.
- **Bottom nav** consistent with AGJAsst (xmachines = "Machines" tab).
- **Refresh** control; while the view is open, data auto-refreshes every 30 s (30 min when backgrounded).

## Interactions
- **Rename a machine:** ✎ on the detail header → inline field → Save/Cancel (Enter/Esc). Reflects on list + detail.
- **Power actions** always confirm before acting (modal); Cancel is the default focus.
- **Card → detail** navigation; back to Fleet.

---

## Backend capabilities this UI requires (delta on top of the built A/B/C)
1. **History retention + ranges.** The passive sampler must retain enough samples to serve **1h / 6h / 24h** and downsample
   for the chart (e.g. keep ≥ 24h; return a bucketed series per requested range via the read API). Today's build has a 30-min sampler —
   extend retention + add a `range` param to the history endpoint.
2. **Renamable display name.** Persist an owner-set display name per machine (server-side, owner-scoped so it's the same across
   JROM's devices — *default*; a per-device fallback via localStorage is acceptable if server persistence is deferred). Read/write via the owner-gated API.
3. **Real collectors behind the fields.** fancurve kit (`ssh .179 /opt/fancurve/fanstatus.py`) on box-b for real fan rpm + alert;
   nvidia-smi + lm-sensors elsewhere; SMART + NUT for the storage box; graceful absence per og-req C2/E.
4. Everything else (power on/off/force + guards, busy preflight, audit, freshness, cost, WoL, uptime) is already built (A/B/C) — wire the UI to it.

## Acceptance
The rebuilt xmachines section, run on a local instance, matches `index.html` screen-for-screen for the two screens, all machine
states (busy-blocked-off, hot-alert, offline-wake, safe-off/storage), the 1H/6H/24H charts, rename, discreet On/Off, and
confirm-before-power-action. Then: JROM reviews on the local instance → approves → prod deploy (K1/K2).
