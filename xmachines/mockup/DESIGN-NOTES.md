# xmachines — UI mockup (design-first, pre-rebuild contract)

**Purpose:** JROM reviews this interactive mockup on the LAN and approves it *as the contract*
before any rebuild. The earlier auto-built UI (bare "synthetic … fake fake" list, non-clickable)
is rejected. This file + `index.html` become the visual spec the rebuild must match.

- **View it:** http://192.168.254.140:4188/  (LAN, phone-first; also fine on desktop)
- **Status:** ✅ APPROVED / LOCKED CONTRACT (JROM, 2026-09-27). Binding UI spec → see `port-spec.md`. Sample data; not wired to the real fleet.

### v3 changes (JROM feedback, 2026-09-27) — final before approval
5. **History range selector** — `1H · 6H · 24H` segmented control on both charts; switching re-scales the series, the X-axis time ticks, and the "Energy · last <range>" figure. Default 1H. (Backend implication: sampler must retain ≥24h and serve a `range` param — noted in `port-spec.md`.)

### v2 changes (JROM feedback, 2026-09-27)
1. **History graphs → proper line charts** with labeled axes: X = time (−30m … now, gridlines), Y = value (watts / °C, tick labels). Replaces the axis-less sparklines that were "confusing."
2. **Editable box names** — pencil (✎) on the detail header opens an inline rename (Save/Cancel); persists per-viewer and reflects on the list. Host·IP stays as the fixed technical identity.
3. **ON/OFF made discreet** — small status pill instead of the large hero word; current-draw number stays the prominent metric.
4. **Force-off confirm dialog** — clicking "Force off…" now opens a confirm modal (Cancel default + a distinct "Force power-off" button) so an accidental tap can't kill running work. A "Turn off" on a safe machine also confirms first.

## What it shows (JROM's ask: "the machine list, and the machine page with details + on/off + fans + temps + all of it")

### 1. Machine list (initial window)
- Real machines: `gpu`/174 (jromhost), `gpu2`/179 (jromnet), `media`/182 (dbtrain), `hdd`/169 (datasvr).
- Fleet summary strip: online / off / fleet draw ≈ / GPUs busy / hot-alert count.
- Each card: left severity stripe (green/amber/red/grey), name + host·ip, status pill, `busy` pill,
  and a stat grid — Power · Hottest temp · Draw (W) · GPUs (n busy) or Storage % · Uptime.
- **Whole card is tappable** → machine detail. Keyboard-focusable.

### 2. Machine detail page
- **Power & control:** big ON/OFF, uptime, current draw (W) with `measured` vs `≈ est` badge, and controls:
  - Off machine → **Turn on (Wake-on-LAN)** + cold-wake note.
  - On + busy → **Turn off is disabled** with a fail-closed reason; **Force off…** opens a step-up
    challenge (type the machine name) — mirrors the xmac busy-guard + `--force` step-up.
  - On + idle (hdd) → **Turn off enabled** ("safe to power off").
- **Thermals:** CPU · hottest · ambient≈, thermal-colored; hot-alert banner ≥ 80 °C.
- **GPUs (self-detected count):** per-card model · VRAM · temp · power · util · memory · busy/running-proc.
- **Fans:** per-fan duty% + rpm + mode; `fancurve kit` badge for .179 (real rpm), graceful "no board
  sensor" degradation for .174; fancurve.service note.
- **Storage & SMART (hdd):** array used bar, per-disk temp + SMART health, UPS line.
- **History:** 30-min power + temp sparklines, energy today (kWh + ₱).
- **Data & freshness:** source (fancurve kit / nvidia-smi / SMART), cadence (30 s open · 30 min bg),
  started-by-xmac, machine id.

## Design decisions made (react to any of these)
1. **Phone-first** — matches the AGJAsst Telegram webview; scales up on desktop. Kept the bottom nav.
2. **Accent = cool teal**, semantic colors kept separate (green ok / amber warn / red hot / grey off).
   Full light + dark theme (toggle in the top bar).
3. **Severity + power state encoded in form** (stripe, pills, thermal-colored numbers), not just text.
4. **Best-estimate wattage** shown with an explicit `≈ est` vs `measured` badge (per og-req G).
5. **Busy-guard is front-and-center** — the whole reason you asked for this: you literally can't
   fat-finger a power-off on a serving box; Force is a deliberate second step.
6. Four machines only (174/179/182/169) — the ones you named. Self-detect still applies (GPU counts
   vary: 3 / 2 / 1 / 0-storage).

## Open questions for JROM
- Card density: is the 4-metric grid right, or do you want fewer/bigger numbers per card?
- Do you want a fleet-wide power/temp graph on the list page, or keep graphs on the detail page only?
- Any machine you'd want a quick power toggle *directly on the list card* (vs only inside detail)?

## On approval
This becomes `port-spec.md` for the rebuild: re-plan the D-series (UI) rows against these screens,
keep the already-built A/B/C backend, and wire the real collectors (fancurve kit on .179, nvidia-smi
elsewhere) behind it.
