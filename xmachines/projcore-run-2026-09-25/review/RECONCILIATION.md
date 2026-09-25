# Requirements review — north reconciliation (2026-09-25)

Reviewers: **grok-4.7** + **gpt-5.6-sol (xhigh)**, headless one-shot, adversarial. Both did real code-level
work (grok read `xmac.sh` + the auth paths). Raw: `grok-findings.md`, `sol-findings.md`.

**Verdict: CHANGES-ACCEPTED — requirements amended before planning.** The originals under-specified SAFETY
for remote power control. 13 north rulings below become binding criteria L1–L15 + planning directives P1–P3
in `og-requirements.md`. No open review remains; docs may go to planning.

## The one decision the interview missed — DECIDED by north (not escalated)
Both flagged "ask JROM": given guard-3, ordinary Off works only on xmac-woken boxes, and `--force` overrides
lease+busy. north DECIDES the **safe** default (R1) rather than block — it cannot create a kill switch, and it
matches JROM's stated intent ("turn on/off … with a limit that if the GPUs are busy i cant turn it off").
Escalating a safely-decidable design choice would violate the after-handoff bar. Logged, not paged.

## Dispositions (F# per reviewer)
| Finding | Disp | → |
|---|---|---|
| sol F1/F2, grok F1/F2 — force = remote kill switch; busy-check fail-open; guard-3 forces `--force` | **RULING R1** | L1–L4 |
| sol F3, grok F4 — protected-service shutdown (signal/glimmer/archive) | **RULING R1/R2** | L4, L5 |
| sol F4, grok F5 — passive-poll TOCTOU; confounded oracle (hdd crontab :17) | **RULING R2** | L5 |
| grok F3, sol F5/F6 — bearer replay, CSRF, origin-behind-tunnel, XMAC_CALLER, audit gaps | **RULING R3** | L6, L7 |
| grok F7, sol F10/F13/F14 — no real power oracle; fence passes on "clicked"/mock-argv | **RULING R4** | L8, L9 |
| sol F12, grok F4/F7 — local verify can actuate the real fleet | **RULING R5** | L10 |
| grok F6, sol F15/F16/F17 — self-detect: UUID identity, timeout, [N/A]=0, partial/non-NVIDIA states | **RULING R6** | L11, L12 |
| sol F20, grok — telemetry staleness shown as healthy | **RULING R7** | L13 |
| both — missing numbers (thresholds, hysteresis, won't-wake, dedupe, tariff, PSU, retention) | **RULING R8** | L-nums |
| sol F28/F29, grok F1 tail — xmac contract unverified; out-of-scope too broad | **RULING R9** | L14 + narrow OOS |
| grok F12, sol F9/F21 — concurrency/wake-storm; blocks single Fastify proc; sampler lifecycle | **RULING R10** | L15 |
| grok F9/F10, sol F25/F26 — bundled criteria; not UI-provable; evidence classes | **RULING R11** | P1, P2 |
| grok F13 — gpu2 (.179) registry role string still wrong (says PRO 4500) | **RULING R12** | fix machines.conf |
| sol F19, grok F9 — uptime/on-hours not derivable as claimed | **RULING R13** | L (C3 split) |
| sol F22/F23/F24, grok F8/F11 — alert determinism; SMART/NUT privilege; cost reproducibility; UPS source | **ACCEPTED** | folded into L13/L-nums + P2 |
| sol F27, grok F13 — WoL-safe needs a safety effect + expiry | **ACCEPTED** | I5 → L (below) |

## The 13 rulings (binding — full criteria text lands in og-requirements)
- **R1 Power-off semantics.** (L1) app-side **fail-closed busy preflight** (timeout/error/unreachable ⇒ BUSY ⇒ refuse). (L2) "owner-off" skips **only guard-3**; lease + fail-closed busy still block, reason shown. (L3) full `--force` = separate action behind a **Telegram number-match step-up** (single-use ≤60s, bound to session+machine+action; confirm text = live probe output); refused for protected boxes. (L4) **protected-role denylist** — refuse off/force for **.174 (signal)** + **.179 (glimmer)** while a run is live, and **.169 (hdd)** during the `transcript-archive` window; denylist is DYNAMIC (post-run all 4 controllable). This run's live tests hard-refuse .174/.179.
- **R2 One read-only collector (L5).** Single reader module for ALL remote telemetry; may ssh/ping, MUST NOT call `xmac up/run/claim/release`/`wakeonlan`. All paths (foreground, 30m sampler, detail, SMART, UPS, alerts) route through it; failure ⇒ stale, never wake. Fence: gateway-spy proves zero wake / zero app-`XMAC_CALLER` WAKE lines over a full cycle on a DOWN box.
- **R3 Auth hardening (L6/L7).** POST-only; strict external Host/Origin allowlist (canonical public host; do NOT reuse the agent-route loopback-peer trust — app binds 0.0.0.0 behind the tunnel); rate-limit power routes; revoke-all-web-sessions; off/force behind L3 step-up; set `XMAC_CALLER`=owner+session so audit_log and xmac.log agree. Audit append-only incl. DENIED/replayed/rate-limited + observed final state; power-audit view `requireOwner`, renders details.
- **R4 Power oracle + fence integrity (L8/L9).** State machine `DOWN|STARTING|UP|DEGRADED|STOPPING|UNREACHABLE|ERROR`; timeout = ERROR not DOWN; success = gateway outcome + repeated independent reachability. Two fence classes: UI/logic fences on a FAKE fleet (assert rendered numbers + refusal strings + measured/estimated marks + zero-wake; a "mock spawned with argv down" assertion is a specified FAIL); ONE live power fence on a box **≠ .174/.179** asserting stable ping-loss + `xmac.log DOWN-OK` with app `XMAC_CALLER` + cold-wake. D/F/I slices validate at **tier L2 (codex55)**, not local signal-L1.
- **R5 Actuation isolation (L10).** Local/test mode DEFAULTS to a **non-actuating fake gateway** + synthetic telemetry; real control needs an explicit server-side `--arm`. K1 Playwright can never actuate the real fleet.
- **R6 Self-detect robustness (L11/L12).** GPUs keyed by **UUID** (one `--query-gpu=uuid,…` per poll, 8s timeout); history by UUID; add/remove/reorder atomic; removed = retired. `[N/A]` ⇒ "unavailable" not 0. States: no-NVIDIA · driver/timeout(last-good + error chip) · non-NVIDIA-by-name · stale. Overview lists `xmac.sh status` names so a 5th machine appears from config.
- **R7 Freshness (L13).** Every live value shows age/provenance; stale grayed/cleared (not healthy); last-good only in history; aggregates explicit (max GPU temp; sum of MEASURED watts).
- **R8 Numbers (config, JROM-tunable):** GPU warn ≥80°C / crit ≥90°C (hysteresis 3°C, persist 2); CPU warn ≥85 / crit ≥95; won't-wake = no UP within 180s of WAKE; fan-fail = expected-spinning fan 0 RPM ×2 samples while GPU >60°C; dedupe/re-notify 30 min; cost currency PHP + $/kWh config (default flagged placeholder), kWh integrated from 30m samples with "bursts <30m missing" caveat, kept off the overview; PSU efficiency 0.9; per-box baseline in config.
- **R9 xmac contract probe (L14) + narrowed OOS.** Batch-0 probe → `capability-matrix.md` per host (VERIFIED/ABSENT/UNKNOWN + cmd + ts + raw); no UNKNOWN becomes green. OOS narrowed: app-side fail-closed wrapper + `XMAC_CALLER` are IN scope; changing xmac.sh internals stays OOS unless separately reviewed (escalate to north).
- **R10 Concurrency (L15).** Per-machine server mutex + idempotency key; detached child (never block the Fastify proc on 180s `xmac up`); coalesce duplicates; POST returns "in progress"; cooldown. Fence: double-click, two tabs, timeout-retry, ON-during-OFF.
- **R11 Split + evidence (P1/P2).** Split every bundled criterion into atomic IDs, one observable each (D2→D2a..e, C3→uptime/session/on-hours, F1→F1a visible-advances/F1b hidden-frozen, A1→Header/desktop-card/TG-tile(seed mini-app flag)/KNOWN_EXACT/route). Each atomic ID → ONE evidence class (UI shot · HTTP auth/Origin matrix · gateway-spy · live-oracle · CLI-to-UI compare · DB/schema check · Telegram receipt · git/pm2/socket · mutation report).
- **R12 Registry (done here):** correct gpu2 (.179) role → 2× RTX PRO 4000 (live-verified).
- **R13 Uptime provenance:** power-session = known/unknown w/ provenance; never assert "since xmac wake" without matching WAKE→UP + current boot identity; sampled on-hours = estimated.

## Planning directives (to co-planners, via the packet)
- **P1** Atomic-split every bundled criterion (R11); one observable per row.
- **P2** Every acceptance row names its EVIDENCE CLASS; UI-shot is not valid for auth/power/passivity/persistence/delivery.
- **P3** Batch 0 = xmac contract probe + capability-matrix (R9) BEFORE any control code; safety rulings R1–R5 are their own early, red-teamed batches (architecturally-significant → red-team standard/elite).
